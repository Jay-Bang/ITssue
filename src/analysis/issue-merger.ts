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
 * Phase 2.6: 이슈 병합 게이트 V2 (Pure Rule-based)
 * 
 * [병합 철학]
 * "관계는 그래프로, 점수는 합산으로."
 * 
 * 1. Union-Find 알고리즘을 사용하여 A-B, B-C 관계를 A-B-C 그룹으로 완전 병합.
 * 2. 점수는 그룹 내 모든 이슈의 단순 합산 (Sum).
 * 3. 컷오프 없이 전수 반환.
 */

// Union-Find (Disjoint Set) 알고리즘 헬퍼 클래스
class UnionFind {
    private parent: number[];

    constructor(size: number) {
        this.parent = Array.from({ length: size }, (_, i) => i);
    }

    find(i: number): number {
        if (this.parent[i] === i) return i;
        return this.parent[i] = this.find(this.parent[i]); // 경로 압축 (Path compression)
    }

    union(i: number, j: number): void {
        const rootI = this.find(i);
        const rootJ = this.find(j);
        if (rootI !== rootJ) {
            this.parent[rootJ] = rootI; // 단순 병합 (Simple union)
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

// [Hanja Fix] 주요 성씨 및 빈번한 한자를 한글로 정규화
function normalizeHanja(text: string): string {
    const hanjaMap: Record<string, string> = {
        '李': '이', '朴': '박', '崔': '최', '鄭': '정', '姜': '강',
        '趙': '조', '尹': '윤', '張': '장', '林': '임', '韓': '한',
        '吳': '오', '徐': '서', '申': '신', '權': '권', '安': '안',
        '黃': '황', '金': '김', '柳': '유', '高': '고'
    };
    return text.replace(/[\u4e00-\u9fff]/g, char => hanjaMap[char] || char);
}

// 간단한 한글 조사 제거 (단순화된 버전)
function tokenize(text: string): Set<string> {
    // [Hanja Fix] 한자 범위(\u4e00-\u9fff) 포함 및 정규화 적용
    const normalized = normalizeHanja(text);
    const rawTokens = normalized.replace(/[^\w\s가-힣\u4e00-\u9fff]/g, ' ').split(/[\s,]+/);
    const validTokens = new Set<string>();

    rawTokens.forEach(t => {
        if (t.length < 2) return;
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

export async function runMergeGate(options: TimeWindow) {
    Logger.info(`🛠️ Phase 2.5: 이슈 병합 게이트 시작 (Pure Rule-based)`);
    Logger.time('Ranking Engine');
    const atomIssues = await runRankingEngine(options);
    Logger.timeEnd('Ranking Engine');
    if (!atomIssues || atomIssues.length === 0) return [];

    Logger.info(`Pre-processing data & Searching for merge candidates...`);
    Logger.time('Tokenization & Mapping');

    const extendedIssues: MergableIssue[] = atomIssues.map((issue, idx) => ({
        ...issue,
        tokens: tokenize(issue.news_titles.join(' ')),
        originalIndex: idx,
        merge_reasons: []
    }));

    const uf = new UnionFind(extendedIssues.length);
    const candidates: MergeCandidate[] = [];
    Logger.timeEnd('Tokenization & Mapping');

    Logger.info(`   (Sample: ID ${atomIssues[0].raw_snapshot_ids[0]}, Time: ${atomIssues[0].first_seen_at})`);

    Logger.time('Pure Rule Judging (V2)');
    // 1. 후보군 탐색 및 버킷팅 (O(N^2) Pruning 기초)
    // 시간순으로 정렬되어 있다고 가정 (rankingEngine에서 보장)
    for (let i = 0; i < extendedIssues.length; i++) {
        for (let j = i + 1; j < extendedIssues.length; j++) {
            const issueA = extendedIssues[i];
            const issueB = extendedIssues[j];

            // [Pruning] 시간 겹침 체크 (버퍼 포함)
            // 사건 B가 사건 A의 종료 시점(Buffer 포함)보다 훨씬 나중에 일어났다면, 
            // 정렬되어 있으므로 그 이후 사건들은 볼 필요가 없음 (Early Break).
            const startA = new Date(issueA.first_seen_at).getTime();
            const endA = new Date(issueA.last_seen_at).getTime();
            const startB = new Date(issueB.first_seen_at).getTime();
            const endB = new Date(issueB.last_seen_at).getTime();

            // 정렬된 특성 이용: B의 시작이 A의 종료+버퍼보다 뒤라면 이후 모든 j는 패스
            if (startB > endA + MERGE_CONFIG.TIME_BUFFER_MS) break;

            // 일반적인 겹침 확인
            if (!(startA <= endB + MERGE_CONFIG.TIME_BUFFER_MS && startB <= endA + MERGE_CONFIG.TIME_BUFFER_MS)) continue;

            // 2. [Hanja Fix] 평규화된 키워드로 비교 진행
            const kwA = issueA.representative_keyword;
            const kwB = issueB.representative_keyword;
            const normKwA = normalizeHanja(kwA);
            const normKwB = normalizeHanja(kwB);

            // 2.1 Identity Match (포함 관계)
            const isIdentityMatch = normKwA.includes(normKwB) || normKwB.includes(normKwA);

            // 2.2 NER-light Safeguard: 인물/장소 충돌 감지
            const entitiesA = getCoreEntities(kwA); // 내부에서 normalize 수행
            const entitiesB = getCoreEntities(kwB);

            // [Fix] 정규화된 키워드 기준으로 차이 분석
            const diffA = entitiesA.filter(e => !normKwB.includes(e));
            const diffB = entitiesB.filter(e => !normKwA.includes(e));
            const hasEntityConflict = diffA.length > 0 && diffB.length > 0;

            if (hasEntityConflict && !isIdentityMatch) continue;

            // 3. 통계적 판단 (Reasoning Tags 적립)
            const jaccard = calculateJaccardSimilarity(issueA.tokens, issueB.tokens);
            const overlap = calculateOverlapRatio(issueA.tokens, issueB.tokens);
            const currentReasons: string[] = [];

            if (isIdentityMatch) currentReasons.push("IDENTITY_MATCH");
            if (jaccard >= MERGE_CONFIG.JACCARD_WEAK) currentReasons.push(jaccard >= MERGE_CONFIG.JACCARD_STRONG ? "JACCARD_STRONG" : "JACCARD_WEAK");
            if (overlap >= MERGE_CONFIG.OVERLAP_WEAK) currentReasons.push(overlap >= MERGE_CONFIG.OVERLAP_STRONG ? "OVERLAP_STRONG" : "OVERLAP_WEAK");

            // [병합 결정]
            if (currentReasons.length > 0) {
                uf.union(i, j);
                // 태그 전파 (A, B 모두에게 사유 기록)
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
