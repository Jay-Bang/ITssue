import { Logger } from '../lib/logger';
import { IssueEntity, TimeWindow } from '../types';
import { runRankingEngine } from './ranking-engine';


// 병합 정책 설정 (V2 Config)
const MERGE_CONFIG = {
    JACCARD_STRONG: 0.7,   // 자동 병합 수준
    JACCARD_WEAK: 0.35,    // 기사 내용 유사도 기준
    OVERLAP_STRONG: 0.95,  // 부분집합 확실 기준
    OVERLAP_WEAK: 0.85,    // 부분집합 의심 기준
    TIME_BUFFER_MS: 4 * 60 * 60 * 1000, // 4시간 버퍼
    MIN_TOKEN_LENGTH: 2    // 유효 토큰 최소 길이
};

// 내부 처리용 확장 인터페이스 (V2.6)
interface MergableIssue extends IssueEntity {
    tokens: Set<string>;
    originalIndex: number;
    merge_reasons: string[]; // 병합 사유 추적 (Observability)
}

/**
 * [Issue Merger Gate (Pass 2)]
 * 
 * [Description] 유사한 주제의 파편화된 검색어들을 하나의 대표 이슈 그룹으로 병합하고 통계를 통합합니다.
 * 
 * [Design Intent]
 * - "관계는 그래프로, 점수는 합산으로": 단순 매칭을 넘어 Union-Find를 활용한 네트워크 그래프 병합.
 * - 언어적 유사도(Jaccard)와 부분집합 관계(Overlap)를 결합하여 통계적 정합성 확보.
 * 
 * [Key Logic Flow]
 * 1. 수집된 이슈들의 뉴스 제목을 토큰화(`Tokenize`)하여 어휘 분석 준비.
 * 2. 시간 범위 내의 모든 이슈 쌍(Pair)에 대해 유사도 측정 및 병합 여부 판단 (Pure Rule-based).
 * 3. Union-Find 알고리즘을 통한 이슈 그룹화.
 * 4. 그룹 내 최고 점수 키워드를 `Representative Keyword`로 선정 및 모든 데이터 집계.
 */

// [Logic/Data Structure] Union-Find (Disjoint Set) 알고리즘
// 별개의 원소들을 상호 배타적 집합으로 관리하며, 병합과 그룹 식별 작업을 최적화된 시간 내에 수행합니다.
class UnionFind {
    private parent: number[];

    constructor(size: number) {
        // 모든 원소는 자기 자신을 부모로 하여 초기화 (독립 집합)
        this.parent = Array.from({ length: size }, (_, i) => i);
    }

    /**
     * [Optimization] 경로 압축 (Path Compression)
     * 탐색 과정에서 만나는 모든 노드가 직접 루트를 가리키게 하여, 이후 탐색 시간을 O(α(N))으로 단축합니다.
     */
    find(i: number): number {
        if (this.parent[i] === i) return i;
        return this.parent[i] = this.find(this.parent[i]);
    }

    /**
     * [Step] 두 원소를 하나의 그룹으로 병합
     * 한 쪽의 루트 노드를 다른 쪽의 루트 아래에 연결하여 집합을 통합합니다.
     */
    union(i: number, j: number): void {
        const rootI = this.find(i);
        const rootJ = this.find(j);
        if (rootI !== rootJ) {
            this.parent[rootJ] = rootI;
        }
    }
}

interface MergeCandidate {
    baseIndex: number;
    targetIndex: number;
    reasons: string[];
    jaccardScore: number;
    overlapRatio: number;
}

// [Logic] 한국어 텍스트 정규화: 한자(Hanja) 기반 약어 치환
// 뉴스 헤드라인에서 자국/타국명 및 정부 부처 등을 나타낼 때 쓰는 한자를 한글로 변환하여 병합 확률을 높입니다.
function normalizeHanja(text: string): string {
    const hanjaMap: Record<string, string> = {
        '李': '이', '朴': '박', '崔': '최', '鄭': '정', '姜': '강',
        '趙': '조', '尹': '윤', '張': '장', '林': '임', '吳': '오',
        '徐': '서', '申': '신', '權': '권', '安': '안', '黃': '황',
        '金': '김', '柳': '유', '高': '고',
        '韓': '한', '美': '미', '日': '일', '中': '중', '北': '북', // 주요 국가
        '與': '여', '野': '야', '軍': '군', '檢': '검', '警': '경'  // 정치/사회 약어 추가
    };
    return text.replace(/[\u4e00-\u9fff]/g, char => hanjaMap[char] || char);
}

/**
 * [Logic] 한국어 특화 토큰화 (Tokenizer)
 * [Optimization] 불필요한 조사와 공백을 제거하고 핵심 명사 위주로 토큰 세트를 구축합니다.
 */
function tokenize(text: string): Set<string> {
    const normalized = normalizeHanja(text); // 한자 -> 한글 치환 우선 실행
    // 한글, 영문, 숫자를 제외한 모든 특수문자를 공백 처리
    const rawTokens = normalized.replace(/[^\w\s가-힣\u4e00-\u9fff]/g, ' ').split(/[\s,]+/);
    const validTokens = new Set<string>();

    rawTokens.forEach(t => {
        // [Safety] 2글자 미만의 단어는 노이즈로 판단하여 제외
        if (t.length < 2) return;

        // [Logic] 기초적인 조사 제거 (은, 는, 이, 가, 을, 를 등)
        const clean = t.replace(/(은|는|이|가|을|를|의|에|로|으로|와|과)$/, '');
        if (clean.length >= 2) validTokens.add(clean);
    });
    return validTokens;
}

// 최적화: 이미 토큰화된 Set을 받아서 자카드 유사도(Jaccard Similarity) 계산
function calculateJaccardSimilarity(tokensA: Set<string>, tokensB: Set<string>): number {
    if (tokensA.size === 0 || tokensB.size === 0) return 0;

    let intersection = 0;
    tokensA.forEach(t => {
        if (tokensB.has(t)) intersection++;
    });

    const union = tokensA.size + tokensB.size - intersection;
    return union === 0 ? 0 : intersection / union;
}

// 최적화: Overlap Ratio 계산 (부분집합 관계 파악용)
function calculateOverlapRatio(tokensA: Set<string>, tokensB: Set<string>): number {
    if (tokensA.size === 0 || tokensB.size === 0) return 0;

    let intersection = 0;
    tokensA.forEach(t => {
        if (tokensB.has(t)) intersection++;
    });

    // 교집합 / 둘 중 작은 집합의 크기 (한 쪽이 다른 쪽에 얼마나 포함되는가)
    return intersection / Math.min(tokensA.size, tokensB.size);
}

// NER-light: 고유명사(인물 등) 추출 및 비교
function getCoreEntities(keyword: string): string[] {
    // [Hanja Fix] 한자 포함 고유명사 추출 및 정규화
    const normalized = normalizeHanja(keyword);
    return normalized.match(/[가-힣]{2,}/g) || [];
}

export async function runMergeGate(options: TimeWindow): Promise<IssueEntity[]> {
    Logger.info(`🛠️ Phase 2.5: 이슈 병합 게이트 시작 (Pure Rule-based)`);
    Logger.time('Ranking Engine');
    const atomIssues = await runRankingEngine(options);
    Logger.timeEnd('Ranking Engine');
    if (!atomIssues || atomIssues.length === 0) return [];

    // [Step 1] 데이터 확장 및 전처리
    // 모든 이슈에 대해 뉴스 제목을 토큰화하여 메모리에 캐싱 (유사도 계산 최적화용)
    const extendedIssues: MergableIssue[] = atomIssues.map((issue, idx) => ({
        ...issue,
        tokens: tokenize(issue.news_titles.join(' ')),
        originalIndex: idx,
        merge_reasons: []
    }));

    const uf = new UnionFind(extendedIssues.length); // 병합 그룹 관리를 위한 구조 초기화
    const candidates: MergeCandidate[] = [];
    Logger.info(`   (Sample: ID ${atomIssues[0].raw_snapshot_ids[0]}, Time: ${atomIssues[0].first_seen_at})`);

    Logger.time('Pure Rule Judging (V2)');
    // 1. 후보군 탐색 및 버킷팅 (O(N^2) Pruning 기초)
    // 시간순으로 정렬되어 있다고 가정 (rankingEngine에서 보장)
    for (let i = 0; i < extendedIssues.length; i++) {
        for (let j = i + 1; j < extendedIssues.length; j++) {
            const issueA = extendedIssues[i];
            const issueB = extendedIssues[j];

            const startA = new Date(issueA.first_seen_at).getTime();
            const endA = new Date(issueA.last_seen_at).getTime();
            const startB = new Date(issueB.first_seen_at).getTime();
            const endB = new Date(issueB.last_seen_at).getTime();

            // [Logic/Optimization] 시간 윈도우 기반 가지치기 (Pruning)
            // - 의도: 사건 B가 사건 A의 종료 시점(Buffer 포함)보다 너무 뒤에 있다면 비교 대상에서 제외합니다.
            // - 효과: 이슈가 시간순으로 정렬되어 있어 이후 인덱스의 j들도 자동으로 스킵되어 연산량이 대폭 감소합니다.
            if (startB > endA + MERGE_CONFIG.TIME_BUFFER_MS) break;

            // [Logic] 양방향 시간 겹침 검증 (A와 B가 서로의 버퍼 범위 내에 상주하는가)
            if (!(startA <= endB + MERGE_CONFIG.TIME_BUFFER_MS && startB <= endA + MERGE_CONFIG.TIME_BUFFER_MS)) continue;

            // [Logic] 키워드 텍스트 분석 및 고유명사 검증
            const kwA = issueA.representative_keyword;
            const kwB = issueB.representative_keyword;
            const normKwA = normalizeHanja(kwA);
            const normKwB = normalizeHanja(kwB);

            // [Step 2.1] Identity Match: 상호 텍스트 포함 관계 확인
            const isIdentityMatch = normKwA.includes(normKwB) || normKwB.includes(normKwA);

            // [Safety] 2.2 NER-light Safeguard: 고유명사 간 충돌(False Positive) 방지
            // 서로 다른 고유명사가 키워드에 각각 포함되어 있다면, 텍스트가 겹치더라도 다른 뉴스일 가능성이 큼.
            const entitiesA = getCoreEntities(kwA);
            const entitiesB = getCoreEntities(kwB);

            const diffA = entitiesA.filter(e => !normKwB.includes(e));
            const diffB = entitiesB.filter(e => !normKwA.includes(e));
            const hasEntityConflict = diffA.length > 0 && diffB.length > 0;

            if (hasEntityConflict && !isIdentityMatch) continue;

            // [Step 3] 통계적 판단 및 병합 태그(Reasoning Tags) 적립
            const jaccard = calculateJaccardSimilarity(issueA.tokens, issueB.tokens);
            const overlap = calculateOverlapRatio(issueA.tokens, issueB.tokens);
            const currentReasons: string[] = [];

            if (isIdentityMatch) currentReasons.push("IDENTITY_MATCH");
            if (jaccard >= MERGE_CONFIG.JACCARD_WEAK) currentReasons.push(jaccard >= MERGE_CONFIG.JACCARD_STRONG ? "JACCARD_STRONG" : "JACCARD_WEAK");
            if (overlap >= MERGE_CONFIG.OVERLAP_WEAK) currentReasons.push(overlap >= MERGE_CONFIG.OVERLAP_STRONG ? "OVERLAP_STRONG" : "OVERLAP_WEAK");

            // [Step 4] 병합 결정 및 관계 전파 (Union-Find)
            if (currentReasons.length > 0) {
                uf.union(i, j);
                issueA.merge_reasons = Array.from(new Set([...issueA.merge_reasons, ...currentReasons]));
                issueB.merge_reasons = Array.from(new Set([...issueB.merge_reasons, ...currentReasons]));
            }
        }
    }
    Logger.timeEnd('Pure Rule Judging (V2)');

    // 3. 최종 그룹핑 및 집계 (Aggregation)
    Logger.time('Group Aggregation');
    const groupedMap = new Map<number, MergableIssue[]>();

    extendedIssues.forEach((issue, idx) => {
        const root = uf.find(idx);
        if (!groupedMap.has(root)) {
            groupedMap.set(root, []);
        }
        groupedMap.get(root)!.push(issue);
    });

    Logger.info(`🧩 Grouped into ${groupedMap.size} unique merged issues (from ${extendedIssues.length} atoms).`);

    const finalIssues: IssueEntity[] = [];
    // [Track] 병합된 개수를 추적하기 위한 맵 (Key: 대표 키워드, Value: 병합된 원본 이슈 개수)
    const mergeCountMap = new Map<string, number>();
    // [Track] 병합된 원본 키워드 리스트를 추적하기 위한 맵 (Key: 대표 키워드, Value: 원본 키워드 리스트)
    const mergedKeywordsMap = new Map<string, string[]>();

    for (const [rootIdx, members] of groupedMap) {
        // 점수 내림차순 정렬 (대표 키워드 선정을 위해)
        members.sort((a, b) => b.score - a.score);
        const leader = members[0]; // 점수가 가장 높은 녀석이 대표

        // 속성 합치기 (Set 이용)
        const allTitles = Array.from(new Set(members.flatMap(m => m.news_titles)));
        const allSnapshotIds = Array.from(new Set(members.flatMap(m => m.raw_snapshot_ids)));
        // 모든 멤버의 병합 사유 합치기
        const allReasons = Array.from(new Set(members.flatMap(m => m.merge_reasons)));

        // 점수 단순 합산 (Pure Sum)
        const totalScore = members.reduce((sum, m) => sum + m.score, 0);
        const totalSnapshots = members.reduce((sum, m) => sum + m.snapshot_count, 0);

        // 시간 범위 확장
        const earliest = members.map(m => new Date(m.first_seen_at).getTime()).reduce((min, t) => Math.min(min, t), Infinity);
        const latest = members.map(m => new Date(m.last_seen_at).getTime()).reduce((max, t) => Math.max(max, t), -Infinity);

        finalIssues.push({
            representative_keyword: leader.representative_keyword,
            news_titles: allTitles,
            snapshot_count: totalSnapshots,
            first_seen_at: new Date(earliest).toISOString(),
            last_seen_at: new Date(latest).toISOString(),
            score: totalScore,
            raw_snapshot_ids: allSnapshotIds,
            // [Pass 2] 대표 키워드 본연의 뉴스 제목 보존 (재시도 시 노이즈 감소용)
            core_news_titles: leader.news_titles,
            merge_reasons: allReasons,
            merged_keywords: members.map(m => m.representative_keyword),
        });

        // 맵에 메타데이터 저장
        mergeCountMap.set(leader.representative_keyword, members.length);
        mergedKeywordsMap.set(leader.representative_keyword, members.map(m => m.representative_keyword));
    }
    Logger.timeEnd('Group Aggregation');

    // 4. 최종 정렬 (점수순) - 전체 반환
    finalIssues.sort((a, b) => b.score - a.score);

    Logger.info(`🏆 --- FINAL MERGED RANKING (Top 10 Preview) ---`);
    finalIssues.slice(0, 10).forEach((issue, index) => {
        const count = issue.merged_keywords?.length || 1;
        const reasons = issue.merge_reasons?.length ? ` [Reason: ${issue.merge_reasons.join(', ')}]` : '';
        Logger.info(`${index + 1}. [${issue.score}pt] ${issue.representative_keyword} (Merged ${count} items)${reasons}`);
    });

    return finalIssues;
}

if (require.main === module) {
    const end = new Date();
    const start = new Date(end);
    start.setHours(start.getHours() - 24);

    runMergeGate({ start, end })
        .then(() => process.exit(0))
        .catch(e => { Logger.error("CLI mergeGate failure", e); process.exit(1); });
}
