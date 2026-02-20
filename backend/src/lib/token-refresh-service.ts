import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import { Logger } from './logger';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * [Social Token Management Service]
 * 
 * [Description] Instagram 및 Threads Access Token을 자동으로 갱신하고 Supabase 전역 설정 테이블에 저장합니다.
 * 
 * [Design Intent]
 * - [Logic] Long-lived Token (60일 유효)을 만료 전 정기적으로 자동 갱신하여 인스타그램 게시 무중단을 보장합니다.
 * - [Strategy] Threads API의 특수성(Refresh vs Exchange)을 고려한 조건부 갱신 로직을 구현했습니다.
 */
export class TokenRefreshService {
    private supabase;
    private appId: string;
    private appSecret: string;

    constructor() {
        this.supabase = createClient(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_KEY!
        );
        this.appId = process.env.FACEBOOK_APP_ID!;
        this.appSecret = process.env.FACEBOOK_APP_SECRET!;
    }

    /**
     * [Logic] Instagram 토큰을 새로운 Long-lived Token으로 교환
     */
    async refreshInstagramToken(): Promise<string> {
        try {
            Logger.info('🔄 Starting Instagram token refresh...');
            const currentToken = await this.getCurrentToken(1); // id=1 for Instagram
            const url = 'https://graph.facebook.com/v24.0/oauth/access_token';
            const response = await axios.get(url, {
                params: {
                    grant_type: 'fb_exchange_token',
                    client_id: this.appId,
                    client_secret: this.appSecret,
                    fb_exchange_token: currentToken
                }
            });

            const newToken = response.data.access_token;
            const expiresIn = response.data.expires_in;
            await this.saveToken(1, newToken, expiresIn);
            Logger.success('💾 Instagram token saved to Supabase (id=1)');
            return newToken;
        } catch (error: any) {
            Logger.error('❌ Instagram token refresh failed', error.message);
            throw error;
        }
    }

    /**
     * [Logic] Threads 토큰을 새로운 Long-lived Token으로 교환 또는 갱신
     * [Strategy]
     * 1. Short-lived -> Long-lived 최초 교환 (th_exchange_token 활용)
     * 2. Long-lived -> Long-lived 정기 연장 (th_refresh_token 활용)
     */
    async refreshThreadsToken(): Promise<string> {
        try {
            Logger.info('🔄 Starting Threads token refresh/exchange...');

            // DB에 id=2가 있는지 확인
            const { data: dbData } = await this.supabase
                .from('instagram_tokens')
                .select('id')
                .eq('id', 2)
                .single();

            const currentToken = await this.getCurrentToken(2);
            let url = '';
            let params: any = {};

            if (!dbData) {
                // [Case A] 최초 등록: Short-lived -> Long-lived 교환
                Logger.info('🆕 Initial Threads token detected. Exchanging for Long-lived token...');
                url = 'https://graph.threads.net/access_token';
                params = {
                    grant_type: 'th_exchange_token',
                    client_secret: this.appSecret,
                    access_token: currentToken
                };
            } else {
                // [Case B] 정기 갱신: Long-lived -> Long-lived 연장
                Logger.info('🔄 Existing Threads token detected. Refreshing...');
                url = 'https://graph.threads.net/refresh_access_token';
                params = {
                    grant_type: 'th_refresh_token',
                    access_token: currentToken
                };
            }

            const response = await axios.get(url, { params });
            const newToken = response.data.access_token;
            const expiresIn = response.data.expires_in; // 60일 (5184000초)

            await this.saveToken(2, newToken, expiresIn);
            Logger.success(`💾 Threads token (${dbData ? 'Refreshed' : 'Exchanged'}) saved to Supabase (id=2)`);
            return newToken;
        } catch (error: any) {
            const errorMsg = error.response?.data?.error?.message || error.message;
            Logger.error('❌ Threads token process failed', errorMsg);
            throw error;
        }
    }

    /**
     * [Logic] 현재 활성화된 토큰 조회 (Supabase DB 우선, .env Fallback 차선)
     */
    private async getCurrentToken(id: number): Promise<string> {
        const { data, error } = await this.supabase
            .from('instagram_tokens')
            .select('access_token')
            .eq('id', id)
            .single();

        if (!error && data?.access_token) {
            Logger.info(`📦 Using token from Supabase (id=${id})`);
            return data.access_token;
        }

        const envToken = id === 1 ? process.env.IG_ACCESS_TOKEN : process.env.THREADS_ACCESS_TOKEN;
        if (!envToken) {
            throw new Error(`No token found for id=${id} in Supabase or .env`);
        }

        Logger.warn(`⚠️ Using fallback token from .env for id=${id}`);
        return envToken;
    }

    /**
     * [Step] 갱신된 새 토큰을 Supabase 전역 설정 테이블에 Persist
     */
    private async saveToken(id: number, token: string, expiresIn: number): Promise<void> {
        const expiresAt = new Date(Date.now() + expiresIn * 1000);

        const { error } = await this.supabase
            .from('instagram_tokens')
            .upsert({
                id: id,
                access_token: token,
                expires_at: expiresAt.toISOString(),
                updated_at: new Date().toISOString()
            });

        if (error) throw error;
    }
}

// [Logic] CLI 환경에서의 직접 실행 및 모드(Instagram/Threads) 전환 지원
if (require.main === module) {
    (async () => {
        const service = new TokenRefreshService();
        const args = process.argv.slice(2);

        if (args.includes('--threads')) {
            await service.refreshThreadsToken();
        } else {
            await service.refreshInstagramToken();
        }
        process.exit(0);
    })();
}
