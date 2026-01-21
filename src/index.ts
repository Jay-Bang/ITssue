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

    Logger.info(`📋 Board Type: ${type}, Publish: ${shouldPublish ? 'Yes' : 'No'}`);

    await runOrchestrator(type, shouldPublish);
}

main().catch(err => {
    Logger.error('Fatal error in index.ts', err);
    console.error(err);
    process.exit(1);
});
