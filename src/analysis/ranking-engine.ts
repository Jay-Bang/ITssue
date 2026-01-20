import { supabase } from '../db/supabase-client';
import { IssueEntity, TimeWindow } from '../types';
import { Logger } from '../lib/logger';

/**
 * Phase 2: 랭킹 엔진 v2 (순수 집계)
 * 
 * [데이터 입력]
 * - trend_snapshots 테이블에서 특정 기간 동안 수집된 검색어 순위 스냅샷을 조회
 * - 같은 키워드가 여러 시점에 수집되면서 각 시점의 대표 뉴스 제목들이 배열로 축적됨
 * 
 * [랭킹 철학]
 * "정직한 집계(Honest Aggregation): 눈속임 없는 순수 누적 점수제"
 * 
 * 1. 단순 채점: 1위=20점, 2위=19점, ..., 20위=1점. (21위 이하는 0점)
 * 2. 시간 감쇠 없음(No Time Decay): 아침에 발생한 1위와 저녁에 발생한 1위는 동일한 가치를 가짐.
 * 3. 상한선 없음(No Capping): 집계 기간 내의 모든 스냅샷을 합산. (오래 상위권에 머물수록 점수 높음)
 * 4. 전수 반환(Full Return): 병합 전 컷오프를 하지 않음. (통계 왜곡 방지)
 */
export async function runRankingEngine(options: TimeWindow): Promise<IssueEntity[]> {
    Logger.info(`🚀 Phase 2: 랭킹 엔진 시작 (순수 집계 & 전수 반환)`);

    const { start, end } = options;

    /**
     * [Timezone Policy]
     * 정규화된 DB(timestamptz)를 사용하므로, 더 이상 수동으로 9시간을 더할 필요가 없습니다.
     * 표준 toISOString()은 절대 시각인 UTC 문자열을 반환하며, Supabase가 이를 완벽히 이해합니다.
     */
    const startStr = start.toISOString();
    const endStr = end.toISOString();

    Logger.info(`📅 Analysis Period (UTC Range): ${startStr} ~ ${endStr}`);

    // 1. 특정 시간 범위 내의 스냅샷 조회 (전수 조회를 위해 페이지네이션 루프 구현)
    let allRows: any[] = [];
    let page = 0;
    const PAGE_SIZE = 1000;

    Logger.info(`📡 Fetching data from Supabase...`);
    Logger.time('Supabase Fetch');

    while (true) {
        const { data, error } = await supabase
            .from('trend_snapshots')
            .select('id, timestamp, keyword, rank, news_title')
            .gte('timestamp', startStr)
            .lte('timestamp', endStr)
            .order('timestamp', { ascending: true })
            .order('id', { ascending: true })
            .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

        if (error) {
            Logger.error('Error fetching snapshots', error);
            break;
        }

        if (!data || data.length === 0) break;

        allRows = allRows.concat(data);
        if (data.length < PAGE_SIZE) break;
        page++;
    }
    Logger.timeEnd('Supabase Fetch');

    if (allRows.length === 0) {
        Logger.warn(`No snapshots found for the given range.`);
        return [];
    }

    Logger.success(`Supabase Fetch Success: ${allRows.length} rows loaded.`);

    // 2. 키워드별 그룹화 (Issue Pool 생성)
    Logger.time('Keyword Grouping');
    const issueMap = new Map<string, any[]>();

    allRows.forEach(s => {
        if (!issueMap.has(s.keyword)) {
            issueMap.set(s.keyword, []);
        }
        issueMap.get(s.keyword)!.push(s);
    });

    Logger.info(`🧩 Grouped into ${issueMap.size} distinct keyword pools.`);
    Logger.timeEnd('Keyword Grouping');

    // 3. Scoring Engine (Simple Summation)
    Logger.time('Scoring Engine');
    const issueEntities: IssueEntity[] = [];

    issueMap.forEach((rows, keyword) => {
        // [Safety Sort] 로컬 시간순 보장
        const sortedRows = [...rows].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

        const newsTitles = Array.from(new Set(sortedRows.map(r => r.news_title).filter(Boolean)));

        let score = 0;
        sortedRows.forEach(r => {
            if (typeof r.rank !== 'number' || r.rank === null) {
                Logger.warn(`[Data Integrity] Invalid rank detected for keyword "${keyword}" (ID: ${r.id}). Value: ${r.rank}`);
                return;
            }
            // 1위=20점, 20위=1점, 21위~=0점
            const rankScore = Math.max(0, 21 - r.rank);
            score += rankScore;
        });

        issueEntities.push({
            representative_keyword: keyword,
            news_titles: newsTitles as string[],
            snapshot_count: rows.length,
            first_seen_at: sortedRows[0].timestamp,
            last_seen_at: sortedRows[sortedRows.length - 1].timestamp,
            score: score,
            raw_snapshot_ids: rows.map(r => r.id)
        });
    });
    Logger.timeEnd('Scoring Engine');

    const sortedIssues = issueEntities.sort((a, b) => b.score - a.score);

    Logger.info(`🏆 --- RANKING ENGINE COMPLETE (Total ${sortedIssues.length} issues) ---`);
    Logger.info(`   (Top 5 Preview)`);
    sortedIssues.slice(0, 5).forEach((issue, index) => {
        Logger.info(`   ${index + 1}. [${issue.score}pt] ${issue.representative_keyword} (${issue.snapshot_count}회 노출)`);
    });

    return sortedIssues;
}

// 로컬 테스트를 위한 직접 실행 로직
if (require.main === module) {
    const end = new Date();
    const start = new Date(end);
    start.setHours(start.getHours() - 24);

    runRankingEngine({ start, end })
        .then(() => {
            Logger.success('Analysis execution completed.');
            process.exit(0);
        })
        .catch(err => {
            Logger.error('Execution failed:', err);
            process.exit(1);
        });
}
