import { Logger } from '../lib/logger';
import { IssueEntity, FinalIssueBoard, BoardType, TimeWindow, AnalysisReport } from '../types';
import { runMergeGate } from './issue-merger';
import { generateAISummaries } from './summary-generator';
import { renderCard, closeBrowser } from '../visual/card-renderer';
import { supabase } from '../db/supabase-client';
import { uploadInstagramImages } from '../publish/storage-manager';
import { InstagramPublisher } from '../publish/instagram-publisher';
import * as Handlebars from 'handlebars';
import * as path from 'path';
import * as fs from 'fs-extra';

interface RenderIssue {
    rank: number;
    keyword: string;
    summary: string[];
    subKeywords: string[];
    score: number;
}

const TOP_N_ISSUES = 10;

export async function runOrchestrator(type: BoardType, shouldPublish: boolean = false, customStart?: Date, customEnd?: Date) {
    const totalStart = Date.now();
    Logger.info(`🌟 [ITssue-AI] starting [${type}] Generation Pipeline...`);

    try {
        const now = new Date();
        const window = calculateTimeWindow(type, now, customStart, customEnd);

        const dateStr = window.end.toISOString().split('T')[0].replace(/-/g, '.');
        const timeSuffix = now.toTimeString().split(' ')[0].replace(/:/g, '');
        const outputTag = type === 'CUSTOM' ? `${dateStr}_CUSTOM_${timeSuffix}` : `${dateStr}_${type}`;
        const SELECTED_THEME = 'violet-bloom';

        Logger.info(`📅 Analysis Window: ${window.start.toISOString()} ~ ${window.end.toISOString()}`);

        const allMergedIssues = await runMergeGate(window);

        if (allMergedIssues.length === 0) {
            Logger.warn(`⚠️ No issues found for ${type} cycle within the window.`);
            Logger.info(`   Start: ${window.start.toISOString()}`);
            Logger.info(`   End: ${window.end.toISOString()}`);
            return;
        }

        const topIssues = allMergedIssues
            .sort((a, b) => b.score - a.score)
            .slice(0, TOP_N_ISSUES);
        const summaries = await generateAISummaries(topIssues);

        const report: AnalysisReport = {
            metadata: {
                type,
                date: dateStr,
                period: {
                    start: window.start.toISOString(),
                    end: window.end.toISOString()
                },
                stats: {
                    total_atoms: allMergedIssues.length,
                    merged_count: summaries.length,
                    processed_at: new Date().toISOString(),
                    model: process.env.CLOUD_AI_MODEL || 'unknown'
                }
            },
            results: summaries
        };

        const outputDir = path.join(__dirname, `../../output/${outputTag}`);
        await fs.ensureDir(outputDir);

        const rawJsonPath = path.join(outputDir, `results_${type}_${dateStr}.json`);
        await fs.writeJson(rawJsonPath, report, { spaces: 2 });
        Logger.info(`💾 Enhanced report saved to: ${rawJsonPath}`);

        let boardId: string | null = null;
        try {
            Logger.info("📝 Registering audit log to Supabase...");
            boardId = await recordAuditLog(type, window, summaries, topIssues);
            Logger.success(`Audit Log registered. (Board ID: ${boardId})`);
        } catch (e) {
            Logger.warn("Failed to register audit log to Supabase", e);
        }

        let generatedCaption = '';
        try {
            Logger.info("✍️ Generating Instagram caption...");
            generatedCaption = await generateInstagramCaption(type, dateStr, summaries);
            const captionPath = path.join(outputDir, `caption_${type}_${dateStr}.txt`);
            await fs.writeFile(captionPath, generatedCaption, 'utf-8');
            Logger.success(`Caption saved to: ${captionPath}`);
        } catch (e) {
            Logger.error("Failed to generate Instagram caption", e);
        }

        const renderIssues: RenderIssue[] = topIssues.map((iss, idx) => {
            const sum = summaries.find(s => s.representative_keyword === iss.representative_keyword);
            return {
                rank: idx + 1,
                keyword: iss.representative_keyword,
                summary: sum?.instagram_summary || ["정보 없음", "", ""],
                subKeywords: sum?.tags || [],
                score: iss.score
            };
        });

        const boardTitles = { NOON: "정오 이슈 보드", NIGHT: "일일 이슈 보드", CUSTOM: "커스텀 이슈 보드" };
        const dirA = path.join(outputDir, `Instagram_Feed_${type}_${dateStr}`);
        await fs.ensureDir(dirA);

        await renderFullSet(renderIssues, dateStr, SELECTED_THEME, dirA, true, boardTitles[type]);

        if (boardId) {
            Logger.info("\n🌐 Phase 6: Syncing with Supabase Storage...");
            try {
                // 1. 이미지 업로드 (항상 실행)
                const imageUrls = await uploadInstagramImages(dirA, outputTag);
                const publicUrls = imageUrls.map(img => img.publicUrl);

                // 2. 기본 정보 업데이트 (Storage URL, Caption)
                const { error: updateError } = await supabase
                    .from('issue_boards')
                    .update({
                        storage_urls: publicUrls,
                        caption: generatedCaption,
                        metadata: {
                            model: 'ITssue AI Engine (Multi-Key)',
                            processed_at: new Date().toISOString()
                        }
                    })
                    .eq('id', boardId);

                if (updateError) throw updateError;
                Logger.success(`✨ Supabase Storage & Caption Synced!`);

                // 3. 인스타그램 게시 (옵션)
                if (shouldPublish) {
                    Logger.info("🚀 Publishing to Instagram...");
                    const igPublisher = new InstagramPublisher();
                    const igMediaId = await igPublisher.publishCarousel(publicUrls, generatedCaption);

                    const { error: igUpdateError } = await supabase
                        .from('issue_boards')
                        .update({
                            instagram_post_id: igMediaId,
                            metadata: {
                                model: 'ITssue AI Engine (Multi-Key)',
                                published_at: new Date().toISOString()
                            }
                        })
                        .eq('id', boardId);

                    if (igUpdateError) throw igUpdateError;
                    Logger.success(`✨ Instagram Publishing Complete! ID: ${igMediaId}`);
                }
            } catch (e) {
                Logger.error("Failed to sync with Supabase or Publish", e);
            }
        }

        const totalDuration = ((Date.now() - totalStart) / 1000).toFixed(1);
        await closeBrowser();
        Logger.success(`Pipeline finishes (Duration: ${totalDuration}s)`);

    } catch (error) {
        Logger.error("Pipeline crashed", error);
        await closeBrowser().catch(() => { });
    }
}

function calculateTimeWindow(type: BoardType, now: Date, customStart?: Date, customEnd?: Date): TimeWindow {
    const kstShift = 9 * 60 * 60 * 1000;
    const kstNow = new Date(now.getTime() + kstShift);
    const kYear = kstNow.getUTCFullYear();
    const kMonth = kstNow.getUTCMonth();
    const kDate = kstNow.getUTCDate();

    let start: Date;
    let end: Date;

    if (customStart && customEnd) return { start: customStart, end: customEnd };

    switch (type) {
        case 'NOON':
            end = new Date(Date.UTC(kYear, kMonth, kDate, 3, 0, 0, 0));
            start = new Date(end.getTime());
            start.setUTCDate(start.getUTCDate() - 1);
            start.setUTCHours(13, 0, 0, 0);
            break;
        case 'NIGHT':
            // 22:00 KST (13:00 UTC) 기준
            end = new Date(Date.UTC(kYear, kMonth, kDate, 13, 0, 0, 0));
            // 만약 현재 시각이 오늘 22:00 전이라면, '오늘 22:00'까지의 데이터를 뽑기 위해 그대로 둠.
            // (사용자가 직접 실행하는 경우 대비)
            start = new Date(end.getTime());
            start.setUTCDate(start.getUTCDate() - 1); // 24시간 전
            break;
        default:
            throw new Error(`Unsupported board type: ${type}`);
    }
    return { start, end };
}

async function generateInstagramCaption(type: BoardType, date: string, summaries: FinalIssueBoard[]): Promise<string> {
    const templatePath = path.join(__dirname, '../publish/templates/issue_board_caption.txt');
    const templateSource = await fs.readFile(templatePath, 'utf-8');
    const template = Handlebars.compile(templateSource);

    let boardTitle = type === 'NOON' ? '🌤️ 정오 이슈 보드' : '🌙 일일 이슈 보드';
    let introMessage = type === 'NOON'
        ? '오전의 흐름을 정리하는 가장 완벽한 방법, TOP 10 이슈 리포트입니다.'
        : '오늘 하루를 정리하는 가장 완벽한 방법, TOP 10 이슈 리포트입니다.';

    const rankEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

    const issues = summaries.map((s, idx) => ({
        rankEmoji: rankEmojis[idx] || `${idx + 1}`,
        keyword: s.representative_keyword
    }));

    const allTags = Array.from(new Set(summaries.flatMap(s => s.tags))).slice(0, 10);

    return template({
        boardTitle,
        introMessage,
        date,
        issues: issues,
        allTags
    });
}

async function renderFullSet(issues: RenderIssue[], date: string, theme: string, dir: string, isSummaryMode: boolean, boardTitle: string) {
    const p1Data = { type: 'ranking' as const, date, theme, boardTitle, ranking: issues.map(i => ({ rank: i.rank, keyword: i.keyword })) };
    await renderCard(p1Data, { outputPath: path.join(dir, 'P1_Ranking.png') });

    const top4 = issues.slice(0, 4);
    for (const issue of top4) {
        const detailData = { type: 'issue-detail' as const, date, theme, boardTitle, ...issue };
        const safeName = issue.keyword.replace(/[\/\\?%*:|"<>]/g, '_').replace(/\s+/g, '_');
        await renderCard(detailData, { outputPath: path.join(dir, `P${issue.rank + 1}_${safeName}.png`) });
    }

    const group5to7 = issues.slice(4, 7);
    if (group5to7.length > 0) {
        const groupData = {
            type: 'group' as const, date, theme, boardTitle, rankRange: "TOP 5 ~ TOP 7",
            issues: group5to7.map(iss => ({ rank: iss.rank, keyword: iss.keyword, summaryLines: iss.summary.slice(0, 2) }))
        };
        await renderCard(groupData, { outputPath: path.join(dir, 'P6_Group5-7.png') });
    }

    const group8to10 = issues.slice(7, 10);
    if (group8to10.length > 0) {
        const groupData = {
            type: 'group' as const, date, theme, boardTitle, rankRange: "TOP 8 ~ TOP 10",
            issues: group8to10.map(iss => ({ rank: iss.rank, keyword: iss.keyword, summaryLines: iss.summary.slice(0, 2) }))
        };
        await renderCard(groupData, { outputPath: path.join(dir, 'P7_Group8-10.png') });
    }
}

async function recordAuditLog(type: BoardType, window: TimeWindow, summaries: FinalIssueBoard[], topIssues: IssueEntity[]): Promise<string> {
    const targetDate = new Date(window.end.getTime() + (9 * 60 * 60 * 1000)).toISOString().split('T')[0];
    const { data: board, error: boardError } = await supabase.from('issue_boards').insert([{
        board_type: type, target_date: targetDate, time_window: { start: window.start.toISOString(), end: window.end.toISOString() },
        metadata: { model: 'ITssue AI Engine', processed_at: new Date().toISOString() }
    }]).select('id').single();
    if (boardError) throw boardError;
    const boardItems = topIssues.map((issue, idx) => {
        const summary = summaries.find(s => s.representative_keyword === issue.representative_keyword);
        return {
            board_id: board.id, rank: idx + 1, keyword: issue.representative_keyword,
            score: issue.score, news_titles: issue.news_titles || [],
            instagram_summary: summary?.instagram_summary?.join('\n') || '',
            tags: summary?.tags || [], merged_keywords: issue.merged_keywords || []
        };
    });
    const { error: itemsError } = await supabase.from('issue_board_items').insert(boardItems);
    if (itemsError) throw itemsError;
    return board.id;
}
