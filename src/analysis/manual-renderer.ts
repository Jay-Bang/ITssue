import * as path from 'path';
import * as fs from 'fs-extra';
import { renderCard, closeBrowser } from '../visual/card-renderer';
import { Logger } from '../lib/logger';
import { InstagramPublisher } from '../publish/instagram-publisher';
import * as Handlebars from 'handlebars';
import { FinalIssueBoard, BoardType } from '../types';

/**
 * [Manual Re-rendering Utility]
 * 
 * [Description] 이미 생성된 분석 결과 JSON 파일을 읽어 카드 뉴스 이미지를 다시 생성하고, 필요 시 인스타그램에 재발행합니다.
 * 
 * [Design Intent]
 * - 오케스트레이터 전체를 다시 실행하지 않고도 디자인 수정 사항(CSS/HTML)을 빠르게 반영하기 위함.
 * - 특정 이슈 보드에 대한 업데이트 버전(Edition) 생성을 지원.
 * 
 * [Key Logic Flow]
 * 1. 대상 JSON 파일 로드 및 데이터 파싱.
 * 2. 파일명 패턴 분석을 통한 날짜 및 테마 정보 추출.
 * 3. [Step] 이미지 렌더링 -> [Step] Storage 업로드 -> [Step] Instagram 게시물 생성/교체.
 */
import { supabase } from '../db/supabase-client';
import { uploadInstagramImages } from '../publish/storage-manager';
import { NotificationService } from '../lib/notifier';

// ... (existing helper logic remains unchanged)

async function runManualRender() {
    const args = process.argv.slice(2);
    const jsonPath = args.find(arg => !arg.startsWith('--'));
    const shouldPublish = args.includes('--publish');
    const isBubblegum = args.includes('--bubblegum') || args.includes('--modern'); // Support both for transition
    const isArcade = args.includes('--arcade');
    let visualVersion: 'bubblegum' | 'arcade' = isArcade ? 'arcade' : 'bubblegum';
    const SELECTED_THEME = args.find(arg => !arg.startsWith('--') && arg !== jsonPath) || 'violet-bloom';

    if (!jsonPath) {
        Logger.error('Usage: npm run board:render -- <path_to_json> [theme] [--publish] [--bubblegum|--arcade]');
        process.exit(1);
    }

    const absoluteJsonPath = path.isAbsolute(jsonPath) ? jsonPath : path.join(process.cwd(), jsonPath);

    if (!await fs.pathExists(absoluteJsonPath)) {
        Logger.error(`File not found: ${absoluteJsonPath}`);
        process.exit(1);
    }

    Logger.info(`🚀 Starting Manual Re-rendering for: ${absoluteJsonPath}`);
    if (shouldPublish) Logger.info("📢 Options: --publish (Will update Supabase Storage)");

    const content = await fs.readJson(absoluteJsonPath);
    const summaries = Array.isArray(content) ? content : (content.results || []);

    const outputDir = path.dirname(absoluteJsonPath);
    const outputFolderName = path.basename(outputDir);
    const isNight = absoluteJsonPath.includes('NIGHT');
    const isNoon = absoluteJsonPath.includes('NOON');
    const isCustom = absoluteJsonPath.includes('CUSTOM');

    let boardTitle = "이슈 보드";
    if (isNight) {
        boardTitle = "일일 이슈 보드";
        // [Logic] 일일(NIGHT) 보드는 bubblegum 스타일 전용
        if (!isBubblegum && !isArcade) visualVersion = 'bubblegum';
    }
    else if (isNoon) {
        boardTitle = "정오 이슈 보드";
        // [Logic] 정오(NOON) 보드는 arcade 스타일 전용
        if (!isBubblegum && !isArcade) visualVersion = 'arcade';
    }
    else if (isCustom) boardTitle = "커스텀 이슈 보드";

    const filename = path.basename(absoluteJsonPath);
    // [Parsing] New format: results_TYPE_YYYY.MM.DD.json
    // Regex matches: results_(GROUP1)_(GROUP2).json
    const match = filename.match(/^results_(.+)_(20\d{2}\.\d{2}\.\d{2})\.json$/);

    let dateStr = '';
    let type: BoardType = 'CUSTOM';

    if (match) {
        type = match[1] as BoardType;      // e.g. CUSTOM, NOON, NIGHT
        dateStr = match[2];   // e.g. 2026.01.17
    } else {
        // Fallback or Error handling
        Logger.warn("⚠️ Filename format mismtach. Expected: results_TYPE_YYYY.MM.DD.json");
        // Try to recover date from old format or just use what we can find
        dateStr = filename.split('_')[0];
    }

    // Determine Type strictly for folder naming (Redundant if regex works, but safe to keep logic consistent)
    if (filename.includes('NIGHT')) type = 'NIGHT';
    else if (filename.includes('NOON')) type = 'NOON';
    else if (filename.includes('CUSTOM')) type = 'CUSTOM';

    // [Step 1] 리포트 데이터 포매팅 및 로딩
    const formattedIssues: FinalIssueBoard[] = summaries.map((s: any, idx: number) => ({
        ...s,
        rank: idx + 1,
        representative_keyword: s.representative_keyword,
        instagram_summary: s.instagram_summary,
        tags: s.tags || [],
        score: s.score || 0
    }));

    try {
        // [Step 2] 카드 뉴스 렌더링 실행 (Puppeteer)
        Logger.info(`🎨 Style: ${SELECTED_THEME} | Version: ${visualVersion}`);

        const dirSuffix = `_${visualVersion}`;
        const dirA = path.join(outputDir, `Instagram_Feed_${type}_${dateStr}${dirSuffix}`);
        // const dirB = path.join(outputDir, `Detail_Feed_${type}_${dateStr}`);
        await fs.ensureDir(dirA);
        // await fs.ensureDir(dirB);

        // [Config] Version A (Summary/Instagram) - Primary
        const p1Title = type === 'NOON' ? 'MIDDAY TRENDS' : 'DAILY TRENDS';
        const boardTitles = {
            'NIGHT': '일일 이슈 보드',
            'NOON': '정오 이슈 보드',
            'CUSTOM': '커스텀 이슈 보드'
        };
        await renderFullSet(formattedIssues, dateStr, type, SELECTED_THEME, dirA, true, boardTitles[type], visualVersion, p1Title);

        // [Logic] Regenerate caption with new hashtag rotation
        const newCaption = await generateInstagramCaption(type, dateStr, formattedIssues);
        const captionPath = path.join(outputDir, `caption_${type}_${dateStr}.txt`);
        await fs.writeFile(captionPath, newCaption, 'utf-8');
        Logger.success(`Caption regenerated with rotation: ${captionPath}`);

        // await renderFullSet(formattedIssues, dateStr, SELECTED_THEME, dirB, false, boardTitle);

        Logger.success(`Re-rendering Completed! Check folder: ${dirA}`);
        // \n - ${dirB}

        // [Step 3] 가공 및 재발행 (선택 사항)
        if (shouldPublish) {
            Logger.info("🌐 Syncing with Supabase Storage...");

            // [Naming] publish_info.json 이름이 `publish_${type}_${dateStr}.json`으로 변경됨에 따라 동적 탐색
            const files = await fs.readdir(outputDir);
            const publishInfoFile = files.find(f => f.startsWith('publish_') && f.endsWith('.json'));

            if (!publishInfoFile) {
                Logger.warn("⚠️  Publish info file (publish_*.json) not found in directory.");
                Logger.info("ℹ️  Images were rendered but NOT linked to the database.");
                return;
            }

            const publishInfoPath = path.join(outputDir, publishInfoFile);
            const publishInfo = await fs.readJson(publishInfoPath);
            const boardId = publishInfo.boardId;

            if (!boardId) {
                Logger.error("Board ID missing in publish info file.");
                return;
            }

            Logger.info(`📦 Creating new Edition for Original Board ID: ${boardId}`);

            // [Logic] 3.1 원본 보드 정보 획득 (메타데이터 상속용)
            const { data: originalBoard, error: fetchError } = await supabase
                .from('issue_boards')
                .select('*')
                .eq('id', boardId)
                .single();

            if (fetchError || !originalBoard) {
                Logger.warn("⚠️ Original board not found. Using default metadata.");
            }

            // [Step 4] 이미지 업로드 및 공용 URL 생성
            // [Safety] 인스타그램 캐싱 문제를 방지하기 위해 타임스탬프를 추가한 고유 경로 사용
            const storageTag = `${outputFolderName}_rev${Date.now()}`;
            const imageUrls = await uploadInstagramImages(dirA, storageTag);

            // 2. 캡션 파일 읽기
            const captionPath = path.join(outputDir, `caption_${type}_${dateStr}.txt`);
            let captionContent = '';
            if (await fs.pathExists(captionPath)) {
                captionContent = await fs.readFile(captionPath, 'utf-8');
            }

            // 3. 새로운 보드 레코드 생성 (Insert, not Update)
            const { data: newBoard, error: insertError } = await supabase
                .from('issue_boards')
                .insert([{
                    board_type: 'EDITION',
                    target_date: originalBoard?.target_date || dateStr.replace(/\./g, '-'),
                    time_window: originalBoard?.time_window || {},
                    storage_urls: imageUrls.map(img => img.publicUrl),
                    caption: captionContent,
                    metadata: {
                        ...(originalBoard?.metadata || {}),
                        edition_of: boardId,
                        processed_at: new Date().toISOString(),
                        notes: "Manual Re-rendering Edition"
                    }
                }])
                .select('id')
                .single();

            if (insertError) throw insertError;
            const newBoardId = newBoard.id;
            Logger.success(`New Edition Board created: ${newBoardId}`);

            // 4. 인스타그램 자동 게시 (NEW)
            Logger.info("📸 Publishing manual edition to Instagram...");
            const igPublisher = new InstagramPublisher();

            // 기존 게시물이 이미 있었다면 자동으로 삭제 (자기 교정 로직)
            if (originalBoard?.instagram_post_id) {
                await igPublisher.deleteMedia(originalBoard.instagram_post_id);
            }

            const igMediaId = await igPublisher.publishCarousel(imageUrls.map(img => img.publicUrl), captionContent);

            // 4.1. DB 업데이트 (인스타그램 미디어 ID 반영)
            if (igMediaId) {
                await supabase
                    .from('issue_boards')
                    .update({
                        instagram_post_id: igMediaId,
                        metadata: {
                            ...(originalBoard?.metadata || {}),
                            edition_of: boardId,
                            processed_at: new Date().toISOString(),
                            notes: "Manual Re-rendering Edition"
                        }
                    })
                    .eq('id', newBoardId);
            }

            // 4. 이슈 텍스트 데이터 동기화 (새로운 board_id에 연결)
            Logger.info("📝 Syncing issue details (issue_board_items)...");

            // [Step 5] 텔레그램 알림 전송 (비디오 포함)
            try {
                Logger.info("\n📨 Sending Telegram notification...");
                const notifier = new NotificationService();

                // 이미지 목록 수집 (Ranking 이미지 우선)
                const images = (await fs.readdir(dirA))
                    .filter(f => f.endsWith('.png'))
                    .map(f => path.join(dirA, f))
                    .sort((a, b) => a.includes('Ranking') ? -1 : 1);

                // 전송 실행 (VideoGenerator는 NotificationService 내부에서 호출됨)
                await notifier.sendTelegram(type, dateStr, formattedIssues, images, newCaption);
            } catch (notifyError) {
                Logger.warn("⚠️ Notification failed but rendering completed.", notifyError);
            }

            const boardItems = summaries.map((s: any, idx: number) => ({
                board_id: newBoardId, // 새 board_id 사용
                rank: idx + 1,
                keyword: s.representative_keyword,
                score: s.score || 0,
                news_titles: s.news_titles || [],
                instagram_summary: Array.isArray(s.instagram_summary) ? s.instagram_summary.join('\n') : (s.instagram_summary || ''),
                tags: s.tags || [],
                merged_keywords: s.merged_keywords || []
            }));

            const { error: itemsError } = await supabase
                .from('issue_board_items')
                .insert(boardItems);

            if (itemsError) {
                Logger.error("Failed to sync issue_board_items", itemsError);
            } else {
                Logger.success("Issue details synced to new edition successfully.");
            }

            // 5. publish info 업데이트 (새로운 boardId 및 igMediaId로 갱신)
            publishInfo.boardId = newBoardId;
            publishInfo.imageUrls = imageUrls;
            publishInfo.igMediaId = igMediaId;
            publishInfo.processedAt = new Date().toISOString();
            await fs.writeJson(publishInfoPath, publishInfo, { spaces: 2 });
            Logger.success("Publish info updated with new Board ID and IG Media ID.");
        }

    } catch (error: any) {
        Logger.error(`Rendering Failed`, error);
        // [Notification] 렌더링 실패 알림 전송
        try {
            const notifier = new NotificationService();
            const errorMessage = `🚨 **[ITssue Rendering Failed]**\n\n- File: ${path.basename(jsonPath)}\n- Error: ${error.message || error}`;
            await notifier.sendTelegram('RENDER', '', [], [], errorMessage);
        } catch (notifyError) {
            Logger.warn("⚠️ Failed to send crash notification", notifyError);
        }
    } finally {
        await closeBrowser();
    }
}

const HASHTAG_SETS = [
    "#ITssue #뉴스 #이슈 #트렌드",
    "#ITssue #오늘의이슈 #뉴스요약 #트렌드",
    "#ITssue #실시간이슈 #뉴스 #이슈",
    "#ITssue #이슈정리 #뉴스 #오늘뉴스",
    "#ITssue #트렌드분석 #뉴스 #이슈",
    "#ITssue #뉴스정리 #이슈 #트렌드"
];

async function generateInstagramCaption(type: BoardType, date: string, summaries: FinalIssueBoard[]): Promise<string> {
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

// Re-using the logic from main-orchestrator
/**
 * [Logic] 카드 뉴스 이미지 세트 생성기
 * [Description] P1(랭킹), P2~P5(상위 이슈 상세), P6~P7(하위 이슈 그룹) 이미지를 순차적으로 렌더링합니다.
 */
async function renderFullSet(issues: FinalIssueBoard[], date: string, type: string, theme: string, dir: string, isSummaryMode: boolean, boardTitle: string, visualVersion: 'bubblegum' | 'arcade' = 'bubblegum', p1Title?: string) {
    const renderOpts = { visualVersion };
    // P1 Ranking Page
    const p1Data = {
        type: 'ranking' as const,
        date, theme, boardTitle, p1Title,
        ranking: issues.map(i => ({ rank: i.rank!, keyword: i.representative_keyword }))
    };
    await renderCard(p1Data, { ...renderOpts, outputPath: path.join(dir, `P1_${type}_${date}.png`) });

    if (!isSummaryMode) {
        for (const issue of issues) {
            const detailData = {
                type: 'issue-detail' as const,
                date, theme, boardTitle,
                rank: issue.rank!,
                keyword: issue.representative_keyword,
                subKeywords: issue.tags,
                summary: issue.instagram_summary
            };
            // [Change] Remove {safeName} suffix
            await renderCard(detailData, { ...renderOpts, outputPath: path.join(dir, `P${issue.rank! + 1}_${type}_${date}.png`) });
        }
    } else {
        const top3 = issues.slice(0, 3);
        for (const issue of top3) {
            const detailData = {
                type: 'issue-detail' as const,
                date, theme, boardTitle,
                rank: issue.rank!,
                keyword: issue.representative_keyword,
                subKeywords: issue.tags,
                summary: issue.instagram_summary
            };
            // [Change] Remove {safeName} suffix
            await renderCard(detailData, { ...renderOpts, outputPath: path.join(dir, `P${issue.rank! + 1}_${type}_${date}.png`) });
        }

        const group4to6 = issues.slice(3, 6);
        if (group4to6.length > 0) {
            const groupData = {
                type: 'group' as const, date, theme, boardTitle, rankRange: "TOP 4 ~ TOP 6",
                issues: group4to6.map(iss => ({
                    rank: iss.rank!,
                    keyword: iss.representative_keyword,
                    subKeywords: iss.tags,
                    summaryLines: iss.instagram_summary.slice(0, 2)
                }))
            };
            // [Change] Remove _Group4-6 suffix
            await renderCard(groupData, { ...renderOpts, outputPath: path.join(dir, `P5_${type}_${date}.png`) });
        }

        const group7to10 = issues.slice(6, 10);
        if (group7to10.length > 0) {
            const groupData = {
                type: 'group' as const, date, theme, boardTitle, rankRange: "TOP 7 ~ TOP 10",
                issues: group7to10.map(iss => ({
                    rank: iss.rank!,
                    keyword: iss.representative_keyword,
                    subKeywords: iss.tags,
                    summaryLines: iss.instagram_summary.slice(0, 2)
                }))
            };
            // [Change] Remove _Group7-10 suffix
            await renderCard(groupData, { ...renderOpts, outputPath: path.join(dir, `P6_${type}_${date}.png`) });
        }
    }
}

runManualRender();
