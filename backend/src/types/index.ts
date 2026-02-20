/**
 * [ITssue Core Type Definitions]
 * 
 * [Description] 프로젝트 전역에서 공유되는 핵심 데이터 인터페이스 및 타입을 관리하는 정적 정의 계층입니다.
 * 
 * [Design Intent]
 * - [Logic] 데이터 흐름(Data Flow) 단계에 따른 인터페이스 계층화 (Snapshot -> Entity -> Board).
 * - [Strategy] 분석 메타데이터와 실제 결과물을 분리하여 리포팅 가독성 및 사후 감사(Audit) 편의성을 제공합니다.
 */

/**
 * [Logic] 이슈 엔티티 (랭킹 엔진 및 병합 프로세스 출력 규격)
 * 
 * [Description] 특정 키워드에 대한 시계열 집계 결과와 클러스터링 병합 정보를 담는 핵심 데이터 구조입니다.
 */
export interface IssueEntity {
    /** [Data] 대표 키워드 (병합 후 최종 키워드) */
    representative_keyword: string;
    /** [Data] 수집된 모든 뉴스 제목 배열 */
    news_titles: string[];
    /** [Data] 해당 키워드가 수집된 총 횟수 */
    snapshot_count: number;
    /** [Data] 최초 수집 시각 (UTC timestamptz) */
    first_seen_at: string;
    /** [Data] 마지막 수집 시각 (UTC timestamptz) */
    last_seen_at: string;
    /** [Data] 랭킹 점수 (1위=20점 기준 누적) */
    score: number;
    /** [Data] 원본 스냅샷 ID 배열 (추적용) */
    raw_snapshot_ids: number[];

    /** [Logic] 병합 사유 (JACCARD_STRONG, OVERLAP_WEAK 등) */
    merge_reasons?: string[];
    /** [Logic] 병합된 원본 키워드 리스트 */
    merged_keywords?: string[];
    /** [Logic] 대표 키워드 본연의 뉴스 (Pass 2 정제용) */
    core_news_titles?: string[];
}

/**
 * [Logic] 최종 이슈 보드 (AI 요약 완료 후 렌더링 엔진 입력 규격)
 * 
 * [Description] 소셜 미디어 포스팅 및 카드 뉴스 생성에 최적화된 형태로 정제된 이슈 데이터입니다.
 */
export interface FinalIssueBoard {
    /** [Data] 대표 키워드 */
    representative_keyword: string;
    /** [Data] 관련 뉴스 제목 배열 */
    news_titles: string[];
    /** [NEW] 이슈 순위 (1~10) */
    rank?: number;
    /** [Logic] 병합 사유 */
    merge_reasons?: string[];
    /** [Logic] AI 생성 3문장 요약 (정중한 어조) */
    instagram_summary: string[];
    /** [Logic] 해시태그 배열 */
    tags: string[];
    /** [Logic] 병합된 원본 키워드 리스트 */
    merged_keywords?: string[];
    /** [Safety] 생성 실패 시 사유 */
    fallback_reason?: 'invalid_summary' | 'empty_tags' | 'llm_error' | 'batch_mismatch';

    // [Metric Updates] 분석 결과 데이터 보강
    /** [Data] 랭킹 엔진 합산 점수 */
    score?: number;
    /** [Data] 기간 내 노출 횟수 */
    snapshot_count?: number;
    /** [Data] 최초 노출 시각 */
    first_seen_at?: string;
    /** [Data] 마지막 노출 시각 */
    last_seen_at?: string;
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
