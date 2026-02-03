import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const supabase = createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_KEY || ''
);

async function checkMissingIds() {
    console.log('🔍 Checking for missing Instagram IDs in issue_boards...');

    const { data, error } = await supabase
        .from('issue_boards')
        .select('id, type, created_at, instagram_post_id, metadata')
        .is('instagram_post_id', null)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('❌ Error fetching records:', error);
        return;
    }

    console.log(`📊 Found ${data?.length || 0} records with missing Instagram IDs.`);

    if (data && data.length > 0) {
        console.log('\n--- Sample Records (Latest 5) ---');
        data.slice(0, 5).forEach(row => {
            console.log(`ID: ${row.id} | Type: ${row.type} | Created At: ${row.created_at}`);
            if (row.metadata) console.log(`   Metadata: ${JSON.stringify(row.metadata)}`);
        });
    }
}

checkMissingIds();
