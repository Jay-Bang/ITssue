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

// KST = UTC+9
// node-cron은 시스템 시간을 따르거나 timezone 옵션을 사용할 수 있습니다.
// 여기서는 명시적으로 'Asia/Seoul' 타임존을 사용합니다.
// [Critical] 시스템 타임존 설정과 무관하게 Node.js 프로세스의 타임존을 KST로 강제합니다.
// PM2 데몬이 이전 타임존 정보를 캐싱하고 있을 가능성을 배제하기 위함입니다.
process.env.TZ = 'Asia/Seoul';

const TIMEZONE = 'Asia/Seoul';

Logger.info('🚀 ITssue Automation Daemon Started');
Logger.info(`⏰ Timezone: ${TIMEZONE}`);
Logger.info(`🕰️ Current Server Time: ${new Date().toString()}`);
Logger.info('📅 Scheduled Jobs: Noon(12:05), Night(22:05), Token Refresh(1st 00:00)');

// [Logic] 관리자 패널(Admin UI) 연동을 위한 Webhook API 서버는 현재 standalone 프로세스(itssue-api)로 운영되므로 데몬에서 제외합니다.
// import './api/webhook-server';

/**
 * [Helper] 명령어 실행 제어 함수
 * 
 * [Why spawn instead of exec?]
 * - [Logic] exec은 버퍼 크기 제한(200KB)이 있어 대량 출력 시 프로세스가 중단됩니다.
 * - [Fix] spawn은 스트림 기반으로 동작하여 메모리 및 출력량 제한에서 자유롭습니다.
 * 
 * [Why pipe instead of inherit?]
 * - [Optimization] pipe로 설정 후 수동 전달해야 PM2가 로그를 정상적으로 캡처하고 파일로 남길 수 있습니다.
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

// ☀️ [Job] 정오 이슈 보드: 매일 12:05 KST
cron.schedule('5 12 * * *', () => {
    runCommand('npm run board:noon -- --publish', 'Noon Board');
}, {
    timezone: TIMEZONE
});

// 🌙 [Job] 일일 이슈 보드: 매일 22:05 KST
cron.schedule('5 22 * * *', () => {
    runCommand('npm run board:night -- --publish', 'Night Board');
}, {
    timezone: TIMEZONE
});

// 🔄 [Job] Instagram 토큰 갱신: 매월 1일 00:00 KST
cron.schedule('0 0 1 * *', () => {
    Logger.info('🔄 [Daemon] Monthly Token Refresh Job Triggered');
    runCommand('npm run refresh-token', 'Token Refresh');
}, {
    timezone: TIMEZONE
});

// 프로세스 종료 시그널 처리 (Graceful Shutdown)
process.on('SIGINT', () => {
    Logger.info('🛑 Daemon stopping...');
    process.exit(0);
});
