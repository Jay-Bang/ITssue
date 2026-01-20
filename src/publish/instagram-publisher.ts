import axios from 'axios';
import { Logger } from '../lib/logger';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * 인스타그램 Graph API 연동 퍼블리셔
 * 
 * [동작 원리 - 캐러셀 포스팅 3단계]
 * 1. 개별 이미지 컨테이너 생성 (Item Container): 각 이미지 URL을 인스타그램 서버에 전달하여 ID 획득
 * 2. 캐러셀 컨테이너 생성 (Carousel Container): 1단계에서 얻은 ID들을 묶어 하나의 게시물 후보 생성
 * 3. 미디어 발행 (Media Publish): 최종적으로 게시물을 인스타그램 피드에 게시
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

            // 1단계: 모든 이미지에 대해 개별 컨테이너 생성
            const itemIds: string[] = [];
            for (const url of imageUrls) {
                Logger.info(`   - Creating container for: ${url.split('/').pop()}`);
                const id = await this.createItemContainer(url);
                itemIds.push(id);
            }

            // [Correctness] 인스타그램 서버가 이미지를 처리할 시간을 넉넉히 둡니다.
            // 이미지가 많을수록(최대 10장) 처리 시간이 길어질 수 있습니다.
            Logger.info('⏳ Waiting for Instagram to process images (40s)...');
            await new Promise(resolve => setTimeout(resolve, 40000));

            // 2단계: 캐러셀로 묶기
            Logger.info('📦 Assembling carousel container...');
            const carouselContainerId = await this.createCarouselContainer(itemIds, caption);

            // 3단계: 최종 발행 (재시도 로직 포함)
            Logger.info('🚀 Publishing to Instagram Feed (with retries)...');
            let result: { id: string } | null = null;
            let retryCount = 0;
            const maxRetries = 3;

            while (retryCount < maxRetries) {
                try {
                    result = await this.publishMedia(carouselContainerId);
                    if (result) break;
                } catch (error: any) {
                    retryCount++;
                    if (retryCount >= maxRetries) throw error;
                    
                    const waitTime = retryCount * 20000; // 20초, 40초 점진적 증가
                    Logger.warn(`⚠️ Publish failed (Attempt ${retryCount}/${maxRetries}). Retrying in ${waitTime/1000}s...`);
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
}
