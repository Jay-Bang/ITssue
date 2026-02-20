import axios from 'axios';
import { supabase } from '../db/supabase-client';
import { Logger } from '../lib/logger';

const TREND_API_URL = 'https://api.trendwidget.app/trending-keywords';

/**
 * [Timezone Normalization Helper]
 * 
 * [Logic] API에서 오는 KST 시각 문자열에 명시적으로 오프셋을 붙여 
 * Supabase(timestamptz)가 정확한 절대 시각(UTC)을 인식하게 함으로써 데이터 일관성을 확보합니다.
 */
function normalizeKstTimestamp(raw: string): string {
    // [Safety] 이미 오프셋이 포함된 경우 변환하지 않고 그대로 반환합니다.
    if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) {
        return raw;
    }
    // [Logic] 오프셋 정보가 없으면 KST(+09:00)를 명시적으로 부여합니다.
    return `${raw}+09:00`;
}

/**
 * [Trend Data Collector]
 * 
 * [Description] 외부 API로부터 실시간 급상승 검색어 데이터를 수집하여 Supabase에 적재합니다.
 * 
 * [Design Intent]
 * - [Strategy] 10분 주기 스냅샷 수집을 통한 트렌드 시계열 데이터 확보.
 * - [Logic] 타임존 정규화(`KST -> UTC`)를 통한 데이터 무결성 유지.
 * - [Architecture] 원본 JSON(`raw_trends`)과 정규화된 개별 키워드(`trend_snapshots`)를 분리 저장하여 유연한 분석 환경을 제공합니다.
 */
export async function fetchAndStoreTrends() {
    Logger.info(`[Collector] Starting trend fetch...`);

    try {
        // [Step 1] 외부 Trend API로부터 데이터 인출
        const response = await axios.get(TREND_API_URL);
        const apiData = response.data;

        if (!apiData.success || !apiData.data) {
            Logger.error('API returned unsuccessful response', apiData);
            return;
        }

        // [Step 2] 시점 정규화 및 수집 유효성 검사
        const { timestamp: rawTimestamp, ranked_keywords } = apiData.data;
        const timestamp = normalizeKstTimestamp(rawTimestamp);

        // [Step 3] 멱등성(Idempotency) 보장: 중복 수집 방지
        // [Logic] 동일한 시점의 스냅샷이 이미 존재한다면 중복 적재를 방지하여 통계 왜곡을 차단합니다.
        const { data: existingData, error: checkError } = await supabase
            .from('raw_trends')
            .select('id')
            .eq('timestamp', timestamp);

        if (checkError) {
            Logger.error('[Database] Trend check error', checkError);
            return;
        }
        if (existingData && existingData.length > 0) {
            Logger.info(`[Collector] Skip: Data for ${timestamp} already exists.`);
            return;
        }

        // [Step 4] 원본 데이터 저장 (Raw Trend Audit)
        const { data: rawData, error: rawError } = await supabase
            .from('raw_trends')
            .insert([{ timestamp, raw_data: apiData.data }])
            .select('id')
            .single();

        if (rawError) {
            Logger.error('[Database] raw_trends insert error', rawError);
            return;
        }

        const rawTrendId = rawData.id;
        Logger.success(`[Collector] Successfully stored raw trends (ID: ${rawTrendId})`);

        // [Step 5] 데이터 평탄화(Flattening) 및 개별 키워드 저장
        if (ranked_keywords && Array.isArray(ranked_keywords)) {
            const snapshots = ranked_keywords.map((item: any) => ({
                raw_trend_id: rawTrendId, // 원본 로그와 연결 (Audit Trail)
                timestamp: timestamp,
                keyword: item.keyword,
                rank: item.rank,
                is_rising: item.isRising,
                news_title: item.news?.title,
                news_url: item.news?.url,
                // [Logic] '썸네일 없음' 문자열이 들어오는 경우 null로 치환하여 DB 가독성 확보
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

        /** [Logic] 실행 에러 핸들러 */
    } catch (err: any) {
        Logger.error('[Collector] Fatal error in fetchAndStoreTrends', err.message);
    }
}

// [Logic] 로컬 테스트를 위한 실행 진입점
if (require.main === module) {
    fetchAndStoreTrends()
        .then(() => {
            Logger.info('[Collector] Routine completed.');
            process.exit(0);
        })
        .catch(err => {
            Logger.error('[Collector] Emergency abort', err);
            process.exit(1);
        });
}
