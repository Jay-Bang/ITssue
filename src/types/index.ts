/**
 * ITssue 프로젝트 공용 타입 정의
 */

/**
 * 이슈 엔티티 (랭킹 엔진 및 병합 게이트 출력)
 * 
 * 특정 키워드에 대한 집계 결과와 병합 정보를 담는 핵심 데이터 구조
 */
export interface IssueEntity {
    representative_keyword: string;    // 대표 키워드 (병합 후 최종 키워드)
    news_titles: string[];             // 수집된 모든 뉴스 제목 배열
    snapshot_count: number;            // 해당 키워드가 수집된 총 횟수
    first_seen_at: string;             // 최초 수집 시각 (UTC timestamptz)
    last_seen_at: string;              // 마지막 수집 시각 (UTC timestamptz)
    score: number;                     // 랭킹 점수 (1위=20점 기준 누적)
    raw_snapshot_ids: number[];        // 원본 스냅샷 ID 배열 (추적용)

    merge_reasons?: string[];          // 병합 사유 (JACCARD_STRONG, OVERLAP_WEAK 등)
    merged_keywords?: string[];        // 병합된 원본 키워드 리스트
    core_news_titles?: string[];       // 대표 키워드 본연의 뉴스 (Pass 2 정제용)
}

/**
 * 최종 이슈 보드 (AI 요약 완료 후 렌더링 입력)
 * 
 * Instagram 포스팅에 즉시 사용 가능한 형태로 가공된 데이터
 */
export interface FinalIssueBoard {
    representative_keyword: string;    // 대표 키워드
    news_titles: string[];             // 관련 뉴스 제목 배열
    merge_reasons?: string[];          // 병합 사유
    instagram_summary: string[];       // AI 생성 3문장 요약 (정중한 어조)
    tags: string[];                    // 해시태그 배열
    merged_keywords?: string[];        // 병합된 원본 키워드 리스트
    fallback_reason?: 'invalid_summary' | 'empty_tags' | 'llm_error' | 'batch_mismatch';

    // [Metric Updates] 분석 결과 데이터 보강
    score?: number;                    // 랭킹 엔진 합산 점수
    snapshot_count?: number;           // 기간 내 노출 횟수
    first_seen_at?: string;            // 최초 노출 시각
    last_seen_at?: string;             // 마지막 노출 시각
}

/**
 * 최종 분석 보고서 (JSON 파일 저장용)
 */
export interface AnalysisReport {
    metadata: {
        type: BoardType;               // 보드 타입
        date: string;                  // 분석 날짜 (YYYY.MM.DD)
        period: {
            start: string;             // 분석 시작 시각
            end: string;               // 분석 종료 시각
        };
        stats: {
            total_atoms: number;       // 병합 전 총 이슈 수
            merged_count: number;      // 병합 후 최종 이슈 수
            processed_at: string;      // 보고서 생성 시각
            model: string;             // 사용된 AI 모델
        };
    };
    results: FinalIssueBoard[];        // 분석 결과 리스트
}

/**
 * 보드 타입 (정오/일일/커스텀)
 */
export type BoardType = 'NOON' | 'NIGHT' | 'CUSTOM';

/**
 * 시간 범위 (분석 대상 기간)
 */
export interface TimeWindow {
    start: Date;  // 시작 시각
    end: Date;    // 종료 시각
}
