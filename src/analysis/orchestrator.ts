/**
 * [Pipeline Orchestrator]
 * 
 * [Description] 수집부터 배포까지 이어지는 ITssue-AI의 전체 파이프라인을 조율(Orchestration)하고 통합 실행합니다.
 * 
 * [Design Intent]
 * - 모듈 간의 낮은 결합도(Loose Coupling)를 유지하며 전체 프로세스를 제어.
 * - 정오/일일/커스텀 등 다양한 분석 시간대(Time Window) 관리.
 * - 분석 결과의 영구 저장(DB/File) 및 이미지 렌더링, 인스타그램 발행 절차 통합.
 * 
 * [Key Logic Flow]
 * 1. 실행 타입(NOON/NIGHT 등)에 따른 분석 기간 계산.
 * 2. 분석 단계: Ranking Engine -> Issue Merger -> Summary Generator 순차 실행.
 * 3. 결과물 생성: JSON 리포트 저장 및 인스타그램 캡션 생성.
 * 4. 시각화 및 배포: 카드뉴스 렌더링 -> Storage 업로드 -> Instagram 발행.
 */
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

const TOP_N_ISSUES = 10;

export async function runOrchestrator(type: BoardType, shouldPublish: boolean = false, customStart?: Date, customEnd?: Date) {
    const totalStart = Date.now();
    Logger.info(`[Pipeline] 🌟 Starting Generation Pipeline [${type}]...`);

    try {
        // [Step 1] 분석 시간대(Time Window) 계산 및 출력 경로 설정
        // [Logic] 서버(UTC)와 한국(KST) 시차를 고려하여 정확한 수집 범위를 결정합니다.
        const now = new Date();
        const window = calculateTimeWindow(type, now, customStart, customEnd);

        // 출력 디렉토리 식별을 위한 타임스탬프 태그 생성
        const dateStr = window.end.toISOString().split('T')[0].replace(/-/g, '.');
        const timeSuffix = now.toTimeString().split(' ')[0].replace(/:/g, '');
        const outputTag = type === 'CUSTOM' ? `${dateStr}_CUSTOM_${timeSuffix}` : `${dateStr}_${type}`;
        const SELECTED_THEME = 'violet-bloom';

        Logger.info(`📅 Analysis Window: ${window.start.toISOString()} ~ ${window.end.toISOString()}`);

        // [Step 2] 이슈 병합 게이트(Issue Merger Gate) 실행
        // [Logic] 파편화된 원시 검색어 데이터를 유사도 기반으로 군집화하여 유의미한 이슈를 추출합니다.
        const allMergedIssues = await runMergeGate(window);

        if (allMergedIssues.length === 0) {
            // [Safety] 분석 대상 데이터가 없는 경우 파이프라인 안전 종료
            Logger.warn(`⚠️ No issues found for ${type} cycle within the window.`);
            Logger.info(`   Start: ${window.start.toISOString()}`);
            Logger.info(`   End: ${window.end.toISOString()}`);
            return;
        }

        // [Step 3] 상위 이슈 필터링 및 AI 요약 생성
        const topIssues = allMergedIssues
            .sort((a, b) => b.score - a.score)
            .slice(0, TOP_N_ISSUES);
        const summaries = await generateAISummaries(topIssues);

        // [Step 4] 분석 리포트(JSON) 구조화 및 로컬 저장
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

        // [Step 5] Supabase 감사 로그(Audit Log) 등록
        let boardId: string | null = null;
        try {
            Logger.info("[Database] 📝 Registering audit log...");
            boardId = await recordAuditLog(type, window, summaries, topIssues);
            Logger.success(`[Database] Audit Log registered. (ID: ${boardId})`);
        } catch (e) {
            Logger.warn("[Database] Failed to register audit log", e);
        }

        // [Step 6] 인스타그램 캡션 자동 생성 및 파일 저장
        let generatedCaption = '';
        try {
            Logger.info("[AI] ✍️ Generating Instagram caption...");
            // [Logic] Handlebars 템플릿을 사용하여 정규화된 캡션 형식 생성
            generatedCaption = await generateInstagramCaption(type, dateStr, summaries);
            const captionPath = path.join(outputDir, `caption_${type}_${dateStr}.txt`);
            await fs.writeFile(captionPath, generatedCaption, 'utf-8');
            Logger.success(`Caption saved to: ${captionPath}`);
        } catch (e) {
            // [Safety] 캡션 생성 실패 시 에러 로깅 후 이미지 렌더링 단계로 진행 (Partial Success 허용)
            Logger.error("Failed to generate Instagram caption", e);
        }

        // [Step 7] 이슈 데이터 렌더링 최적화 및 카드 뉴스 생성
        const renderIssues: FinalIssueBoard[] = topIssues.map((iss, idx) => {
            const sum = summaries.find(s => s.representative_keyword === iss.representative_keyword);
            return {
                ...sum!,
                rank: idx + 1,
                representative_keyword: iss.representative_keyword,
                instagram_summary: sum?.instagram_summary || ["정보 없음", "", ""],
                tags: sum?.tags || [],
                score: iss.score
            };
        });

        const boardTitles = { NOON: "정오 이슈 보드", NIGHT: "일일 이슈 보드", CUSTOM: "커스텀 이슈 보드" };
        const dirA = path.join(outputDir, `Instagram_Feed_${type}_${dateStr}`);
        await fs.ensureDir(dirA);

        await renderFullSet(renderIssues, dateStr, SELECTED_THEME, dirA, true, boardTitles[type]);

        // [Step 8] Supabase Storage 동기화 및 최종 발행
        if (boardId) {
            Logger.info("\n🌐 Syncing with Supabase Storage...");
            try {
                // [Logic] 8.1 이미지 업로드 (항상 실행)
                const imageUrls = await uploadInstagramImages(dirA, outputTag);
                const publicUrls = imageUrls.map(img => img.publicUrl);

                // [Logic] 8.2 기본 정보 업데이트 (Storage URL, Caption)
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

                // [Logic] 8.3 인스타그램 최종 게시 (옵션)
                let igMediaId: string | null = null;
                if (shouldPublish) {
                    Logger.info("🚀 Publishing to Instagram...");
                    const igPublisher = new InstagramPublisher();
                    igMediaId = await igPublisher.publishCarousel(publicUrls, generatedCaption);

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

                // [Logic] 8.4 발행 정보 파일 저장 (publish_info.json)
                // [Description] 향후 수동 재렌더링 시 참조할 수 있도록 발행 메타데이터를 로컬에 저장합니다.
                const publishInfoPath = path.join(outputDir, `publish_${type}_${dateStr}.json`);
                const publishInfo = {
                    boardId,
                    type,
                    date: dateStr,
                    imageUrls,
                    igMediaId,
                    processedAt: new Date().toISOString()
                };
                await fs.writeJson(publishInfoPath, publishInfo, { spaces: 2 });
                Logger.info(`📋 Publish info saved to: ${publishInfoPath}`);

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

/**
 * [Logic] 분석 대상 시간 범위(Time Window) 계산기
 * [Safety] 서버의 UTC 시간과 한국의 KST(+9) 시간을 매핑하여 '정확한 24시간' 또는 '특정 정시' 범위를 산출합니다.
 */
function calculateTimeWindow(type: BoardType, now: Date, customStart?: Date, customEnd?: Date): TimeWindow {
    // [Step] 커스텀 요청 시 최우선 적용 (CUSTOM 타입일 때만)
    if (type === 'CUSTOM' && customStart && customEnd) return { start: customStart, end: customEnd };

    // [Logic] NOON/NIGHT 타입에서 customStart가 주어지면 해당 날짜를 기준(Target Date)으로 분석 수행
    const targetDate = (type !== 'CUSTOM' && customStart) ? customStart : now;

    // 9시간 오프셋 적용 (KST 기준 계산을 위해)
    const kstShift = 9 * 60 * 60 * 1000;
    const kstNow = new Date(targetDate.getTime() + kstShift);
    const kYear = kstNow.getUTCFullYear();
    const kMonth = kstNow.getUTCMonth();
    const kDate = kstNow.getUTCDate();

    let start: Date;
    let end: Date;

    switch (type) {
        case 'NOON':
            // [Logic] 정오 이슈: 당일 12:00 KST (03:00 UTC)까지의 데이터
            end = new Date(Date.UTC(kYear, kMonth, kDate, 3, 0, 0, 0));
            start = new Date(end.getTime());
            start.setUTCDate(start.getUTCDate() - 1); // 24시간 전 시점부터
            start.setUTCHours(13, 0, 0, 0); // KST 기준 전일 22:00부터 수집 (야간 데이터 포함)
            break;
        case 'NIGHT':
            // [Logic] 일일 이슈: 당일 22:00 KST (13:00 UTC)까지의 24시간 데이터
            end = new Date(Date.UTC(kYear, kMonth, kDate, 13, 0, 0, 0));
            start = new Date(end.getTime());
            start.setUTCDate(start.getUTCDate() - 1); // 정확히 24시간 전
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

/**
 * [Logic] 카드 뉴스 이미지 세트 생성기
 * [Description] P1(랭킹), P2~P5(상위 이슈 상세), P6~P7(하위 이슈 그룹) 이미지를 순차적으로 렌더링합니다.
 */
async function renderFullSet(issues: FinalIssueBoard[], date: string, theme: string, dir: string, isSummaryMode: boolean, boardTitle: string) {
    const p1Data = { type: 'ranking' as const, date, theme, boardTitle, ranking: issues.map(i => ({ rank: i.rank!, keyword: i.representative_keyword })) };
    await renderCard(p1Data, { outputPath: path.join(dir, 'P1_Ranking.png') });

    const top4 = issues.slice(0, 4);
    for (const issue of top4) {
        const detailData = {
            type: 'issue-detail' as const,
            date, theme, boardTitle,
            rank: issue.rank!,
            keyword: issue.representative_keyword,
            subKeywords: issue.tags,
            summary: issue.instagram_summary
        };
        const safeName = issue.representative_keyword.replace(/[\/\\?%*:|"<>]/g, '_').replace(/\s+/g, '_');
        await renderCard(detailData, { outputPath: path.join(dir, `P${issue.rank! + 1}_${safeName}.png`) });
    }

    const group5to7 = issues.slice(4, 7);
    if (group5to7.length > 0) {
        const groupData = {
            type: 'group' as const, date, theme, boardTitle, rankRange: "TOP 5 ~ TOP 7",
            issues: group5to7.map(iss => ({
                rank: iss.rank!,
                keyword: iss.representative_keyword,
                summaryLines: iss.instagram_summary.slice(0, 2)
            }))
        };
        await renderCard(groupData, { outputPath: path.join(dir, 'P6_Group5-7.png') });
    }

    const group8to10 = issues.slice(7, 10);
    if (group8to10.length > 0) {
        const groupData = {
            type: 'group' as const, date, theme, boardTitle, rankRange: "TOP 8 ~ TOP 10",
            issues: group8to10.map(iss => ({
                rank: iss.rank!,
                keyword: iss.representative_keyword,
                summaryLines: iss.instagram_summary.slice(0, 2)
            }))
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
