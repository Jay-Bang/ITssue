import { Logger } from './lib/logger';
import * as dotenv from 'dotenv';
import { runOrchestrator } from './analysis/orchestrator';
import { BoardType } from './types';

dotenv.config();

/**
 * [ITssue-AI Entry Point]
 * 
 * [Description] 트렌드 분석 파이프라인의 실행을 관리하는 메인 엔트리 포인트입니다.
 * 
 * [Design Intent]
 * - 커맨드라인 인자를 통해 정오/일일/커스텀 보드 생성 및 발행 여부를 유연하게 제어.
 * - 프로젝트의 모든 자율 운영 로직이 시작되는 최상격 계층.
 * 
 * [Usage]
 * - `npm start [BOARD_TYPE] [--publish]`
 * - BOARD_TYPE: NOON | NIGHT | CUSTOM (Default: NOON)
 * - --publish: 인스타그램 자동 게시 플래그 (Optional)
 */
async function main() {
    Logger.info('🚀 ITssue-AI Edition starting...');
    const args = process.argv.slice(2);

    // Command line argument processing
    const inputType = args[0]?.toUpperCase();
    let type: BoardType = 'NOON';

    // 보드 타입 검증 및 설정
    if (inputType === 'NIGHT' || inputType === 'NOON' || inputType === 'CUSTOM') {
        type = inputType as BoardType;
    }

    const shouldPublish = args.includes('--publish');

    // [New Feature] CLI Date Parsing (Universal)
    // [Logic] 입력된 날짜 개수에 따라 Target Date(1개) 또는 Date Range(2개)를 결정합니다.
    let startKST: Date | undefined;
    let endKST: Date | undefined;

    // Filter out flags and the type argument itself to find date strings
    const potentialDates = args.filter(arg => !arg.startsWith('--') && arg.toUpperCase() !== 'CUSTOM' && arg.toUpperCase() !== 'NOON' && arg.toUpperCase() !== 'NIGHT');

    if (potentialDates.length > 0) {
        const d1 = new Date(potentialDates[0]);
        if (!isNaN(d1.getTime())) {
            startKST = d1;

            if (potentialDates.length >= 2) {
                const d2 = new Date(potentialDates[1]);
                if (!isNaN(d2.getTime())) {
                    endKST = d2;
                    Logger.info(`📅 Date Range Detected: ${startKST.toISOString()} ~ ${endKST.toISOString()}`);
                }
            } else {
                Logger.info(`📅 Target Date Detected: ${startKST.toISOString()}`);
            }
        } else {
            Logger.warn('⚠️ Invalid date format provided. Ignoring dates.');
        }
    }

    Logger.info(`📋 Board Type: ${type}, Publish: ${shouldPublish ? 'Yes' : 'No'}`);

    await runOrchestrator(type, shouldPublish, startKST, endKST);
}

main().catch(err => {
    Logger.error('Fatal error in index.ts', err);
    console.error(err);
    process.exit(1);
});
