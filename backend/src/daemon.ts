import * as cron from 'node-cron';
import { spawn } from 'child_process';
import { Logger } from './lib/logger';
import * as path from 'path';

/**
 * [ITssue Automation Daemon]
 * 
 * [Description] VPS 환경에서 상주하며 정해진 시간(KST)에 파이프라인을 실행하는 자동화 데몬입니다.
 * 
 * [Design Intent]
 * - PM2 프로세스 매니저와 연동하여 실시간 로그를 보존하고 자동 재시작을 지원합니다.
 * - 정오/일일 보드 생성뿐만 아니라 관리자 제어용 Webhook 서버를 동시에 구동합니다.
 */

// [Logic] 타임존 정규화 (KST = UTC+9)
// - node-cron은 시스템 시간을 따르거나 timezone 옵션을 사용할 수 있습니다.
// - Asia/Seoul 타임존을 명시적으로 선언하여 서버 환경에 무관하게 정시 실행을 보장합니다.
// - [Critical] PM2 프로세스 매니저 및 시스템 타임존 캐싱 이슈를 방지하기 위해 TZ 환경변수를 강제 설정합니다.
process.env.TZ = 'Asia/Seoul';

const TIMEZONE = 'Asia/Seoul';

Logger.info('🚀 ITssue Automation Daemon Started');
Logger.info(`⏰ Timezone: ${TIMEZONE}`);
Logger.info(`🕰️ Current Server Time: ${new Date().toString()}`);
Logger.info('📅 Scheduled Jobs: Noon(11:50), Night(20:50), Token Refresh(1st 00:00)');

// [Logic] 관리자 패널(Admin UI) 연동을 위한 Webhook API 서버는 현재 standalone 프로세스(itssue-api)로 운영되므로 데몬에서 제외합니다.
// import './api/webhook-server';

/**
 * [Logic] 외부 자식 프로세스 실행 제어 (Scheduling Utility)
 * 
 * [Strategy]
 * - [Why spawn instead of exec?] exec은 고정된 버퍼 크기 제한(200KB)이 있어 파이프라인 로그 수집 중 프로세스가 중단될 위험이 있습니다.
 * - [Fix] spawn은 스트림(Stream) 기반으로 동작하며 메모리 및 출력량 임계치에서 자유롭습니다.
 * - [Optimization] stdio: 'pipe' 설정을 통해 PM2가 비동기 로그를 정상적으로 캡처하고 파일로 아카이빙할 수 있도록 설계했습니다.
 */
function runCommand(command: string, label: string) {
    Logger.info(`🔥 [Daemon] Starting Scheduled Job: ${label}`);
    Logger.info(`> ${command}`);

    // [Step] 프로젝트 루트 디렉토리 결정 및 명령어 파싱
    const projectRoot = path.resolve(__dirname, '..');

    const [cmd, ...args] = command.split(' ');

    const child = spawn(cmd, args, {
        cwd: projectRoot,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'] // stdin 무시, stdout/stderr 파이프
    });

    // [Step] 실시간 표준 출력(stdout) 및 에러 출력(stderr) 전달
    child.stdout?.on('data', (data) => {
        process.stdout.write(data);
    });

    child.stderr?.on('data', (data) => {
        process.stderr.write(data);
    });

    child.on('error', (error: Error) => {
        Logger.error(`❌ [Daemon] Job Failed to Start: ${label}`, error);
    });

    child.on('exit', (code: number | null, signal: string | null) => {
        if (code === 0) {
            Logger.success(`✅ [Daemon] Job Completed: ${label}`);
        } else {
            Logger.error(`❌ [Daemon] Job Failed: ${label} (Exit Code: ${code}, Signal: ${signal})`);
        }
    });
}

// ☀️ [Job] 정오 이슈 보드: 매일 11:50 KST
cron.schedule('50 11 * * *', () => {
    Logger.info('⏰ Triggering Noon Board Generation...');
    runCommand('npm run board:noon -- --publish', 'Noon Board');
}, {
    timezone: "Asia/Seoul"
});

// 🌙 [Job] 일일 이슈 보드: 매일 20:50 KST
cron.schedule('50 20 * * *', () => {
    Logger.info('⏰ Triggering Night Board Generation...');
    runCommand('npm run board:night -- --publish', 'Night Board');
}, {
    timezone: "Asia/Seoul"
});

// 🔄 [Job] Meta (Instagram & Threads) 토큰 정기 갱신: 매월 1일 00:00 KST
cron.schedule('0 0 1 * *', async () => {
    Logger.info('🔄 [Daemon] Monthly Token Refresh Job Triggered');

    // [Step 1] Instagram용 Long-lived Token 갱신 (id=1)
    // runCommand('npm run refresh-token', 'Instagram Token Refresh');

    // [Step 2] Threads용 Long-lived Token 갱신 (id=2)
    // [Safety] 동시 요청으로 인한 충돌을 방지하기 위해 30초의 간격을 두고 실행합니다.
    setTimeout(() => {
        runCommand('npm run refresh-token -- --threads', 'Threads Token Refresh');
    }, 30000);
}, {
    timezone: TIMEZONE
});

// ❤️ [Job] Heartbeat: 매시 정각마다 데몬 상태 로깅 (생존 확인용)
cron.schedule('0 * * * *', () => {
    Logger.info(`❤️ [Daemon] Heartbeat - Alive at ${new Date().toLocaleString('ko-KR', { timeZone: TIMEZONE })}`);
}, {
    timezone: TIMEZONE
});

// [Safety] 프로세스 종료 시그널(SIGINT) 수신 시 Graceful Shutdown 처리
process.on('SIGINT', () => {
    Logger.info('🛑 [Daemon] Stopping automation services...');
    process.exit(0);
});
