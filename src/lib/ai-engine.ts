import { GoogleGenerativeAI } from '@google/generative-ai';
import * as dotenv from 'dotenv';
import { Logger } from './logger';

dotenv.config();

/**
 * 고급 AI 기반 엔진 (Multi-Key Rotation 지원)
 * 
 * [설계 의도]
 * 프로젝트의 단순화 및 성능 최적화를 위해 단일 AI 엔진으로 통합합니다.
 * 
 * [Multi-Key Rotation]
 * - 여러 개의 API 키를 순환하며 사용하여 Rate Limit 우회
 * - 환경 변수 설정 방법:
 *   1. CLOUD_AI_KEY="key1,key2,key3" (쉼표로 구분)
 *   2. CLOUD_AI_KEY_1="key1", CLOUD_AI_KEY_2="key2", ... (개별 설정)
 */
export class AIEngine {
    private apiKeys: string[];
    private currentKeyIndex: number = 0;
    private genAI: GoogleGenerativeAI;
    private model: any;

    constructor() {
        // API 키 로드 (여러 방식 지원)
        this.apiKeys = this.loadApiKeys();

        if (this.apiKeys.length === 0) {
            Logger.warn('[AI] ⚠️ No API keys found in .env file.');
            this.apiKeys = [''];
        }

        Logger.info(`[AI] 🔑 Loaded ${this.apiKeys.length} API key(s)`);

        // 첫 번째 키로 초기화
        this.genAI = new GoogleGenerativeAI(this.apiKeys[0]);
        const modelName = process.env.CLOUD_AI_MODEL;
        if (!modelName) {
            throw new Error('❌ CLOUD_AI_MODEL not found in .env');
        }
        this.model = this.genAI.getGenerativeModel({ model: modelName });
    }

    /**
     * 환경 변수에서 API 키 로드
     * - CLOUD_AI_KEY="key1,key2,key3" 형식 지원
     * - CLOUD_AI_KEY_1, CLOUD_AI_KEY_2, ... 형식 지원
     */
    private loadApiKeys(): string[] {
        const keys: string[] = [];

        // 방법 1: 쉼표로 구분된 단일 환경 변수
        const mainKey = process.env.CLOUD_AI_KEY;
        if (mainKey) {
            if (mainKey.includes(',')) {
                keys.push(...mainKey.split(',').map(k => k.trim()).filter(k => k));
            } else {
                keys.push(mainKey);
            }
        }

        // 방법 2: 개별 환경 변수 (CLOUD_AI_KEY_1, CLOUD_AI_KEY_2, ...)
        let i = 1;
        while (true) {
            const key = process.env[`CLOUD_AI_KEY_${i}`];
            if (!key) break;
            keys.push(key);
            i++;
        }

        return [...new Set(keys)]; // 중복 제거
    }

    /**
     * 다음 API 키로 전환
     */
    private switchToNextKey(): boolean {
        if (this.apiKeys.length <= 1) {
            return false; // 키가 1개뿐이면 전환 불가
        }

        this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
        const newKey = this.apiKeys[this.currentKeyIndex];

        Logger.info(`[AI] 🔄 Switching to API key #${this.currentKeyIndex + 1}`);

        // 새 키로 클라이언트 재생성
        this.genAI = new GoogleGenerativeAI(newKey);
        const modelName = process.env.CLOUD_AI_MODEL!;
        this.model = this.genAI.getGenerativeModel({ model: modelName });

        return true;
    }

    private async wait(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 지수 백오프 + API 키 로테이션 재시도 로직
     */
    private async withRetry<T>(fn: () => Promise<T>, maxRetries: number = 3): Promise<T> {
        let lastError: any;
        let keySwitchAttempts = 0;
        const maxKeySwitches = this.apiKeys.length;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return await fn();
            } catch (error: any) {
                lastError = error;

                // Rate Limit 에러 (429) 또는 모델 미발견 (404)인 경우
                if (error.status === 429 || error.status === 404) {
                    // 먼저 다른 키로 전환 시도
                    if (keySwitchAttempts < maxKeySwitches - 1 && this.switchToNextKey()) {
                        keySwitchAttempts++;
                        Logger.info(`[AI] 🔄 Retrying with new API key...`);
                        continue; // 즉시 재시도 (대기 없이)
                    }

                    // 모든 키를 시도했으면 대기 후 재시도
                    if (attempt < maxRetries) {
                        let delay = Math.pow(2, attempt) * 2000 + Math.random() * 1000;

                        if (error.errorDetails) {
                            const retryInfo = error.errorDetails.find((d: any) => d['@type'] === 'type.googleapis.com/google.rpc.RetryInfo');
                            if (retryInfo?.retryDelay) {
                                const seconds = parseInt(retryInfo.retryDelay);
                                if (!isNaN(seconds)) {
                                    delay = seconds * 1000 + 1000;
                                }
                            }
                        }

                        Logger.warn(`[AI] 🚦 All keys exhausted. Waiting ${Math.round(delay)}ms... (Attempt ${attempt + 1}/${maxRetries})`);
                        await this.wait(delay);

                        // 첫 번째 키로 리셋
                        this.currentKeyIndex = 0;
                        this.genAI = new GoogleGenerativeAI(this.apiKeys[0]);
                        const modelName = process.env.CLOUD_AI_MODEL!;
                        this.model = this.genAI.getGenerativeModel({ model: modelName });
                        keySwitchAttempts = 0;

                        continue;
                    }
                }
                throw error;
            }
        }
        throw lastError;
    }

    /** 텍스트 생성 (재시도 로직 포함) */
    async generateText(prompt: string): Promise<string> {
        return this.withRetry(async () => {
            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            return response.text();
        });
    }

    /** JSON 생성 (재시도 로직 및 파싱 처리 포함) */
    async generateJson<T>(prompt: string): Promise<T | null> {
        try {
            const text = await this.withRetry(async () => {
                const result = await this.model.generateContent(prompt + '\n\nIMPORTANT: Response must be only a valid JSON object.');
                const response = await result.response;
                return response.text();
            });

            const jsonStr = text.replace(/```json|```/g, '').trim();
            return JSON.parse(jsonStr) as T;
        } catch (error: any) {
            Logger.error('[AI] ❌ Error generating JSON', error);
            return null;
        }
    }

    /** Intelligent Search Grounding을 사용한 텍스트 생성 (JSON 모드 지원 및 키 로테이션 버그 수정) */
    async generateWithSearch(prompt: string, responseFormat: 'text' | 'json' = 'json'): Promise<string> {
        return this.withRetry(async () => {
            // [Multi-Key Rotation] 매 시도마다 현재의 genAI 인스턴스를 사용하여 모델 생성해야 키 변경이 반영됨
            const searchModel = this.genAI.getGenerativeModel({
                model: process.env.CLOUD_AI_MODEL!,
                tools: [{
                    // @ts-ignore: Search Grounding 타입 지원 미비
                    googleSearch: {}
                }]
            });

            const generationConfig = {
                temperature: 0.7,
                // [Fix] Search Grounding과 JSON Mode 동시 사용 불가 (API 제약)
                // responseMimeType: responseFormat === 'json' ? 'application/json' : 'text/plain'
            };

            const result = await searchModel.generateContent({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: generationConfig
            });

            const response = await result.response;
            return response.text();
        });
    }
}

// 싱글톤 인스턴스 노출
export const ai = new AIEngine();
export const coreAI = ai;
