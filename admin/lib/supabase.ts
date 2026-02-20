/**
 * [Admin Infrastructure: Supabase Client]
 * 
 * [Description] 관리자 도구에서 Supabase API와 통신하기 위한 클라이언트를 초기화합니다.
 * 
 * [Design Intent]
 * - Next.js 환경 변수(`NEXT_PUBLIC_`)를 사용하여 클라이언트 사이드에서의 안전한 접근 지원.
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// [Logic] 글로벌 싱글톤 Supabase 인스턴스 초기화
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
