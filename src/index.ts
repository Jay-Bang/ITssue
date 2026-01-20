import { Logger } from './lib/logger';
import * as dotenv from 'dotenv';
import { runOrchestrator } from './analysis/orchestrator';
import { BoardType } from './types';

dotenv.config();

/**
 * ITssue-AI Entry Point
 * 
 * [역할]
 * 프로젝트의 메인 진입점으로, 커맨드라인 인자를 파싱하여 오케스트레이터를 실행합니다.
 * 
 * [사용법]
 * - `npm start` 또는 `ts-node src/index.ts [BOARD_TYPE] [--publish]`
 * - BOARD_TYPE: NOON | NIGHT | CUSTOM (기본값: NOON)
 * - --publish: 인스타그램 자동 게시 플래그 (선택)
 * 
 * [예시]
 * - `npm start NIGHT --publish`: 일일 보드 생성 및 인스타그램 게시
 * - `npm start NOON`: 정오 보드 생성만 수행 (게시 안 함)
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
