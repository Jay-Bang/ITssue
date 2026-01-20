import { createClient } from '@supabase/supabase-js';
import { Logger } from '../lib/logger';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * Supabase 클라이언트 초기화
 * 
 * [역할]
 * 프로젝트 전역에서 사용할 Supabase 클라이언트 인스턴스를 생성합니다.
 * 
 * [환경 변수]
 * - SUPABASE_URL: Supabase 프로젝트 URL (필수)
 * - SUPABASE_SERVICE_KEY: Supabase Service Role Key (필수)
 *   ⚠️ Service Role Key는 서버 환경에서만 사용해야 하며, 클라이언트에 노출되면 안 됩니다.
 * 
 * [사용 테이블]
 * - raw_trends: API 원본 응답 저장
 * - trend_snapshots: 개별 키워드 스냅샷
 * - issue_boards: 분석 결과 보드 메타데이터
 * - issue_board_items: 보드별 상세 이슈 데이터
 */

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  Logger.warn('⚠️ Supabase URL or Key is missing. Check your .env file.');
} else {
  Logger.info('✅ Supabase client initialized successfully.');
}

export const supabase = createClient(supabaseUrl, supabaseKey);
