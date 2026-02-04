/**
 * [manual-renderer.ts]
 * 
 * [Description] 분석 결과(JSON)를 기반으로 우회 이미지 재생성 및 재발행 유틸리티
 * [Architecture] 분석 엔진을 다시 거치지 않고 CSS/HTML 수정본을 즉각적으로 반영하기 위해 사용합니다.
 */
import * as path from 'path';
import * as fs from 'fs-extra';
import { renderCard, closeBrowser, renderFullSet } from '../visual/card-renderer';
import { Logger } from '../lib/logger';
import { InstagramPublisher } from '../publish/instagram-publisher';
import * as Handlebars from 'handlebars';
import { FinalIssueBoard, BoardType } from '../types';
import { generateInstagramCaption } from './orchestrator';
import { supabase } from '../db/supabase-client';
import { uploadInstagramImages } from '../publish/storage-manager';
import { NotificationService } from '../lib/notifier';

/**
 * [Main Logic] 수동 렌더링 및 발행 프로세스 실행부
 * [Description] 지정된 경로의 JSON 리포트를 로드하여 렌더링 파이프라인을 수동으로 트리거합니다.
 */
async function runManualRender() {
    const args = process.argv.slice(2);
    const jsonPath = args.find(arg => !arg.startsWith('--'));
    const shouldPublish = args.includes('--publish');
    const isBubblegum = args.includes('--bubblegum') || args.includes('--modern'); // Support both for transition
    const isArcade = args.includes('--arcade');
    let visualVersion: 'bubblegum' | 'arcade' = isArcade ? 'arcade' : 'bubblegum';
    const SELECTED_THEME = args.find(arg => !arg.startsWith('--') && arg !== jsonPath) || visualVersion;

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
        await fs.ensureDir(dirA);

        // [Config] Version A (Summary/Instagram) - Primary
        const p1Title = type === 'NOON' ? 'MIDDAY TRENDS' : 'DAILY TRENDS';
        const boardTitles = {
            'NIGHT': '일일 이슈 보드',
            'NOON': '정오 이슈 보드',
            'CUSTOM': '커스텀 이슈 보드'
        };
        await renderFullSet(formattedIssues, dateStr, type, SELECTED_THEME, dirA, boardTitles[type as BoardType] || '이슈 보드', visualVersion, p1Title, true);

        // [Logic] Regenerate caption with new hashtag rotation
        const newCaption = await generateInstagramCaption(type, dateStr, formattedIssues);
        const captionPath = path.join(outputDir, `caption_${type}_${dateStr}.txt`);
        await fs.writeFile(captionPath, newCaption, 'utf-8');
        Logger.success(`Caption regenerated with rotation: ${captionPath}`);

        Logger.success(`Re-rendering Completed! Check folder: ${dirA}`);

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

            // [Step 4] 미디어 업로드 및 인스타그램 게시
            // [Safety] 인스타그램 서버의 이미지 캐싱 이슈를 피하기 위해 타임스탬프 기반의 고유 Storage 경로를 사용합니다.
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

runManualRender();
