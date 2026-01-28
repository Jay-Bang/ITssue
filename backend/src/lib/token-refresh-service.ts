import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import { Logger } from './logger';

/**
 * [Instagram Token Refresh Service]
 * 
 * Instagram Access Token을 자동으로 갱신하고 Supabase에 저장합니다.
 * Long-lived Token (60일 유효)을 매월 자동 갱신하여 만료를 방지합니다.
 */
export class TokenRefreshService {
    private supabase;
    private appId: string;
    private appSecret: string;

    constructor() {
        this.supabase = createClient(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );
        this.appId = process.env.FACEBOOK_APP_ID!;
        this.appSecret = process.env.FACEBOOK_APP_SECRET!;
    }

    /**
     * 현재 토큰을 새로운 Long-lived Token으로 교환
     */
    async refreshToken(): Promise<string> {
        try {
            Logger.info('🔄 Starting Instagram token refresh...');

            // 1. 현재 토큰 가져오기 (Supabase 우선, 없으면 .env)
            const currentToken = await this.getCurrentToken();

            // 2. Facebook Graph API로 토큰 갱신
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
            const expiresIn = response.data.expires_in; // 초 단위 (보통 5184000 = 60일)

            Logger.success(`✅ New token received (expires in ${expiresIn / 86400} days)`);

            // 3. Supabase에 저장
            await this.saveToken(newToken, expiresIn);

            Logger.success('💾 Token saved to Supabase');
            return newToken;

        } catch (error: any) {
            Logger.error('❌ Token refresh failed', error.message);
            throw error;
        }
    }

    /**
     * 현재 토큰 가져오기 (Supabase → .env fallback)
     */
    private async getCurrentToken(): Promise<string> {
        // Supabase에서 조회
        const { data, error } = await this.supabase
            .from('instagram_tokens')
            .select('access_token')
            .eq('id', 1)
            .single();

        if (!error && data?.access_token) {
            Logger.info('📦 Using token from Supabase');
            return data.access_token;
        }

        // Fallback: .env
        const envToken = process.env.IG_ACCESS_TOKEN;
        if (!envToken) {
            throw new Error('No token found in Supabase or .env');
        }

        Logger.warn('⚠️ Using fallback token from .env');
        return envToken;
    }

    /**
     * 새 토큰을 Supabase에 저장
     */
    private async saveToken(token: string, expiresIn: number): Promise<void> {
        const expiresAt = new Date(Date.now() + expiresIn * 1000);

        const { error } = await this.supabase
            .from('instagram_tokens')
            .upsert({
                id: 1,
                access_token: token,
                expires_at: expiresAt.toISOString(),
                updated_at: new Date().toISOString()
            });

        if (error) throw error;
    }
}

// CLI 실행용
if (require.main === module) {
    (async () => {
        const service = new TokenRefreshService();
        await service.refreshToken();
        process.exit(0);
    })();
}
