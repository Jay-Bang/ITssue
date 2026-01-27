import * as cron from 'node-cron';
import { exec } from 'child_process';
import { Logger } from './lib/logger';
import * as path from 'path';

/**
 * [ITssue Automation Daemon]
 * 
 * [Description] VPS 환경에서 상주하며 정해진 시간(KST)에 파이프라인을 실행합니다.
 * PM2 등의 프로세스 매니저를 통해 실행하는 것을 권장합니다.
 */

// KST = UTC+9
// node-cron은 시스템 시간을 따르거나 timezone 옵션을 사용할 수 있습니다.
// 여기서는 명시적으로 'Asia/Seoul' 타임존을 사용합니다.
const TIMEZONE = 'Asia/Seoul';

Logger.info('🚀 ITssue Automation Daemon Started');
Logger.info(`⏰ Timezone: ${TIMEZONE}`);
Logger.info('📅 Scheduled Jobs: Noon(12:00), Night(22:00)');

// 🕊️ [New] Start Webhook API Server for Admin Panel integration
import './api/webhook-server';

/**
 * 명령어 실행 헬퍼 함수
 */
function runCommand(command: string, label: string) {
    Logger.info(`🔥 [Daemon] Starting Scheduled Job: ${label}`);
    Logger.info(`> ${command}`);

    // 프로젝트 루트 디렉토리 기준 실행
    const projectRoot = path.resolve(__dirname, '..');

    exec(command, { cwd: projectRoot }, (error, stdout, stderr) => {
        if (error) {
            Logger.error(`❌ [Daemon] Job Failed: ${label}`, error);
            return;
        }
        if (stderr) {
            // stderr가 있어도 에러가 아닐 수 있음 (경고 메시지 등)
            // 하지만 분석을 위해 로그에는 남김
            console.error(`[Stderr] ${stderr}`);
        }

        console.log(stdout);
        Logger.info(`✅ [Daemon] Job Completed: ${label}`);
    });
}

// ☀️ 정오 이슈 보드: 매일 12:00 KST
cron.schedule('0 12 * * *', () => {
    runCommand('npm run board:noon -- --publish', 'Noon Board');
}, {
    timezone: TIMEZONE
});

// 🌙 일일 이슈 보드: 매일 22:00 KST
cron.schedule('0 22 * * *', () => {
    runCommand('npm run board:night -- --publish', 'Night Board');
}, {
    timezone: TIMEZONE
});

// 프로세스 종료 시그널 처리 (Graceful Shutdown)
process.on('SIGINT', () => {
    Logger.info('🛑 Daemon stopping...');
    process.exit(0);
});
