import { Logger } from './logger';
import { supabase } from '../db/supabase-client';
import { InstagramPublisher } from '../publish/instagram-publisher';

export async function syncInstagramId(boardId: string): Promise<{ success: boolean; mediaId?: string }> {
    try {
        // 1. 해당 보드 정보 조회
        const { data: board, error } = await supabase
            .from('issue_boards')
            .select('created_at, metadata')
            .eq('id', boardId)
            .single();

        if (error || !board) {
            Logger.error(`[Sync] Board not found: ${boardId}`, error);
            return { success: false };
        }

        Logger.info(`[Sync] Searching match for board created at: ${board.created_at}`);

        // 2. InstagramPublisher를 통해 매칭되는 게시물 검색
        const publisher = new InstagramPublisher();
        const targetDate = new Date(board.created_at);
        const recoveredId = await publisher.findAndRecoverPost(targetDate);

        // 3. 찾았다면 DB 업데이트
        if (recoveredId) {
            const { error: updateError } = await supabase
                .from('issue_boards')
                .update({
                    instagram_post_id: recoveredId,
                    metadata: {
                        ...board.metadata,
                        manual_synced_at: new Date().toISOString()
                    }
                })
                .eq('id', boardId);

            if (updateError) {
                Logger.error(`[Sync] DB Update failed for ${boardId}`, updateError);
                return { success: false };
            }

            Logger.success(`[Sync] Successfully updated board ${boardId} with media ID: ${recoveredId}`);
            return { success: true, mediaId: recoveredId };
        } else {
            Logger.warn(`[Sync] No matching Instagram post found for board ${boardId}`);
            return { success: false };
        }

    } catch (err) {
        Logger.error(`[Sync] Critical error during sync for ${boardId}`, err);
        return { success: false };
    }
}
