/**
 * [Logger Utility]
 * 
 * [Description] 프로젝트 전역에서 사용할 일관된 표준 로깅 인터페이스를 제공하는 유틸리티 계층입니다.
 * 
 * [Design Intent]
 * - [Logic] 정보 로그(INFO), 성공 로그(PASS), 경고 로그(WARN), 에러 로그(FAIL)를 명시적으로 구분하여 터미널 가독성을 극대화합니다.
 * - [Strategy] 이모지(Emoji) 및 성능 측정(Console Time) 기능을 통합하여 실시간 모니터링 및 병목 지점 파악에 최적화 설계했습니다.
 */
export const Logger = {
    /** [Level: INFO] 일반 정보 로그 출력 */
    info: (msg: string, ...args: any[]) => console.log(`[INFO] ${msg}`, ...args),

    /** [Level: PASS] 성공 메시지 로그 출력 (주로 ✅ 이모지와 함께 사용) */
    success: (msg: string, ...args: any[]) => console.log(`[PASS] ${msg}`, ...args),

    /** [Level: WARN] 경고 메시지 출력 (⚠️) */
    warn: (msg: string, ...args: any[]) => console.warn(`[WARN] ${msg}`, ...args),

    /** [Level: FAIL] 에러 메시지 출력 (❌) */
    error: (msg: string, ...args: any[]) => console.error(`[FAIL] ${msg}`, ...args),

    /** [Strategy] 성능 측정 시작 (성능 모니터링) */
    time: (label: string) => console.time(label),

    /** [Strategy] 성능 측정 종료 및 결과 자동 출력 */
    timeEnd: (label: string) => console.timeEnd(label)
};
