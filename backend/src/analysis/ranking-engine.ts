import { supabase } from '../db/supabase-client';
import { IssueEntity, TimeWindow } from '../types';
import { Logger } from '../lib/logger';

/**
 * [Ranking Engine]
 * 
 * [Description] 수집된 트렌드 키워드 데이터를 정량적으로 집계하여 중요도를 산출하는 제1차 분석 엔진입니다.
 * 
 * [Design Intent]
 * - [Logic] "Point-based Accumulation": 인위적인 보정을 최소화하고 노출 빈도와 실시간 순위를 합산하여 트렌드의 강도를 객관적으로 파악합니다.
 * - [Optimization] 대규모 데이터셋 대응을 위해 페이지네이션 기반의 데이터 인출 아키텍처를 채택했습니다.
 */
export async function runRankingEngine(options: TimeWindow): Promise<IssueEntity[]> {
    Logger.info(`[Ranking] 🚀 Phase 2: Engine Started`);

    const { start, end } = options;

    /**
     * [Timezone Policy]
     * 정규화된 DB(timestamptz)를 사용하므로 더 이상 수동으로 9시간을 더할 필요가 없습니다.
     * 표준 toISOString()은 절대 시각인 UTC 문자열을 반환하며, Supabase가 이를 완벽히 이해합니다.
     */
    const startStr = start.toISOString();
    const endStr = end.toISOString();

    Logger.info(`📅 Analysis Period (UTC Range): ${startStr} ~ ${endStr}`);

    // [Step 1] 특정 시간 범위 내의 모든 스냅샷 조회
    // [Logic] 대량의 데이터를 수집할 경우를 대비하여 1,000개 단위의 페이지네이션 루프를 구현합니다.
    // [Safety] order('id')를 추가하여 페이지네이션 검색 시 데이터 순서의 결정성(Determinism)을 확보합니다.
    let allRows: any[] = [];
    let page = 0;
    const PAGE_SIZE = 1000;

    Logger.info(`[Ranking] 📡 Fetching data from Database...`);


    while (true) {
        const { data, error } = await supabase
            .from('trend_snapshots')
            .select('id, timestamp, keyword, rank, news_title')
            .gte('timestamp', startStr)
            .lte('timestamp', endStr)
            .order('timestamp', { ascending: true })
            .order('id', { ascending: true }) // [Safety] 동일 타임스탬프 내 순서 고정
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


    if (allRows.length === 0) {
        Logger.warn(`No snapshots found for the given range.`);
        return [];
    }

    Logger.success(`Supabase Fetch Success: ${allRows.length} rows loaded.`);

    // [Step 2] 키워드별 그룹화 (Keyword Pooling)
    // [Logic] 동일 키워드가 여러 시간대에 수집된 데이터를 통합하여 단일 풀(Pool)로 관리합니다.
    const issueMap = new Map<string, any[]>();

    allRows.forEach(s => {
        if (!issueMap.has(s.keyword)) {
            issueMap.set(s.keyword, []);
        }
        issueMap.get(s.keyword)!.push(s);
    });

    Logger.info(`🧩 Grouped into ${issueMap.size} distinct keyword pools.`);


    // [Step 3] Scoring Engine (점수 합산 및 엔티티 변환)
    const issueEntities: IssueEntity[] = [];

    issueMap.forEach((rows, keyword) => {
        // [Safety] 로컬 시간순 정렬 보장
        const sortedRows = [...rows].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

        const newsTitles = Array.from(new Set(sortedRows.map(r => r.news_title).filter(Boolean)));

        // [Logic] Scoring Formula: Max(0, 21 - Rank)
        // [Design Intent] 1위(20점)부터 20위(1점)까지 차등 부여하여 상위권 트렌드에 가중치를 둡니다.
        let score = 0;
        sortedRows.forEach(r => {
            if (typeof r.rank !== 'number' || r.rank === null) {
                // [Safety] 데이터 무결성 확인: 순위 데이터가 없는 경우 건너뜀
                Logger.warn(`[Data Integrity] Invalid rank detected for keyword "${keyword}" (ID: ${r.id}). Value: ${r.rank}`);
                return;
            }

            const rankScore = Math.max(0, 21 - r.rank);
            score += rankScore;
        });

        issueEntities.push({
            representative_keyword: keyword,
            news_titles: newsTitles as string[],
            snapshot_count: rows.length, // 노출 빈도(Frequency) 기록
            first_seen_at: sortedRows[0].timestamp,
            last_seen_at: sortedRows[sortedRows.length - 1].timestamp,
            score: score,
            raw_snapshot_ids: rows.map(r => r.id)
        });
    });

    // [Step 4] 최종 점수순 정렬 및 결과 반환
    // [Optimization] 가장 파괴력이 높은 트렌드를 최상단으로 보내 리포트 가독성을 높입니다.
    const sortedIssues = issueEntities.sort((a, b) => b.score - a.score);

    Logger.info(`🏆 --- RANKING ENGINE COMPLETE (Total ${sortedIssues.length} issues) ---`);
    Logger.info(`   (Top 5 Preview)`);
    sortedIssues.slice(0, 5).forEach((issue, index) => {
        Logger.info(`   ${index + 1}. [${issue.score}pt] ${issue.representative_keyword} (${issue.snapshot_count}회 노출)`);
    });

    return sortedIssues;
}

// [Logic] 로컬 테스트를 위한 직접 실행 루틴
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
