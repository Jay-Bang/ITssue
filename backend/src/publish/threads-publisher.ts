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
 * - [Logic] InstagramPublisher와 유사한 인터페이스를 제공하여 모듈 간 일관성을 유지합니다.
 * - [Safety] Threads API의 특유 정책(500자 텍스트 제한, 최대 20장 캐러셀)을 준수하도록 설계되었습니다.
 */
export class ThreadsPublisher {
    private readonly baseUrl = 'https://graph.threads.net/v1.0';
    private readonly threadsUserId: string;
    private accessToken: string;
    private supabase; // [Logic] 토큰 동기화를 위한 Supabase 클라이언트

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

        // [Logic] 비동기 토큰 로딩 (Supabase 연동)
        this.initialized = this.loadAccessToken();
    }

    private initialized: Promise<void>;

    /**
     * [Logic] 토큰 로딩 초기화 대기 헬퍼
     */
    async ensureInitialized(): Promise<void> {
        await this.initialized;
    }

    /** [Logic] Access Token 로딩 (Supabase -> .env fallback) */
    private async loadAccessToken(): Promise<void> {
        try {
            // [Design Change] Threads requires a separate token (id=2 in our schema).
            const { data, error } = await this.supabase
                .from('instagram_tokens')
                .select('access_token')
                .eq('id', 2)
                .single();

            if (!error && data?.access_token) {
                this.accessToken = data.access_token;
                Logger.info('[Threads] Successfully loaded access token from Supabase (id=2).');
                return;
            }

            // Fallback to .env (only for first-time setup or emergency)
            if (process.env.THREADS_ACCESS_TOKEN?.startsWith('TH')) {
                this.accessToken = process.env.THREADS_ACCESS_TOKEN;
                Logger.info('[Threads] Using Threads-specific token from .env (Fallback)');
            } else {
                Logger.warn('[Threads] No specific token found in DB or .env');
            }
        } catch (e: any) {
            Logger.error('[Threads] Error loading token', e.message);
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
    private async createCarouselContainer(childrenIds: string[], text: string, topicTag?: string): Promise<string> {
        const url = `${this.baseUrl}/${this.threadsUserId}/threads`;
        try {
            // [Step] 500자 제한 준수 (Truncation Strategy)
            const truncatedText = text.length > 500 ? text.substring(0, 497) + "..." : text;

            const params: any = {
                media_type: 'CAROUSEL',
                children: childrenIds.join(','),
                text: truncatedText,
                access_token: this.accessToken
            };

            // [Logic] 공식 토픽 태그 추가 (문서 사양 준수: . & 포함 불가)
            if (topicTag) {
                params.topic_tag = topicTag.replace(/[.&]/g, '');
            }

            const response = await axios.post(url, null, { params });
            return response.data.id;
        } catch (error: any) {
            const errorDetail = error.response?.data?.error || error.response?.data || error.message;
            Logger.error(`[Threads] Failed to create carousel container`, errorDetail);
            throw error;
        }
    }

    /**
     * 생성된 컨테이너의 상태를 확인
     */
    private async checkContainerStatus(containerId: string): Promise<string> {
        const url = `${this.baseUrl}/${containerId}`;
        try {
            const response = await axios.get(url, {
                params: {
                    fields: 'status',
                    access_token: this.accessToken
                }
            });
            // [Logic] Threads API는 Instagram과 달리 'status' 필드를 반환합니다.
            return response.data.status || 'UNKNOWN';
        } catch (error: any) {
            const errorDetail = error.response?.data?.error?.message || error.message;
            Logger.warn(`[Threads] Failed to check status for ${containerId}: ${errorDetail}`);
            return 'ERROR';
        }
    }

    /**
     * 모든 아이템 컨테이너가 FINISHED 상태가 될 때까지 대기
     */
    private async waitUntilAllItemsFinished(itemIds: string[]) {
        const MAX_TRY = 12;
        let interval = 5000;

        Logger.info(`🕵️ Checking status for ${itemIds.length} Threads items...`);

        for (let i = 0; i < MAX_TRY; i++) {
            const statuses: string[] = [];
            for (const id of itemIds) {
                const status = await this.checkContainerStatus(id);
                statuses.push(status);
                await this.sleep(1000);
            }

            const allFinished = statuses.every(s => s === 'FINISHED');
            if (allFinished) {
                Logger.success("✅ All Threads items processing finished.");
                return;
            }

            const hasFailure = statuses.some(s => s === 'ERROR' || s === 'EXPIRED');
            if (hasFailure) {
                throw new Error('Some Threads item containers failed or expired.');
            }

            Logger.info(`⏳ Threads processing... (Attempt ${i + 1}/${MAX_TRY}, waiting ${interval / 1000}s)`);
            await this.sleep(interval);
            interval = Math.min(interval * 1.5, 10000);
        }
        throw new Error('Timeout waiting for Threads items.');
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
     * @param topicTag - (Optional) 공식 토픽 태그 (1-50자)
     * @returns 발행된 게시물의 고유 ID
     */
    async publishCarousel(imageUrls: string[], text: string, topicTag?: string): Promise<string | null> {
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
                // [Optimization] 연이은 요청으로 인한 API 차단 방지 (안전 버퍼 2초)
                await this.sleep(2000);
            }

            // [Safety] 이미지 처리 대기 (Smart Polling)
            Logger.info('⏳ Waiting for Threads processing...');
            await this.sleep(10000); // [Logic] 초기 10초 고정 대기 후 상태 폴링 시작
            await this.waitUntilAllItemsFinished(itemIds);

            // [Step 2] 캐러셀 컨테이너 생성
            Logger.info('📦 Assembling carousel container...');
            const carouselContainerId = await this.createCarouselContainer(itemIds, text, topicTag);

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
