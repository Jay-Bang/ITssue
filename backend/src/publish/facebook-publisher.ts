import axios from 'axios';
import { Logger } from '../lib/logger';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * [Facebook Page Content Publisher]
 * 
 * [Description] Facebook Page API를 사용하여 이미지 세트를 페이지 피드에 게시하는 도구입니다.
 * 
 * [Design Intent]
 * - Instagram/ThreadsPublisher와 유사한 인터페이스를 유지합니다.
 * - Facebook 페이지 전용 'Page Access Token'을 자동으로 획득하여 게시합니다.
 * - 여러 장의 이미지를 하나의 포스트로 묶어 게시합니다.
 */
export class FacebookPublisher {
    private readonly baseUrl = 'https://graph.facebook.com/v24.0';
    private readonly pageId: string;
    private userAccessToken: string;
    private pageAccessToken: string | null = null;
    private supabase;

    constructor() {
        this.pageId = process.env.FB_PAGE_ID || '';
        this.userAccessToken = process.env.THREADS_ACCESS_TOKEN || process.env.IG_ACCESS_TOKEN || '';
        this.supabase = createClient(
            process.env.SUPABASE_URL || '',
            process.env.SUPABASE_SERVICE_KEY || ''
        );

        if (!this.pageId || !this.userAccessToken) {
            Logger.warn('[Facebook] FB_PAGE_ID or Access Token is missing in .env');
        }

        this.initialized = this.init();
    }

    private initialized: Promise<void>;

    async ensureInitialized(): Promise<void> {
        await this.initialized;
    }

    private async init(): Promise<void> {
        // 1. Supabase에서 최신 유저 토큰 로드
        await this.loadUserAccessToken();
        // 2. 페이지 토큰 획득
        await this.loadPageAccessToken();
    }

    private async loadUserAccessToken(): Promise<void> {
        try {
            const { data, error } = await this.supabase
                .from('instagram_tokens')
                .select('access_token')
                .eq('id', 1)
                .single();

            if (!error && data?.access_token) {
                this.userAccessToken = data.access_token;
            }
        } catch (e: any) {
            Logger.error('[Facebook] Error loading user token from Supabase', e.message);
        }
    }

    /**
     * 유저 토큰을 사용하여 특정 페이지의 Page Access Token을 가져옵니다.
     */
    private async loadPageAccessToken(): Promise<void> {
        try {
            const response = await axios.get(`${this.baseUrl}/me/accounts`, {
                params: {
                    access_token: this.userAccessToken
                }
            });

            const pages = response.data.data;
            const targetPage = pages.find((p: any) => p.id === this.pageId);

            if (targetPage) {
                this.pageAccessToken = targetPage.access_token;
                Logger.info(`[Facebook] Page Access Token acquired for Page: ${targetPage.name}`);
            } else {
                Logger.error(`[Facebook] Could not find Page ID ${this.pageId} in user accounts.`);
            }
        } catch (error: any) {
            Logger.error('[Facebook] Failed to get Page Access Token', error.message);
        }
    }

    /**
     * 개별 촬영(사진)을 업로드하고 ID를 반환 (비공개 게시물로 업로드)
     */
    private async uploadPhoto(imageUrl: string): Promise<string> {
        const url = `${this.baseUrl}/${this.pageId}/photos`;
        try {
            const response = await axios.post(url, null, {
                params: {
                    url: imageUrl,
                    published: false,
                    access_token: this.pageAccessToken
                }
            });
            return response.data.id;
        } catch (error: any) {
            const errorDetail = error.response?.data?.error || error.message;
            Logger.error(`[Facebook] Photo upload failed: ${imageUrl}`, errorDetail);
            throw error;
        }
    }

    /**
     * [Main Entry] 여러 장의 이미지를 하나의 Facebook 포스트로 게시
     * 
     * @param imageUrls - 업로드할 이미지 URL 배열
     * @param message - 게시물 본문(캡션)
     * @returns 발행된 포스트의 ID
     */
    async publishMultiPhoto(imageUrls: string[], message: string): Promise<string | null> {
        await this.ensureInitialized();

        if (!this.pageId || !this.pageAccessToken) {
            Logger.error('[Facebook] Cannot publish: Missing Page ID or Token.');
            return null;
        }

        try {
            Logger.info(`📘 Starting Facebook multi-photo publish with ${imageUrls.length} images...`);

            // 1. 모든 사진을 비공개 상태로 먼저 업로드하여 ID 확보
            const photoIds: string[] = [];
            for (const url of imageUrls) {
                Logger.info(`   - Uploading photo: ${url.split('/').pop()}`);
                const id = await this.uploadPhoto(url);
                photoIds.push(id);
            }

            // 2. 확보된 사진 ID들을 묶어서 피드에 정식 게시
            const feedUrl = `${this.baseUrl}/${this.pageId}/feed`;

            // attached_media 형식으로 구성
            const attachedMedia = photoIds.map(id => ({ media_fbid: id }));

            const response = await axios.post(feedUrl, null, {
                params: {
                    message: message,
                    attached_media: JSON.stringify(attachedMedia),
                    access_token: this.pageAccessToken
                }
            });

            if (response.data.id) {
                Logger.success(`🎉 Published successfully to Facebook! Post ID: ${response.data.id}`);
                return response.data.id;
            }

            return null;

        } catch (error: any) {
            const errorDetail = error.response?.data?.error || error.message;
            Logger.error('[Facebook] Complete publish flow failed.', errorDetail);
            return null;
        }
    }
}
