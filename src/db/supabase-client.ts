import { createClient } from '@supabase/supabase-js';
import { Logger } from '../lib/logger';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * [Supabase Infrastructure]
 * 
 * [Description] 프로젝트 전역에서 사용할 Supabase 클라이언트 인스턴스를 초기화하고 관리합니다.
 * 
 * [Design Intent]
 * - 서버 사이드 배치 작업 및 데이터 분석을 위해 Service Role Key를 사용한 관리자 권한 확보.
 * - 프로젝트 전반의 데이터 영속성(Persistence)을 담당.
 * 
 * [Environment Variables]
 * - SUPABASE_URL: Supabase 프로젝트 API URL
 * - SUPABASE_SERVICE_KEY: Supabase Service Role Key (⚠️ 클라이언트 노출 주의)
 */

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  Logger.warn('⚠️ Supabase URL or Key is missing. Check your .env file.');
} else {
  Logger.info('✅ Supabase client initialized successfully.');
}

export const supabase = createClient(supabaseUrl, supabaseKey);
