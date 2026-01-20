/**
 * Logger 유틸리티
 * 
 * [역할]
 * 프로젝트 전역에서 사용할 일관된 로깅 인터페이스를 제공합니다.
 * 
 * [특징]
 * - 이모지를 활용한 가독성 향상
 * - 시간 측정 기능 (time/timeEnd)
 * - 로그 레벨별 구분 (info, success, warn, error)
 */
export const Logger = {
    /** 일반 정보 로그 출력 */
    info: (msg: string, ...args: any[]) => console.log(`[INFO] ${msg}`, ...args),

    /** 성공 메시지 로그 출력 (주로 ✅ 이모지와 함께 사용) */
    success: (msg: string, ...args: any[]) => console.log(`[PASS] ${msg}`, ...args),

    /** 경고 메시지 로그 출력 (주로 ⚠️ 이모지와 함께 사용) */
    warn: (msg: string, ...args: any[]) => console.warn(`[WARN] ${msg}`, ...args),

    /** 에러 메시지 로그 출력 (주로 ❌ 이모지와 함께 사용) */
    error: (msg: string, ...args: any[]) => console.error(`[FAIL] ${msg}`, ...args),

    /** 시간 측정 시작 (성능 모니터링용) */
    time: (label: string) => console.time(label),

    /** 시간 측정 종료 및 결과 출력 */
    timeEnd: (label: string) => console.timeEnd(label)
};
