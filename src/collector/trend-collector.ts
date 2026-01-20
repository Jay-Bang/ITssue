import axios from 'axios';
import { supabase } from '../db/supabase-client';
import { Logger } from '../lib/logger';

const TREND_API_URL = 'https://api.trendwidget.app/trending-keywords';

/**
 * 타임존 정규화 헬퍼: 
 * API에서 오는 KST 시각 문자열에 명시적으로 오프셋을 붙여 
 * Supabase(timestamptz)가 정확한 절대 시각(UTC)을 인식하게 함.
 */
function normalizeKstTimestamp(raw: string): string {
    // ⚠️ 주의: timestamp는 여기서 Date 객체로 변환하지 않습니다.
    // API timestamp는 KST 의미를 가지며, 문자열 끝에 '+09:00'을 붙여줌으로써
    // Supabase(timestamptz)가 이를 '진짜 KST'로 인식하고 DB에는 표준 UTC로 정확히 저장하게 유도합니다.
    if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) {
        return raw;
    }
    // 없으면 KST(+09:00) 명시
    return `${raw}+09:00`;
}

/**
 * 실시간 검색어 순위 스냅샷 수집 및 저장 모듈
 * 
 * [데이터 소스]
 * - 10분마다 TOP 20 검색어 순위를 수집
 * - 각 검색어마다 대표 뉴스 1개(제목, URL, 썸네일)가 포함됨
 * 
 * [저장 구조]
 * - raw_trends: API 응답 전체를 JSON으로 보관
 * - trend_snapshots: 각 검색어를 개별 행으로 Flatten하여 시계열 분석 가능하게 저장
 */
/**
 * 실시간 검색어 순위 스냅샷 수집 및 저장 모듈
 * 
 * [데이터 소스]
 * - 10분마다 TOP 20 검색어 순위를 수집
 * - 각 검색어마다 대표 뉴스 1개(제목, URL, 썸네일)가 포함됨
 * 
 * [저장 구조]
 * - raw_trends: API 응답 전체를 JSON으로 보관
 * - trend_snapshots: 각 검색어를 개별 행으로 Flatten하여 시계열 분석 가능하게 저장
 */
export async function fetchAndStoreTrends() {
    Logger.info(`Starting trend fetch...`);

    try {
        // 1. Fetch from External API
        const response = await axios.get(TREND_API_URL);
        const apiData = response.data;

        if (!apiData.success || !apiData.data) {
            Logger.error('API returned unsuccessful response', apiData);
            return;
        }

        // 2. Timezone Normalization (KST -> UTC)
        const { timestamp: rawTimestamp, ranked_keywords } = apiData.data;
        const timestamp = normalizeKstTimestamp(rawTimestamp);

        // 3. Duplication Check (Idempotency)
        // 이미 해당 시각의 데이터가 수집되었는지 확인하여 중복 적재 방지
        const { data: existingData, error: checkError } = await supabase
            .from('raw_trends')
            .select('id')
            .eq('timestamp', timestamp);

        if (checkError) {
            Logger.error('Supabase raw_trends check error', checkError);
            return;
        }
        if (existingData && existingData.length > 0) {
            Logger.info(`Skip: Data for ${timestamp} already exists.`);
            return;
        }

        // 4. Insert Raw Data
        // API 원본 응답을 raw_trends 테이블에 통째로 저장 (Audit/Debugging 용도)
        const { data: rawData, error: rawError } = await supabase
            .from('raw_trends')
            .insert([{ timestamp, raw_data: apiData.data }])
            .select('id')
            .single();

        if (rawError) {
            Logger.error('Supabase raw_trends insert error', rawError);
            return;
        }

        const rawTrendId = rawData.id;
        Logger.success(`Successfully stored raw trends (ID: ${rawTrendId}) for ${timestamp}`);

        // 5. Flatten & Insert Snapshots
        // Raw JSON은 분석이 어려우므로, 개별 키워드 단위로 행(Row)을 분리하여 trend_snapshots에 저장
        // 이 데이터가 추후 Ranking Engine의 입력값이 됨
        if (ranked_keywords && Array.isArray(ranked_keywords)) {
            const snapshots = ranked_keywords.map((item: any) => ({
                raw_trend_id: rawTrendId,
                timestamp: timestamp,
                keyword: item.keyword,
                rank: item.rank,
                is_rising: item.isRising,
                news_title: item.news?.title,
                news_url: item.news?.url,
                thumbnail_url: (item.news?.thumbnail === '썸네일 없음' || !item.news?.thumbnail) ? null : item.news.thumbnail,
            }));

            if (snapshots.length > 0) {
                const { error: snapshotError } = await supabase
                    .from('trend_snapshots')
                    .insert(snapshots);

                if (snapshotError) {
                    Logger.error('Supabase trend_snapshots insert error', snapshotError);
                } else {
                    Logger.success(`Successfully stored ${snapshots.length} snapshots`);
                }
            }
        }

    } catch (err) {
        Logger.error('Error in fetchAndStoreTrends', err);
    }
}

// 로컬 테스트를 위한 직접 실행 로직
if (require.main === module) {
    fetchAndStoreTrends()
        .then(() => {
            Logger.info('Collection completed.');
            process.exit(0);
        })
        .catch(err => {
            Logger.error('Collection failed', err);
            process.exit(1);
        });
}
