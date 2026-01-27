import axios from 'axios';
import { Logger } from '../lib/logger';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * [Instagram Content Publisher]
 * 
 * [Description] Instagram Graph API를 사용하여 분석 결과 이미지를 캐러셀 형태의 피드로 게시하는 도구입니다.
 * 
 * [Design Intent]
 * - [Safety] 복잡한 Graph API 포스팅 과정을 캡슐화하여 일관된 인터페이스를 제공합니다.
 * - [Optimization] 이미지 처리 지연 시간을 고려한 명시적 대기(Smart Polling) 및 재시도 메커니즘을 구축했습니다.
 * - 토큰 및 사용자 ID의 안전한 관리를 위한 환경 변수 연동을 수행합니다.
 */
export class InstagramPublisher {
    private readonly baseUrl = 'https://graph.facebook.com/v24.0';
    private readonly igUserId: string;
    private readonly accessToken: string;

    constructor() {
        this.igUserId = process.env.IG_USER_ID || '';
        this.accessToken = process.env.IG_ACCESS_TOKEN || '';

        if (!this.igUserId || !this.accessToken) {
            Logger.warn('[Instagram] IG_USER_ID or IG_ACCESS_TOKEN is missing in .env');
        }
    }

    /**
     * 개별 이미지에 대한 항목 컨테이너 생성
     */
    private async createItemContainer(imageUrl: string): Promise<string> {
        const url = `${this.baseUrl}/${this.igUserId}/media`;
        try {
            const response = await axios.post(url, null, {
                params: {
                    image_url: imageUrl,
                    is_carousel_item: true, // 캐러셀의 구성 요소임을 명시
                },
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`
                }
            });
            return response.data.id;
        } catch (error: any) {
            const errorDetail = error.response?.data || error.message;
            Logger.error(`[Instagram] Failed to create item container for ${imageUrl}`, errorDetail);
            throw error;
        }
    }

    /**
     * 여러 이미지 컨테이너 ID를 하나로 묶어 캐러셀 컨테이너 생성
     */
    private async createCarouselContainer(childrenIds: string[], caption: string): Promise<string> {
        const url = `${this.baseUrl}/${this.igUserId}/media`;
        try {
            const response = await axios.post(url, null, {
                params: {
                    media_type: 'CAROUSEL',
                    children: childrenIds.join(','),
                    caption: caption,
                },
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`
                }
            });
            return response.data.id;
        } catch (error: any) {
            const errorDetail = error.response?.data || error.message;
            Logger.error(`[Instagram] Failed to create carousel container`, errorDetail);
            throw error;
        }
    }

    /**
     * 생성된 컨테이너를 실제로 사용자 피드에 발행
     */
    private async publishMedia(creationId: string): Promise<{ id: string }> {
        const url = `${this.baseUrl}/${this.igUserId}/media_publish`;
        try {
            const response = await axios.post(url, null, {
                params: {
                    creation_id: creationId,
                },
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`
                }
            });
            return { id: response.data.id };
        } catch (error: any) {
            const errorDetail = error.response?.data || error.message;
            Logger.error(`[Instagram] Failed to publish media`, errorDetail);
            throw error;
        }
    }

    /**
     * [Main Entry] 인스타그램 캐러셀 포스팅 통합 실행
     * 
     * @param imageUrls - 업로드할 공용 이미지 URL 배열 (최대 10장)
     * @param caption - 게시물 본문 (캡션)
     * @returns 발행된 게시물의 고유 ID
     */
    async publishCarousel(imageUrls: string[], caption: string): Promise<string | null> {
        if (!this.igUserId || !this.accessToken) {
            Logger.error('[Instagram] Cannot publish: Missing credentials.');
            return null;
        }

        try {
            Logger.info(`📸 Starting Instagram carousel publish with ${imageUrls.length} images...`);

            // [Step 1] 개별 이미지 항목 컨테이너(Item Container) 생성
            const itemIds: string[] = [];
            for (const url of imageUrls) {
                Logger.info(`   - Creating container for: ${url.split('/').pop()}`);
                const id = await this.createItemContainer(url);
                itemIds.push(id);
            }

            // [Safety] 인스타그램 이미지 처리 지연 대기 (Smart Polling)
            // 1. 최소 물리적 시간 보장 (40초)
            Logger.info('⏳ Waiting 40s initial buffer for processing...');
            await new Promise(resolve => setTimeout(resolve, 40000));

            // 2. 상태 기반 폴링 (Exponential Backoff)
            await this.waitUntilAllItemsFinished(itemIds);

            // [Step 2] 캐러셀 컨테이너(Carousel Container) 생성
            Logger.info('📦 Assembling carousel container...');
            const carouselContainerId = await this.createCarouselContainer(itemIds, caption);

            // [Step 3] 최종 미디어 발행 (Publishing with Retries)
            Logger.info('🚀 Publishing to Instagram Feed (with retries)...');
            let result: { id: string } | null = null;
            let retryCount = 0;
            const maxRetries = 2;

            while (retryCount < maxRetries) {
                try {
                    result = await this.publishMedia(carouselContainerId);
                    if (result) break;
                } catch (error: any) {
                    retryCount++;
                    if (retryCount >= maxRetries) throw error;

                    const waitTime = retryCount * 20000; // 20초, 40초 점진적 증가
                    Logger.warn(`⚠️ Publish failed (Attempt ${retryCount}/${maxRetries}). Retrying in ${waitTime / 1000}s...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                }
            }

            if (!result) throw new Error('Failed to get IG_MEDIA_ID after retries.');

            Logger.success(`🎉 Published successfully! IG_MEDIA_ID: ${result.id}`);
            return result.id;

        } catch (error: any) {
            Logger.error('[Instagram] Complete publish flow failed.', error.message);
            return null;
        }
    }

    /**
     * 게시물 삭제
     * 재게시(Republish) 시 기존 잘못된 게시물을 지우기 위해 사용 가능
     * 주의: 'instagram_manage_contents' 권한이 필요합니다.
     */
    async deleteMedia(mediaId: string): Promise<boolean> {
        const url = `${this.baseUrl}/${mediaId}`;
        try {
            Logger.info(`🗑️ Attempting to delete Instagram media: ${mediaId}...`);
            const response = await axios.delete(url, {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`
                }
            });

            if (response.data.success) {
                Logger.success(`✅ Successfully deleted Instagram media: ${mediaId}`);
                return true;
            }
            return false;
        } catch (error: any) {
            const errorDetail = error.response?.data || error.message;
            Logger.error(`[Instagram] Failed to delete media ${mediaId}`, errorDetail);
            return false;
        }
    }

    /**
     * 컨테이너 상태 확인 (Smart Check)
     */
    private async checkContainerStatus(containerId: string): Promise<string> {
        const url = `${this.baseUrl}/${containerId}`;
        try {
            const response = await axios.get(url, {
                params: {
                    fields: 'status_code,status',
                    access_token: this.accessToken
                }
            });
            return response.data.status_code || 'UNKNOWN';
        } catch (error: any) {
            Logger.warn(`[Instagram] Failed to check status for ${containerId}`, error.message);
            return 'ERROR';
        }
    }

    /**
     * 모든 아이템 컨테이너가 FINISHED 상태가 될 때까지 대기
     */
    private async waitUntilAllItemsFinished(itemIds: string[]) {
        const MAX_TRY = 12;        // 최대 약 60~90초 추가 대기
        let interval = 5000;       // 시작 5초

        Logger.info(`🕵️ Checking status for ${itemIds.length} items...`);

        for (let i = 0; i < MAX_TRY; i++) {
            const statuses = await Promise.all(
                itemIds.map(id => this.checkContainerStatus(id))
            );

            // 모든 항목이 완료되었는지 확인
            const allFinished = statuses.every(s => s === 'FINISHED');
            if (allFinished) {
                Logger.success("✅ All items processing finished.");
                return;
            }

            // 에러가 발생했거나 만료된 항목이 있는지 확인
            const hasFailure = statuses.some(s => s === 'ERROR' || s === 'EXPIRED');
            if (hasFailure) {
                throw new Error('Some item containers failed or expired during processing.');
            }

            Logger.info(`⏳ Processing... (Attempt ${i + 1}/${MAX_TRY}, waiting ${interval / 1000}s)`);
            await new Promise(r => setTimeout(r, interval));
            interval = Math.min(interval * 1.5, 15000); // 지수 백오프 (최대 15초 간격)
        }

        throw new Error('Timeout waiting for item containers to finish processing.');
    }
}
