/**
 * [Admin Logger Utility]
 * 
 * [Description] 관리자 도구(Frontend) 전역에서 사용할 일관된 로깅 인터페이스를 제공합니다.
 * 
 * [Design Intent]
 * - Backend Logger와 동일한 인터페이스(info, success, warn, error)를 유지하여 개발 경험 통일.
 * - 브라우저 콘솔에서 시각적으로 구분 가능한 로그 출력.
 */
export const Logger = {
    /** [Level: INFO] 일반 정보 로그 출력 */
    info: (msg: string, ...args: unknown[]) => console.log(`[INFO] ${msg}`, ...args),

    /** [Level: PASS] 성공 메시지 로그 출력 */
    success: (msg: string, ...args: unknown[]) => console.log(`[PASS] ${msg}`, ...args),

    /** [Level: WARN] 경고 메시지 로그 출력 */
    warn: (msg: string, ...args: unknown[]) => console.warn(`[WARN] ${msg}`, ...args),

    /** [Level: FAIL] 에러 메시지 로그 출력 */
    error: (msg: string, ...args: unknown[]) => console.error(`[FAIL] ${msg}`, ...args),
};
