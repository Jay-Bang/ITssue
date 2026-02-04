/**
 * [Republish Service]
 * 
 * [Description] 이미 생성된 보드를 수정하거나 수동으로 인스타그램에 다시 게시하기 위한 운영 지원 서비스입니다.
 * 
 * [Design Intent]
 * - [Logic] 데이터 항목(DB)과 시각 에셋(Storage) 간의 정합성을 수동으로 강제 동기화할 수 있는 수단을 제공합니다.
 * - [Fix] 자동 발행 과정에서 누락된 데이터를 보정하고 SNS 재배포를 수행합니다.
 */
import * as path from 'path';
import * as fs from 'fs-extra';
import { supabase } from '../db/supabase-client';
import { closeBrowser, renderFullSet } from '../visual/card-renderer';
import { Logger } from '../lib/logger';
import { InstagramPublisher } from '../publish/instagram-publisher';
import { uploadInstagramImages } from '../publish/storage-manager';
import { NotificationService } from '../lib/notifier';
import * as Handlebars from 'handlebars';
import { FinalIssueBoard, BoardType } from '../types';

export async function republishBoard(boardId: string) {
    Logger.info(`🔄 [RepublishService] Starting republish for Board ID: ${boardId}`);

    try {
        // [Step 1] Supabase에서 기존 보드 및 아이템 정보 조회
        const { data: board, error: boardError } = await supabase
            .from('issue_boards')
            .select('*')
            .eq('id', boardId)
            .single();

        if (boardError || !board) throw new Error(`Board not found: ${boardError?.message}`);

        // 2. Fetch Board Items (Content) from Supabase
        const { data: items, error: itemsError } = await supabase
            .from('issue_board_items')
            .select('*')
            .eq('board_id', boardId)
            .order('rank', { ascending: true });

        if (itemsError || !items) throw new Error(`Items not found: ${itemsError?.message}`);

        const type = board.board_type as BoardType;
        const dateStr = board.target_date.replace(/-/g, '.'); // YYYY.MM.DD
        const visualVersion = type === 'NOON' ? 'arcade' : 'bubblegum';
        const theme = visualVersion; // Align theme with visual version

        // 3. Format Data for Renderer (Verified with Supabase MCP)
        const formattedIssues: FinalIssueBoard[] = items.map(item => ({
            rank: item.rank,
            representative_keyword: item.keyword, // DB 'keyword' -> Type 'representative_keyword'
            instagram_summary: typeof item.instagram_summary === 'string'
                ? item.instagram_summary.split('\n').filter((line: string) => line.trim() !== '')
                : (item.instagram_summary || []),
            tags: Array.isArray(item.tags) ? item.tags : [],
            score: Number(item.score) || 0,
            news_titles: Array.isArray(item.news_titles) ? item.news_titles : []
        }));

        // 4. Setup Directories
        const tempDir = path.join(process.cwd(), 'output', 'temp_republish', `${boardId}_${Date.now()}`);
        await fs.ensureDir(tempDir);

        // 5. Render Images
        Logger.info(`🎨 Rendering images to: ${tempDir}`);
        const boardTitle = type === 'NOON' ? '정오 이슈 보드' : '일일 이슈 보드';
        const p1Title = type === 'NOON' ? 'MIDDAY TRENDS' : 'DAILY TRENDS';

        await renderFullSet(formattedIssues, dateStr, type, theme, tempDir, boardTitle, visualVersion, p1Title);

        // 6. Generate Caption
        const caption = await generateInstagramCaption(type, dateStr, formattedIssues);

        // 7. Upload to Storage
        Logger.info("🌐 Syncing with Supabase Storage...");
        const storageTag = `republish_${boardId}_${Date.now()}`;
        const imageUrls = await uploadInstagramImages(tempDir, storageTag);

        // 8. Publish to Instagram
        Logger.info("📸 Publishing to Instagram...");
        const igPublisher = new InstagramPublisher();

        // Delete old post if exists (optional but recommended for republication)
        if (board.instagram_post_id) {
            try {
                await igPublisher.deleteMedia(board.instagram_post_id);
            } catch (err) {
                Logger.warn(`Failed to delete old post: ${err}`);
            }
        }

        const igMediaId = await igPublisher.publishCarousel(imageUrls.map(img => img.publicUrl), caption);

        if (!igMediaId) throw new Error('Instagram publishing returned no Media ID.');

        // 9. Update Database with new Post ID and Metadata (CRITICAL)
        // [Logic] We do this BEFORE notification to ensure data integrity even if Telegram fails.
        const { error: updateError } = await supabase
            .from('issue_boards')
            .update({
                instagram_post_id: igMediaId,
                storage_urls: imageUrls.map(img => img.publicUrl),
                caption: caption,
                metadata: {
                    ...(board.metadata || {}),
                    republished_at: new Date().toISOString(),
                    note: "Republished via Admin Panel"
                }
            })
            .eq('id', boardId);

        if (updateError) {
            Logger.error(`❌ DB Update Failed for Board: ${boardId}`, updateError);
            throw updateError;
        }

        Logger.success(`✅ Database updated with new IG_MEDIA_ID: ${igMediaId}`);

        // 10. Notify Telegram (NON-CRITICAL)
        // [Safety] Wrap in try-catch so notification timeouts don't crash the whole process.
        try {
            Logger.info("📨 Sending Telegram notification...");
            const notifier = new NotificationService();
            const images = (await fs.readdir(tempDir))
                .filter(f => f.endsWith('.png'))
                .map(f => path.join(tempDir, f))
                .sort();

            await notifier.sendTelegram(type, dateStr, formattedIssues, images, caption);
            Logger.success("✅ Telegram notification sent.");
        } catch (notifyError: any) {
            Logger.warn(`⚠️ Telegram Notification failed (Non-critical): ${notifyError.message || notifyError}`);
        }

        Logger.success(`🎉 Entire republishing flow completed for Board: ${boardId}`);
        await fs.remove(tempDir); // Cleanup

        return { success: true, igMediaId };

    } catch (error: any) {
        Logger.error(`❌ Republishing Failed for Board: ${boardId}`, error);
        throw error;
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
