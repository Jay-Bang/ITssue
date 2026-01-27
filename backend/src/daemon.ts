import * as cron from 'node-cron';
import { spawn } from 'child_process';
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
 * 명령어 실행 헬퍼 함수 (개선: spawn 사용)
 * 
 * [Why spawn instead of exec?]
 * - exec은 버퍼 크기 제한(기본 200KB)이 있어 출력이 많으면 멈춤
 * - spawn은 스트림 기반으로 실시간 출력 가능
 * - npm run 같은 중첩 프로세스 처리에 더 안정적
 */
function runCommand(command: string, label: string) {
    Logger.info(`🔥 [Daemon] Starting Scheduled Job: ${label}`);
    Logger.info(`> ${command}`);

    // 프로젝트 루트 디렉토리 기준 실행
    const projectRoot = path.resolve(__dirname, '..');

    // spawn을 사용하여 실시간 출력 스트리밍
    const { spawn } = require('child_process');
    const [cmd, ...args] = command.split(' ');

    const child = spawn(cmd, args, {
        cwd: projectRoot,
        shell: true,
        stdio: 'inherit' // 부모 프로세스의 stdio를 상속받아 실시간 출력
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
