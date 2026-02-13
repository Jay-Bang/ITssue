import axios from 'axios';
import { Logger } from '../lib/logger';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * [Threads Content Publisher]
 * 
 * [Description] Threads API를 사용하여 분석 결과 이미지를 캐러셀 형태의 피드로 게시하는 도구입니다.
 * 
 * [Design Intent]
 * - InstagramPublisher와 유사한 인터페이스를 제공하여 일관성을 유지합니다.
 * - Threads API 특유의 500자 텍스트 제한 및 캐러셀 규격(최대 20장)을 준수합니다.
 */
export class ThreadsPublisher {
    private readonly baseUrl = 'https://graph.threads.net/v1.0';
    private readonly threadsUserId: string;
    private accessToken: string;
    private supabase;

    constructor() {
        this.threadsUserId = process.env.THREADS_USER_ID || '';
        this.accessToken = process.env.THREADS_ACCESS_TOKEN || process.env.IG_ACCESS_TOKEN || '';
        this.supabase = createClient(
            process.env.SUPABASE_URL || '',
            process.env.SUPABASE_SERVICE_KEY || ''
        );

        if (!this.threadsUserId || !this.accessToken) {
            Logger.warn('[Threads] THREADS_USER_ID or ACCESS_TOKEN is missing in .env');
        }

        // 비동기 토큰 로딩 (Supabase 연동)
        this.initialized = this.loadAccessToken();
    }

    private initialized: Promise<void>;

    /**
     * 토큰 로딩이 완료될 때까지 대기하는 헬퍼
     */
    async ensureInitialized(): Promise<void> {
        await this.initialized;
    }

    /**
     * Access Token 로딩 (Supabase → .env fallback)
     * [Logic] 인스타그램과 동일한 테이블에서 공유 토큰을 가져옵니다.
     */
    private async loadAccessToken(): Promise<void> {
        try {
            const { data, error } = await this.supabase
                .from('instagram_tokens')
                .select('access_token')
                .eq('id', 1)
                .single();

            if (!error && data?.access_token) {
                this.accessToken = data.access_token;
                Logger.info('[Threads] Successfully loaded access token from Supabase.');
            } else {
                Logger.warn('[Threads] Failed to find token in Supabase, using fallback from .env');
            }
        } catch (e: any) {
            Logger.error('[Threads] Error loading token from Supabase', e.message);
        }
    }

    private async sleep(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 개별 이미지에 대한 항목 컨테이너 생성
     */
    private async createItemContainer(imageUrl: string): Promise<string> {
        const url = `${this.baseUrl}/${this.threadsUserId}/threads`;
        try {
            const response = await axios.post(url, null, {
                params: {
                    media_type: 'IMAGE',
                    image_url: imageUrl,
                    is_carousel_item: true,
                    access_token: this.accessToken
                }
            });
            return response.data.id;
        } catch (error: any) {
            const errorDetail = error.response?.data?.error || error.response?.data || error.message;
            Logger.error(`[Threads] Failed to create item container: ${imageUrl}`, errorDetail);
            throw error;
        }
    }

    /**
     * 여러 이미지 컨테이너 ID를 하나로 묶어 캐러셀 컨테이너 생성
     */
    private async createCarouselContainer(childrenIds: string[], text: string): Promise<string> {
        const url = `${this.baseUrl}/${this.threadsUserId}/threads`;
        try {
            // 500자 제한 준수
            const truncatedText = text.length > 500 ? text.substring(0, 497) + "..." : text;

            const response = await axios.post(url, null, {
                params: {
                    media_type: 'CAROUSEL',
                    children: childrenIds.join(','),
                    text: truncatedText,
                    access_token: this.accessToken
                }
            });
            return response.data.id;
        } catch (error: any) {
            const errorDetail = error.response?.data?.error || error.response?.data || error.message;
            Logger.error(`[Threads] Failed to create carousel container`, errorDetail);
            throw error;
        }
    }

    /**
     * 생성된 컨테이너를 실제로 사용자 피드에 발행
     */
    private async publishMedia(creationId: string): Promise<{ id: string }> {
        const url = `${this.baseUrl}/${this.threadsUserId}/threads_publish`;
        try {
            const response = await axios.post(url, null, {
                params: {
                    creation_id: creationId,
                    access_token: this.accessToken
                }
            });
            return { id: response.data.id };
        } catch (error: any) {
            const errorDetail = error.response?.data?.error || error.response?.data || error.message;
            Logger.error(`[Threads] Failed to publish media`, errorDetail);
            throw error;
        }
    }

    /**
     * [Main Entry] Threads 캐러셀 포스팅 통합 실행
     * 
     * @param imageUrls - 업로드할 이미지 URL 배열
     * @param text - 게시물 본문
     * @returns 발행된 게시물의 고유 ID
     */
    async publishCarousel(imageUrls: string[], text: string): Promise<string | null> {
        await this.ensureInitialized();

        if (!this.threadsUserId || !this.accessToken) {
            Logger.error('[Threads] Cannot publish: Missing credentials.');
            return null;
        }

        try {
            Logger.info(`🧵 Starting Threads carousel publish with ${imageUrls.length} images...`);

            // [Step 1] 개별 이미지 항목 컨테이너 생성
            const itemIds: string[] = [];
            for (const url of imageUrls) {
                Logger.info(`   - Creating container for: ${url.split('/').pop()}`);
                const id = await this.createItemContainer(url);
                itemIds.push(id);
                // 연이은 요청으로 인한 차단 방지 (Threads는 비교적 넉넉하지만 안전을 위해 2초 대기)
                await this.sleep(2000);
            }

            // [Safety] 이미지 처리 대기 (Threads API는 컨테이너 생성 후 처리에 시간이 걸릴 수 있음)
            Logger.info('⏳ Waiting 30s for processing...');
            await this.sleep(30000);

            // [Step 2] 캐러셀 컨테이너 생성
            Logger.info('📦 Assembling carousel container...');
            const carouselContainerId = await this.createCarouselContainer(itemIds, text);

            // [Step 3] 최종 미디어 발행
            Logger.info('🚀 Publishing to Threads (with retries)...');
            let result: { id: string } | null = null;
            let retryCount = 0;
            const maxRetries = 2;

            while (retryCount <= maxRetries) {
                try {
                    result = await this.publishMedia(carouselContainerId);
                    if (result) break;
                } catch (error: any) {
                    retryCount++;
                    if (retryCount > maxRetries) throw error;

                    const waitTime = retryCount * 10000;
                    Logger.warn(`⚠️ Threads Publish failed (Attempt ${retryCount}/${maxRetries + 1}). Retrying in ${waitTime / 1000}s...`);
                    await this.sleep(waitTime);
                }
            }

            Logger.success(`🎉 Published successfully to Threads! Media ID: ${result?.id}`);
            return result?.id || null;

        } catch (error: any) {
            Logger.error('[Threads] Complete publish flow failed.', error.message);
            return null;
        }
    }
}
