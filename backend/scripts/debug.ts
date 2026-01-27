import { Logger } from '../src/lib/logger';
import { runRankingEngine } from '../src/analysis/ranking-engine';
import { runMergeGate } from '../src/analysis/issue-merger';
import { generateAISummaries } from '../src/analysis/summary-generator';
import * as dotenv from 'dotenv';
import { TimeWindow } from '../src/types';

dotenv.config();

/**
 * [Debug Tool]
 * ITssue 프로젝트의 핵심 모듈을 개별적으로 테스트하기 위한 CLI 도구입니다.
 * Dependency: moment 제거, Native Date 사용
 */
async function main() {
    const args = process.argv.slice(2);
    const command = args[0];

    if (!command) {
        Logger.info(`
Usage:
  npm run debug rank [DATE] [TYPE]    - Test Ranking Engine
  npm run debug merge [DATE] [TYPE]   - Test Issue Merger
  npm run debug summary "KEYWORD"     - Test AI Summary Generator
  npm run debug date                  - Check Time Window Logic
        `);
        return;
    }

    try {
        switch (command) {
            case 'rank':
                await debugRanking(args[1], args[2]);
                break;
            case 'merge':
                await debugMerger(args[1], args[2]);
                break;
            case 'summary':
                await debugSummary(args[1]);
                break;
            case 'date':
                debugDate();
                break;
            default:
                Logger.error(`Unknown command: ${command}`);
        }
    } catch (error) {
        Logger.error('Debug execution failed', error);
    }
}

/**
 * [Logic] 오케스트레이터의 calculateTimeWindow 로직을 모방하여 디버깅용 윈도우 생성
 * [Enhanced] ISO 문자열 2개가 들어오면 Custom Range로 처리
 */
function getWindow(arg1?: string, arg2?: string): { window: TimeWindow, label: string } {
    // 1. Custom Time Range Check (ISO 8601 format check: "YYYY-MM-DDTHH:mm:ss")
    const isISODate = (str?: string) => str && str.includes('T') && !isNaN(Date.parse(str));

    if (arg1 && arg2 && isISODate(arg1) && isISODate(arg2)) {
        const start = new Date(arg1);
        const end = new Date(arg2);
        return {
            window: { start, end },
            label: `Custom Range`
        };
    }

    // 2. Preset Mode (Date + Type)
    const dateStr = arg1;
    const typeStr = arg2 || 'NOON';
    const type = (typeStr.toUpperCase() === 'NIGHT' ? 'NIGHT' : 'NOON') as 'NOON' | 'NIGHT';

    // Default to today if no date provided
    let now = new Date();

    // If specific date provided (YYYY-MM-DD), set 'now' to that date
    if (dateStr) {
        const [y, m, d] = dateStr.split('-').map(Number);
        // Set 'now' to 12:00 or 22:00 KST of that day to simulate run time
        // KST is UTC+9. So 12:00 KST is 03:00 UTC, 22:00 KST is 13:00 UTC
        const utcHour = type === 'NOON' ? 3 : 13;
        now = new Date(Date.UTC(y, m - 1, d, utcHour, 0, 0, 0));
    }

    // Logic from orchestrator.ts
    // 9시간 오프셋 적용 (KST 기준 계산을 위해 가상의 Date 객체 생성)
    const kstShift = 9 * 60 * 60 * 1000;
    const kstNow = new Date(now.getTime() + kstShift);
    const kYear = kstNow.getUTCFullYear();
    const kMonth = kstNow.getUTCMonth();
    const kDate = kstNow.getUTCDate();

    let start: Date;
    let end: Date;

    if (type === 'NOON') {
        // [Logic] 정오 이슈: 당일 12:00 KST (03:00 UTC)까지의 데이터
        end = new Date(Date.UTC(kYear, kMonth, kDate, 3, 0, 0, 0));
        start = new Date(end.getTime());
        start.setUTCDate(start.getUTCDate() - 1);
        start.setUTCHours(13, 0, 0, 0); // 전일 22:00 KST (13:00 UTC)
    } else {
        // [Logic] 일일 이슈: 당일 22:00 KST (13:00 UTC)까지의 24시간 데이터
        end = new Date(Date.UTC(kYear, kMonth, kDate, 13, 0, 0, 0));
        start = new Date(end.getTime());
        start.setUTCDate(start.getUTCDate() - 1); // 정확히 24시간 전
    }

    return {
        window: { start, end },
        label: `${kYear}-${String(kMonth + 1).padStart(2, '0')}-${String(kDate).padStart(2, '0')} (${type})`
    };
}

async function debugRanking(arg1?: string, arg2?: string) {
    const { window, label } = getWindow(arg1, arg2);

    Logger.info(`🧪 [DEBUG: Ranking] Target: ${label}`);
    Logger.info(`   Window (UTC): ${window.start.toISOString()} ~ ${window.end.toISOString()}`);

    // [Corrected] Using functional import
    const rankedIssues = await runRankingEngine({ start: window.start, end: window.end });

    Logger.info(`✅ Top 20 Ranked Issues:`);
    rankedIssues.slice(0, 20).forEach((issue: any, idx: number) => {
        Logger.info(`${String(idx + 1).padStart(2, '0')}. ${issue.keyword} (${issue.total_score}pt) - Articles: ${issue.articles.length}`);
    });
}

async function debugMerger(arg1?: string, arg2?: string) {
    const { window, label } = getWindow(arg1, arg2);

    Logger.info(`🧪 [DEBUG: Merger] Target: ${label}`);
    Logger.info(`   Window (UTC): ${window.start.toISOString()} ~ ${window.end.toISOString()}`);

    // [Corrected] Using functional import. runMergeGate internally runs ranking if needed, or we pass window.
    // However, runMergeGate actually takes 'window' and calls ranking internally.
    // Let's check runMergeGate signature usage in orchestrator.ts:
    // const allMergedIssues = await runMergeGate(window);

    const mergedIssues = await runMergeGate(window);

    Logger.info(`✅ Merged Issues (Top 10):`);
    mergedIssues.slice(0, 10).forEach((issue: any, idx: number) => {
        Logger.info(`\n[${idx + 1}] Representative: "${issue.representative_keyword}" (Score: ${issue.score})`);
        Logger.info(`    Merged: [${issue.merged_keywords?.join(', ')}]`);
        Logger.info(`    Sources: ${issue.news_titles?.length} articles`);
    });
}

async function debugSummary(keyword: string) {
    if (!keyword) {
        Logger.error('Keyword is required. Usage: npm run debug summary "KEYWORD"');
        return;
    }

    Logger.info(`🧪 [DEBUG: Summary] Generating summary for: "${keyword}"`);

    const mockIssue: any = {
        representative_keyword: keyword,
        score: 1000,
        news_titles: [`${keyword} 관련 최근 뉴스`, `${keyword} 이슈 분석`],
        merged_keywords: [keyword],
        snapshot_count: 10,
        first_seen_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString()
    };

    // [Corrected] Using functional import
    const results = await generateAISummaries([mockIssue]);
    const result = results[0];

    if (result) {
        Logger.info('\n=============================================');
        Logger.info(`📢 Keyword: ${result.representative_keyword}`);
        Logger.info('---------------------------------------------');
        Logger.info(`📝 3-Line Summary:\n${result.instagram_summary.join('\n')}`);
        Logger.info('---------------------------------------------');
        Logger.info(`🏷️  Tags: ${result.tags.join(', ')}`);
        Logger.info('=============================================\n');
    } else {
        Logger.error('Failed to generate summary.');
    }
}

function debugDate() {
    Logger.info('🧪 [DEBUG: Date Logic Check]');
    const now = new Date();
    Logger.info(`Current: ${now.toISOString()} (System Local)`);

    const types = ['NOON', 'NIGHT'];

    types.forEach(type => {
        const { window, label } = getWindow(undefined, type);
        Logger.info(`\n[${type} Logic] Target: ${label}`);
        Logger.info(`   Start (UTC): ${window.start.toISOString()}`);
        Logger.info(`   End   (UTC): ${window.end.toISOString()}`);

        // KST 변환 확인용
        const kstStart = new Date(window.start.getTime() + 9 * 60 * 60 * 1000).toISOString().replace('Z', '(KST)');
        const kstEnd = new Date(window.end.getTime() + 9 * 60 * 60 * 1000).toISOString().replace('Z', '(KST)');
        Logger.info(`   Start (KST): ${kstStart}`);
        Logger.info(`   End   (KST): ${kstEnd}`);
    });
}

main().catch(err => Logger.error(err));
