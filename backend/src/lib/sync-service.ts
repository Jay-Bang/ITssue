import { Logger } from './logger';
import { supabase } from '../db/supabase-client';
import { InstagramPublisher } from '../publish/instagram-publisher';

export async function syncInstagramId(boardId: string): Promise<{ success: boolean; mediaId?: string }> {
    try {
        // 1. 해당 보드 정보 조회
        const { data: board, error } = await supabase
            .from('issue_boards')
            .select('created_at, metadata, instagram_post_id')
            .eq('id', boardId)
            .single();

        if (error || !board) {
            Logger.error(`[Sync] Board not found: ${boardId}`, error);
            return { success: false };
        }

        const publisher = new InstagramPublisher();

        // [Logic] Case A: 이미 ID는 있는데 Permalink가 누락된 경우 (과거 데이터 수기 보정)
        if (board.instagram_post_id) {
            Logger.info(`[Sync] Board ${boardId} already has ID ${board.instagram_post_id}. Repairing permalink...`);
            const permalink = await publisher.getMediaPermalink(board.instagram_post_id);

            if (permalink) {
                const { error: updateError } = await supabase
                    .from('issue_boards')
                    .update({
                        metadata: {
                            ...board.metadata,
                            instagram_permalink: permalink,
                            manual_repaired_at: new Date().toISOString()
                        }
                    })
                    .eq('id', boardId);

                if (updateError) throw updateError;
                Logger.success(`[Sync] Successfully repaired permalink for board ${boardId}`);
                return { success: true, mediaId: board.instagram_post_id };
            }
        }

        // [Logic] Case B: ID 자체가 없는 경우 (기존 매칭 로직)
        Logger.info(`[Sync] Searching match for board created at: ${board.created_at}`);
        const targetDate = new Date(board.created_at);
        const recoveredPost = await publisher.findAndRecoverPost(targetDate);

        // 3. 찾았다면 DB 업데이트
        if (recoveredPost) {
            const { error: updateError } = await supabase
                .from('issue_boards')
                .update({
                    instagram_post_id: recoveredPost.id,
                    metadata: {
                        ...board.metadata,
                        instagram_permalink: recoveredPost.permalink,
                        manual_synced_at: new Date().toISOString()
                    }
                })
                .eq('id', boardId);

            if (updateError) {
                Logger.error(`[Sync] DB Update failed for ${boardId}`, updateError);
                return { success: false };
            }

            Logger.success(`[Sync] Successfully updated board ${boardId} with media ID: ${recoveredPost.id}`);
            return { success: true, mediaId: recoveredPost.id };
        } else {
            Logger.warn(`[Sync] No matching Instagram post found for board ${boardId}`);
            return { success: false };
        }

    } catch (err) {
        Logger.error(`[Sync] Critical error during sync for ${boardId}`, err);
        return { success: false };
    }
}
