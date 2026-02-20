/**
 * [Pipeline Orchestrator]
 * 
 * [Description] 수집부터 배포까지 이어지는 ITssue-AI의 전체 파이프라인을 조율(Orchestration)하고 통합 실행합니다.
 * 
 * [Design Intent]
 * - 모듈 간의 낮은 결합도(Loose Coupling)를 유지하며 전체 프로세스를 제어합니다.
 * - 정오/일일/커스텀 등 다양한 분석 시간대(Time Window) 관리와 데이터 영구 저장을 담당합니다.
 * - 시각화 및 배포 계층과 소통하며 전체 엔드투엔드(E2E) 흐름을 완성합니다.
 */
import { Logger } from '../lib/logger';
import { IssueEntity, FinalIssueBoard, BoardType, TimeWindow, AnalysisReport } from '../types';
import { runMergeGate } from './issue-merger';
import { generateAISummaries } from './summary-generator';
import { renderCard, closeBrowser, renderFullSet } from '../visual/card-renderer';
import { supabase } from '../db/supabase-client';
import { uploadInstagramImages } from '../publish/storage-manager';
import { InstagramPublisher } from '../publish/instagram-publisher';
import { ThreadsPublisher } from '../publish/threads-publisher';
import { FacebookPublisher } from '../publish/facebook-publisher';
import * as Handlebars from 'handlebars';
import * as path from 'path';
import * as fs from 'fs-extra';
import { NotificationService } from '../lib/notifier';

const TOP_N_ISSUES = 10;

export async function runOrchestrator(type: BoardType, shouldPublish: boolean = false, customStart?: Date, customEnd?: Date) {
    const totalStart = Date.now();
    Logger.info(`[Pipeline] 🌟 Starting Generation Pipeline [${type}]...`);

    try {
        // [Step 1] 분석 시간대(Time Window) 계산 및 출력 환경 설정
        // [Logic] 시스템(UTC) 시각과 한국(KST) 시차를 보정하여 정확한 수집 범위를 산출합니다.
        const now = new Date();
        const window = calculateTimeWindow(type, now, customStart, customEnd);

        // 출력 디렉토리 식별을 위한 타임스탬프 태그 생성
        const dateStr = window.end.toISOString().split('T')[0].replace(/-/g, '.');
        const timeSuffix = now.toTimeString().split(' ')[0].replace(/:/g, '');
        const outputTag = type === 'CUSTOM' ? `${dateStr}_CUSTOM_${timeSuffix}` : `${dateStr}_${type}`;
        const visualVersion: 'bubblegum' | 'arcade' = type === 'NOON' ? 'arcade' : 'bubblegum';
        const p1Title = type === 'NOON' ? 'MIDDAY TRENDS' : 'DAILY TRENDS';
        const SELECTED_THEME = visualVersion; // Use the actual theme folder name as the theme class

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

        // [Step 3] 상위 N개 이슈 필터링 및 AI 심층 요약 생성
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

        // [Logic] 분석 리포트(JSON) 물리적 파일 저장
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

        // [Logic] 메모리 버퍼로 이미지 렌더링
        const imageBuffers = await renderFullSet(renderIssues, dateStr, type, SELECTED_THEME, boardTitles[type], visualVersion, p1Title);

        // [Logic] 실패 리포팅 상태 변수 초기화
        const failedSummaries = summaries
            .map((s, idx) => ({ rank: idx + 1, keyword: s.representative_keyword, isFailed: s.instagram_summary[0] === "요약을 생성하지 못했습니다." }))
            .filter(s => s.isFailed);
        const failedSNS: string[] = [];

        // [Step 8] Supabase Storage 동기화 및 최종 발행
        if (boardId) {
            Logger.info("\n🌐 Syncing with Supabase Storage...");
            try {
                // [Logic] 8.1 메모리 버퍼 배열을 통해 이미지 업로드 (Primary Feed)
                const imageUrls = await uploadInstagramImages(imageBuffers, outputTag);
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

                // [Logic] 8.3 텔레그램 메인 메시지(이미지+영상+캡션) 선행 전송
                // 사용자 요청 반영: Supabase 업로드 직후, 수 분이 소요되는 SNS 발행을 기다리지 않고 즉시 텔레그램을 발송합니다.
                try {
                    Logger.info("\n📨 Sending Telegram main notification early (Before SNS Publish)...");
                    const notifier = new NotificationService();
                    const dirA = path.join(outputDir, `Instagram_Feed_${type}_${dateStr}`);
                    await fs.ensureDir(dirA);

                    const images: string[] = [];
                    for (const img of imageBuffers) {
                        const filePath = path.join(dirA, img.fileName);
                        await fs.writeFile(filePath, img.buffer);
                        images.push(filePath);
                    }
                    images.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));

                    // 메인 메시지 전송 실행 (동영상 인코딩 포함 약 10~20초 소요)
                    await notifier.sendTelegram(type, dateStr, renderIssues, images, generatedCaption);
                } catch (e) {
                    Logger.warn("⚠️ Telegram main notification failed.", e);
                }

                // [Logic] 8.4 인스타그램, 스레드, 페이스북 동시(Concurrent) 발행
                let igMediaId: string | null = null;
                if (shouldPublish) {
                    Logger.info("🚀 Publishing to Social Media concurrently...");
                    const igPublisher = new InstagramPublisher();
                    const threadsPublisher = new ThreadsPublisher();
                    const fbPublisher = new FacebookPublisher();

                    // 각 플랫폼별 비동기 작업을 Promise로 래핑
                    const igTask = async () => {
                        const mediaId = await igPublisher.publishCarousel(publicUrls, generatedCaption);
                        let permalink = null;
                        if (mediaId) {
                            permalink = await igPublisher.getMediaPermalink(mediaId);
                        }
                        return { mediaId, permalink };
                    };

                    const threadsTask = async () => {
                        return await threadsPublisher.publishCarousel(publicUrls, generatedCaption);
                    };

                    const fbTask = async () => {
                        return await fbPublisher.publishMultiPhoto(publicUrls, generatedCaption);
                    };

                    // 모든 플랫폼 발행을 동시에 처리
                    const [igResult, threadsResult, fbResult] = await Promise.allSettled([
                        igTask(),
                        threadsTask(),
                        fbTask()
                    ]);

                    // 메타데이터 업데이트를 위한 객체 구성
                    let newMetadata: any = {
                        published_at: new Date().toISOString()
                    };

                    // Instagram 결과 처리
                    if (igResult.status === 'fulfilled' && igResult.value.mediaId) {
                        igMediaId = igResult.value.mediaId;
                        newMetadata.instagram_post_id = igResult.value.mediaId;
                        newMetadata.instagram_permalink = igResult.value.permalink;
                        Logger.success(`✨ Instagram Publishing Complete! ID: ${igMediaId}`);
                    } else if (igResult.status === 'rejected') {
                        Logger.error("❌ Instagram Publishing Failed", igResult.reason);
                        failedSNS.push('Instagram');
                    } else {
                        failedSNS.push('Instagram');
                    }

                    // Threads 결과 처리
                    if (threadsResult.status === 'fulfilled' && threadsResult.value) {
                        newMetadata.threads_post_id = threadsResult.value;
                        Logger.success(`✨ Threads Publishing Complete! ID: ${threadsResult.value}`);
                    } else if (threadsResult.status === 'rejected') {
                        Logger.error("❌ Threads Publishing Failed", threadsResult.reason);
                        failedSNS.push('Threads');
                    } else {
                        failedSNS.push('Threads');
                    }

                    // Facebook 결과 처리
                    if (fbResult.status === 'fulfilled' && fbResult.value) {
                        newMetadata.facebook_post_id = fbResult.value;
                        Logger.success(`✨ Facebook Publishing Complete! ID: ${fbResult.value}`);
                    } else if (fbResult.status === 'rejected') {
                        Logger.error("❌ Facebook Publishing Failed", fbResult.reason);
                        failedSNS.push('Facebook');
                    } else {
                        failedSNS.push('Facebook');
                    }

                    // 한 번의 DB Update로 모든 플랫폼 메타데이터 반영
                    const { data: currentBoard } = await supabase.from('issue_boards').select('metadata').eq('id', boardId).single();
                    const { error: finalUpdateError } = await supabase
                        .from('issue_boards')
                        .update({
                            instagram_post_id: igMediaId, // Legacy 컬럼 호환 유지
                            metadata: {
                                ...(currentBoard?.metadata || {}),
                                ...newMetadata
                            }
                        })
                        .eq('id', boardId);

                    if (finalUpdateError) {
                        Logger.warn(`⚠️ Failed to update final SNS metadata in DB: ${finalUpdateError.message}`);
                    }
                }

                // [Logic] 8.5 발행 정보 파일 저장 (publish_info.json)
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

        // [Step 9] 시스템 에러 리포트 텔레그램 전송 (문제 발생 시에만)
        // 메인 텔레그램 전송은 8.3 단계에서 선행 수행되었습니다.
        try {
            let report = '';
            if (failedSummaries.length > 0 || failedSNS.length > 0) {
                report = `⚠️ <b>[시스템 결과 리포트]</b>\n`;
                if (failedSummaries.length > 0) {
                    report += `\n<b>📌 AI 요약 실패 (기본값 대체됨):</b>\n`;
                    failedSummaries.forEach(f => {
                        report += `- ${f.rank}위: ${f.keyword}\n`;
                    });
                }
                if (failedSNS.length > 0) {
                    report += `\n<b>📌 SNS 업로드 실패:</b>\n`;
                    report += `- ${failedSNS.join(', ')}\n`;
                }
            }

            // [Logic] 에러가 있다면 텔레그램으로 별도 메시지 발송
            if (report) {
                Logger.info("\n📨 Sending Telegram Error Report...");
                const notifier = new NotificationService();
                await notifier.sendErrorReport(report);
            }
        } catch (e) {
            Logger.warn("⚠️ Error Report notification failed.", e);
        }

        // [Step 10] 로컬 파일 정리 (Cleanup)
        // [Logic] Supabase 저장 및 알림 전송이 완료되었으므로, 서버 용량 확보를 위해 임시 파일을 제거합니다.
        try {
            Logger.info(`🧹 Cleaning up local output directory: ${outputDir}`);
            await fs.remove(outputDir);
            Logger.success("✅ Local cleanup completed.");
        } catch (cleanupError) {
            Logger.warn("⚠️ Failed to cleanup local output directory.", cleanupError);
        }

    } catch (error: any) {
        Logger.error("Pipeline crashed", error);
        await closeBrowser().catch(() => { });

        // [Fix/Report] 파이프라인 비정상 종료 알림 전송
        try {
            const notifier = new NotificationService();
            const errorMessage = `❌ **[ITssue Pipeline Crashed]**\n\n- Type: ${type}\n- Error: ${error.message || error}\n\n*자가 치유 시도 후에도 실패한 수동 확인이 필요한 상태입니다.*`;
            await notifier.sendTelegram(type, "", [], [], errorMessage);
        } catch (notifyError) {
            Logger.warn("⚠️ Failed to send crash notification", notifyError);
        }
    }
}

/**
 * [Logic] 분석 대상 시간 범위(Time Window) 계산기
 * [Safety] 서버의 UTC 시간과 한국의 KST(+9) 시간을 매핑하여 '정확한 24시간' 또는 '특정 정시' 범위를 산출합니다.
 */
function calculateTimeWindow(type: BoardType, now: Date, customStart?: Date, customEnd?: Date): TimeWindow {
    // [Step] 커스텀 요청 시 최우선 적용 (CUSTOM 타입일 때만)
    // [Logic] CLI에서 입력받은 날짜가 타임존 정보가 없는 경우, KST(UTC+9)로 처리하도록 유도합니다.
    if (type === 'CUSTOM' && customStart && customEnd) {
        return { start: customStart, end: customEnd };
    }

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
            // [Logic] 정오 이슈: 당일 11:45 KST (02:45 UTC)까지의 데이터
            // 수집 범위: 전일 20:45 KST ~ 당일 11:45 KST
            end = new Date(Date.UTC(kYear, kMonth, kDate, 2, 45, 0, 0));
            start = new Date(end.getTime());
            start.setUTCDate(start.getUTCDate() - 1);
            start.setUTCHours(11, 45, 0, 0); // 전일 20:45 KST (11:45 UTC)
            break;
        case 'NIGHT':
            // [Logic] 일일 이슈: 당일 20:45 KST (11:45 UTC)까지의 데이터
            // 수집 범위: 전일 20:45 KST ~ 당일 20:45 KST (24시간)
            end = new Date(Date.UTC(kYear, kMonth, kDate, 11, 45, 0, 0));
            start = new Date(end.getTime());
            start.setUTCDate(start.getUTCDate() - 1); // 정확히 24시간 전
            break;
        default:
            throw new Error(`Unsupported board type: ${type}`);
    }
    return { start, end };
}

const HASHTAG_SETS = [
    "#ITssue #뉴스 #이슈 #트렌드",
    "#ITssue #오늘의이슈 #뉴스요약 #트렌드",
    "#ITssue #실시간이슈 #뉴스 #이슈",
    "#ITssue #이슈정리 #뉴스 #오늘뉴스",
    "#ITssue #트렌드분석 #뉴스 #이슈",
    "#ITssue #뉴스정리 #이슈 #트렌드"
];

export async function generateInstagramCaption(type: BoardType, date: string, summaries: FinalIssueBoard[]): Promise<string> {
    const templatePath = path.join(__dirname, '../publish/templates/issue_board_caption.txt');
    const templateSource = await fs.readFile(templatePath, 'utf-8');
    const template = Handlebars.compile(templateSource);

    let boardTitle = type === 'NOON' ? '🌤️ 정오 이슈 보드' : '🌙 일일 이슈 보드';
    let introMessage = type === 'NOON'
        ? '오전의 흐름을 정리하는 가장 완벽한 방법\nTOP 10 이슈 리포트입니다.'
        : '오늘 하루를 정리하는 가장 완벽한 방법\nTOP 10 이슈 리포트입니다.';

    const rankEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

    const issues = summaries.map((s, idx) => ({
        rankEmoji: rankEmojis[idx] || `${idx + 1}`,
        keyword: s.representative_keyword
    }));

    const allTags = Array.from(new Set(summaries.flatMap(s => s.tags))).slice(0, 10);

    // [Logic] Hashtag Rotation Strategy (6 sets, 3-day cycle)
    const day = parseInt(date.split('.')[2], 10) || new Date().getDate();
    const setIdx = (day % 3) * 2 + (type === 'NIGHT' ? 1 : 0);
    const rotatingTags = HASHTAG_SETS[setIdx];

    return template({
        boardTitle,
        introMessage,
        date,
        issues: issues,
        allTags,
        rotatingTags
    });
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
