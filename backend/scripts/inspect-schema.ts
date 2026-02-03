import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const supabase = createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_KEY || ''
);

async function checkSchema() {
    console.log('🔍 Checking schema of issue_boards...');

    // 키 하나만 가져와서 컬럼 확인
    const { data, error } = await supabase
        .from('issue_boards')
        .select('*')
        .limit(1);

    if (error) {
        console.error('❌ Error fetching record:', error);
        return;
    }

    if (data && data.length > 0) {
        console.log('✅ Columns found:', Object.keys(data[0]));
        console.log('Sample record:', data[0]);
    } else {
        console.log('⚠️ Table seems empty or no access.');
    }
}

checkSchema();
