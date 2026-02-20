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
import { ThreadsPublisher } from '../publish/threads-publisher';
import { FacebookPublisher } from '../publish/facebook-publisher';
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

        // [Step 2] 보드 아이템(콘텐츠) 데이터 조회
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

        // [Step 3] 렌더러 전용 데이터 포매팅
        // [Logic] DB의 원시 필드명을 렌더링 엔진(Handlebars)이 예상하는 구조로 변환합니다.
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

        // [Step 4] 분석 결과물 임시 저장 디렉토리 설정
        const tempDir = path.join(process.cwd(), 'output', 'temp_republish', `${boardId}_${Date.now()}`);
        await fs.ensureDir(tempDir);

        // [Step 5] 카드 뉴스 이미지 렌더링
        // [Logic] 메모리 버퍼 방식으로 렌더링하여 디스크 쓰기 오버헤드를 최소화합니다.
        Logger.info(`🎨 Rendering images to memory`);
        const boardTitle = type === 'NOON' ? '정오 이슈 보드' : '일일 이슈 보드';
        const p1Title = type === 'NOON' ? 'MIDDAY TRENDS' : 'DAILY TRENDS';

        const imageBuffers = await renderFullSet(formattedIssues, dateStr, type, theme, boardTitle, visualVersion, p1Title);

        // [Step 6] 인스타그램 업로드용 캡션 생성
        const caption = await generateInstagramCaption(type, dateStr, formattedIssues);

        // [Step 7] Supabase Storage 클라우드 동기화 (이미지 업로드)
        Logger.info("🌐 Syncing with Supabase Storage...");
        const storageTag = `republish_${boardId}_${Date.now()}`;
        const imageUrls = await uploadInstagramImages(imageBuffers, storageTag);

        // [Step 8] 인스타그램 최종 발행 및 기존 게시물 정리
        Logger.info("📸 Publishing to Instagram...");
        const igPublisher = new InstagramPublisher();

        // [Safety] 중복 방지를 위해 기존 게시물이 있는 경우 삭제를 시도합니다.
        if (board.instagram_post_id) {
            try {
                await igPublisher.deleteMedia(board.instagram_post_id);
            } catch (err) {
                Logger.warn(`Failed to delete old post: ${err}`);
            }
        }

        const igMediaId = await igPublisher.publishCarousel(imageUrls.map(img => img.publicUrl), caption);

        if (!igMediaId) throw new Error('Instagram publishing returned no Media ID.');

        // [Logic] Fetch real permalink with shortcode for reliable linking
        let igPermalink: string | null = null;
        if (igMediaId) {
            igPermalink = await igPublisher.getMediaPermalink(igMediaId);
        }

        // [Step 9] 데이터베이스 동기화 (Post ID 및 메타데이터 업데이트)
        // [Logic] 알림 전송 실패와 무관하게 데이터 정합성을 유지하기 위해 선행 업데이트를 수행합니다.
        const { error: updateError } = await supabase
            .from('issue_boards')
            .update({
                instagram_post_id: igMediaId,
                storage_urls: imageUrls.map(img => img.publicUrl),
                caption: caption,
                metadata: {
                    ...(board.metadata || {}),
                    republished_at: new Date().toISOString(),
                    note: "Republished via Admin Panel",
                    instagram_permalink: igPermalink,
                    threads_post_id: null // Reset or keep? Let's try to republish to Threads too
                }
            })
            .eq('id', boardId);

        if (updateError) {
            Logger.error(`❌ DB Update Failed for Board: ${boardId}`, updateError);
            throw updateError;
        }

        // [Logic] 9.1 Threads에도 동일하게 게시
        Logger.info("🧵 [Republish] Also publishing to Threads...");
        try {
            const threadsPublisher = new ThreadsPublisher();
            const threadsMediaId = await threadsPublisher.publishCarousel(imageUrls.map(img => img.publicUrl), caption);
            if (threadsMediaId) {
                await supabase
                    .from('issue_boards')
                    .update({
                        metadata: {
                            ...(board.metadata || {}),
                            republished_at: new Date().toISOString(),
                            instagram_permalink: igPermalink,
                            threads_post_id: threadsMediaId
                        }
                    })
                    .eq('id', boardId);
                Logger.success(`✨ Threads Repost Complete! ID: ${threadsMediaId}`);
            }
        } catch (thErr: any) {
            Logger.warn(`⚠️ Threads Repost Failed: ${thErr.message}`);
        }

        // [Logic] 9.2 Facebook에도 동일하게 게시
        Logger.info("📘 [Republish] Also publishing to Facebook...");
        try {
            const fbPublisher = new FacebookPublisher();
            const fbPostId = await fbPublisher.publishMultiPhoto(imageUrls.map(img => img.publicUrl), caption);
            if (fbPostId) {
                const { data: currentBoard } = await supabase.from('issue_boards').select('metadata').eq('id', boardId).single();
                await supabase
                    .from('issue_boards')
                    .update({
                        metadata: {
                            ...(currentBoard?.metadata || {}),
                            facebook_post_id: fbPostId
                        }
                    })
                    .eq('id', boardId);
                Logger.success(`✨ Facebook Repost Complete! ID: ${fbPostId}`);
            }
        } catch (fbErr: any) {
            Logger.warn(`⚠️ Facebook Repost Failed: ${fbErr.message}`);
        }

        Logger.success(`✅ Database updated with new IG_MEDIA_ID: ${igMediaId}`);

        // [Step 10] 텔레그램 최종 알림 전송 (비디오 포함)
        // [Safety] 알림 전송은 부차적인 기능이므로 실패해도 전체 프로세스 중단을 방해하지 않도록 처리합니다.
        try {
            Logger.info("📨 Sending Telegram notification...");
            const notifier = new NotificationService();

            const images: string[] = [];
            for (const img of imageBuffers) {
                const filePath = path.join(tempDir, img.fileName);
                await fs.writeFile(filePath, img.buffer);
                images.push(filePath);
            }
            images.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));

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

export async function retryPublishBoard(boardId: string) {
    Logger.info(`🔄 [RetryService] Starting retry publish for Board ID: ${boardId}`);

    try {
        // [Step 1] 보드 기본 정보 조회
        const { data: board, error: boardError } = await supabase
            .from('issue_boards')
            .select('*')
            .eq('id', boardId)
            .single();

        if (boardError || !board) throw new Error(`Board not found: ${boardError?.message}`);

        // [Step 2] 최소 요구사항 검증 (Storage URL 존재 여부)
        // [Safety] 이미지가 Storage에 업로드되어 있지 않은 경우 렌더링을 포함한 전체 재발행(Republish)이 권장됩니다.
        const imageUrls = board.storage_urls;
        if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0) {
            throw new Error(`❌ No storage URLs found. Cannot retry publish without existing images. Please use full 'Republish' instead.`);
        }

        Logger.info(`✅ Found ${imageUrls.length} existing images. Skipping rendering.`);

        // [Step 3] 캡션용 아이템 데이터 재조회
        const { data: items, error: itemsError } = await supabase
            .from('issue_board_items')
            .select('*')
            .eq('board_id', boardId)
            .order('rank', { ascending: true });

        if (itemsError || !items) throw new Error(`Items not found: ${itemsError?.message}`);

        const formattedIssues: FinalIssueBoard[] = items.map(item => ({
            rank: item.rank,
            representative_keyword: item.keyword,
            instagram_summary: typeof item.instagram_summary === 'string'
                ? item.instagram_summary.split('\n').filter((line: string) => line.trim() !== '')
                : (item.instagram_summary || []),
            tags: item.tags || [],
            score: item.score || 0,
            news_titles: item.news_titles || []
        }));

        const type = board.board_type as BoardType;
        const dateStr = board.target_date.replace(/-/g, '.');

        // [Step 4] 인스타그램 업로드용 캡션 생성
        const caption = await generateInstagramCaption(type, dateStr, formattedIssues);

        // [Step 5] 인스타그램 조건부 발행 (게시 ID가 없는 경우에만 수행)
        let igMediaId = board.instagram_post_id;
        let igPermalink = board.metadata?.instagram_permalink;

        if (!igMediaId) {
            Logger.info("📸 Retry: Publishing to Instagram...");
            const igPublisher = new InstagramPublisher();
            igMediaId = await igPublisher.publishCarousel(imageUrls, caption);

            if (!igMediaId) throw new Error('Instagram publishing returned no Media ID.');

            // [Step 6] 게시물 퍼머링크 조회
            igPermalink = await igPublisher.getMediaPermalink(igMediaId);
        } else {
            Logger.info(`✅ Instagram already published (ID: ${igMediaId}). Skipping.`);
        }

        // [Step 7] 데이터베이스 동기화 및 메타데이터 갱신
        const { error: updateError } = await supabase
            .from('issue_boards')
            .update({
                instagram_post_id: igMediaId,
                caption: caption, // Update caption just in case it changed
                metadata: {
                    ...(board.metadata || {}),
                    republished_at: new Date().toISOString(),
                    note: "Retried Publish via Admin Panel",
                    instagram_permalink: igPermalink,
                    threads_post_id: board.metadata?.threads_post_id // Keep existing or retry?
                }
            })
            .eq('id', boardId);

        if (updateError) throw updateError;

        // [Logic] 7.1 Threads Retry
        if (!board.metadata?.threads_post_id) {
            Logger.info("🧵 [Retry] Publishing missing post to Threads...");
            try {
                const threadsPublisher = new ThreadsPublisher();
                const threadsMediaId = await threadsPublisher.publishCarousel(imageUrls, caption);
                if (threadsMediaId) {
                    await supabase
                        .from('issue_boards')
                        .update({
                            metadata: {
                                ...(board.metadata || {}),
                                republished_at: new Date().toISOString(),
                                instagram_permalink: igPermalink,
                                threads_post_id: threadsMediaId
                            }
                        })
                        .eq('id', boardId);
                }
            } catch (thErr: any) {
                Logger.warn(`⚠️ Threads Retry Failed: ${thErr.message}`);
            }
        }

        // [Logic] 7.2 Facebook Retry
        if (!board.metadata?.facebook_post_id) {
            Logger.info("📘 [Retry] Publishing missing post to Facebook...");
            try {
                const fbPublisher = new FacebookPublisher();
                const fbPostId = await fbPublisher.publishMultiPhoto(imageUrls, caption);
                if (fbPostId) {
                    const { data: currentBoard } = await supabase.from('issue_boards').select('metadata').eq('id', boardId).single();
                    await supabase
                        .from('issue_boards')
                        .update({
                            metadata: {
                                ...(currentBoard?.metadata || {}),
                                facebook_post_id: fbPostId
                            }
                        })
                        .eq('id', boardId);
                }
            } catch (fbErr: any) {
                Logger.warn(`⚠️ Facebook Retry Failed: ${fbErr.message}`);
            }
        }

        Logger.success(`🎉 Retry Publish Successful! ID: ${igMediaId}`);
        return { success: true, igMediaId };

    } catch (error: any) {
        Logger.error(`❌ Retry Failed for Board: ${boardId}`, error);
        throw error;
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
