import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';
import axios from 'axios';

dotenv.config({ path: path.join(__dirname, '../.env') });

const supabase = createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_KEY || ''
);

// 환경 변수 설정
const IG_USER_ID = process.env.IG_USER_ID;
const IG_ACCESS_TOKEN = process.env.IG_ACCESS_TOKEN; // .env에 있는 토큰 사용

if (!IG_USER_ID || !IG_ACCESS_TOKEN) {
    console.error('❌ IG_USER_ID or IG_ACCESS_TOKEN is missing in .env');
    process.exit(1);
}

const BASE_URL = 'https://graph.facebook.com/v24.0';

async function getRecentMedia() {
    try {
        const url = `${BASE_URL}/${IG_USER_ID}/media`;
        const response = await axios.get(url, {
            params: {
                fields: 'id,timestamp,media_type,caption',
                access_token: IG_ACCESS_TOKEN,
                limit: 50 // 최근 50개 조회
            }
        });
        return response.data.data || [];
    } catch (error: any) {
        console.error('❌ Failed to fetch Instagram media:', error.response?.data || error.message);
        return [];
    }
}

async function recoverMissingIds() {
    console.log('🔍 Finding issue_boards with missing Instagram IDs...');

    // 1. instagram_post_id가 비어있는 최신 레코드 조회
    const { data: boards, error } = await supabase
        .from('issue_boards')
        .select('id, board_type, created_at, caption, metadata')
        .is('instagram_post_id', null)
        .order('created_at', { ascending: false })
        .limit(20);

    if (error) {
        console.error('❌ Supabase fetch error:', error);
        return;
    }

    if (!boards || boards.length === 0) {
        console.log('✅ No records found with missing Instagram IDs.');
        return;
    }

    console.log(`📊 Found ${boards.length} records. Fetching recent media from Instagram...`);

    // 2. 인스타그램 최근 게시물 조회
    const recentMedia = await getRecentMedia();
    console.log(`📸 Fetched ${recentMedia.length} recent posts from Instagram.`);

    let recoveredCount = 0;

    // 3. 매칭 및 업데이트
    for (const board of boards) {
        const boardTime = new Date(board.created_at).getTime();

        // 매칭 조건: 
        // 1. 시간 차이가 10분 이내 (업토드 시간 고려)
        // 2. CAROUSEL_ALBUM 타입
        const match = recentMedia.find((media: any) => {
            if (media.media_type !== 'CAROUSEL_ALBUM') return false;

            const mediaTime = new Date(media.timestamp).getTime();
            const diffMinutes = Math.abs((boardTime - mediaTime) / 60000);

            return diffMinutes <= 10; // 10분 이내 허용
        });

        if (match) {
            console.log(`\n✅ Match Found!`);
            console.log(`   - Board ID: ${board.id} (${board.board_type}) - ${board.created_at}`);
            console.log(`   - IG Media: ${match.id} - ${match.timestamp}`);
            console.log(`   - Time Diff: ${Math.round(Math.abs((boardTime - new Date(match.timestamp).getTime()) / 60000))} mins`);

            // 업데이트 실행
            const { error: updateError } = await supabase
                .from('issue_boards')
                .update({
                    instagram_post_id: match.id,
                    metadata: { ...board.metadata, recovered_at: new Date().toISOString() } // 메타데이터 보존 로직 필요하나 일단 간단히
                })
                .eq('id', board.id);

            if (updateError) {
                console.error(`   ❌ Update failed: ${updateError.message}`);
            } else {
                console.log(`   ✨ DB Updated successfully.`);
                recoveredCount++;
            }
        } else {
            console.log(`\n⚠️ No match found for Board ID: ${board.id} (${board.created_at})`);
        }
    }

    console.log(`\n🎉 Recovery Complete. Total recovered: ${recoveredCount}/${boards.length}`);
}

recoverMissingIds();
