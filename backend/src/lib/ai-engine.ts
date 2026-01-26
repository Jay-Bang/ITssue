import { GoogleGenerativeAI } from '@google/generative-ai';
import * as dotenv from 'dotenv';
import { Logger } from './logger';

dotenv.config();

/**
 * [Advanced AI Engine]
 * 
 * [Description] 고성능 Cloud AI 모델을 기반으로 텍스트 및 JSON 분석을 수행하며, Multi-Key Rotation을 지원합니다.
 * 
 * [Design Intent]
 * - API 할당량(Free Tier) 제한을 극복하기 위해 여러 API 키를 자동으로 순환 사용.
 * - 네트워크 불안정 및 Rate Limit 상황에 대응하기 위한 견고한 재시도(Retry) 메커니즘 구축.
 * - Search Grounding 기능을 통합하여 실시간 웹 정보를 AI 분석에 활용.
 * 
 * [Key Logic Flow]
 * 1. 환경 변수에서 여러 개의 CLOUD_AI_KEY 로드 및 중복 제거.
 * 2. 요청 실패(429 등) 발생 시 다음 키로 자동 전환(`switchToNextKey`).
 * 3. 모든 키 소진 시 지수 백오프(`withRetry`)를 적용하여 대기 후 재시도.
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
     * [Logic] 환경 변수에서 API 키 로드
     * [Design Intent] 한 명의 사용자가 여러 개의 서비스 계정으로 생성한 API 키를 모두 활용할 수 있도록 두 가지 포맷을 지원합니다.
     * 1. 쉼표로 구분된 단일 환경 변수 (CLOUD_AI_KEY="key1,key2...")
     * 2. 개별 환경 변수 번호링 (CLOUD_AI_KEY_1, CLOUD_AI_KEY_2...)
     */
    private loadApiKeys(): string[] {
        const keys: string[] = [];

        // 방법 1: 쉼표로 구분된 단일 환경 변수 처리
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
                // [Step] AI 요청 실행
                return await fn();
            } catch (error: any) {
                lastError = error;

                // [Logic] Rate Limit(429) 또는 할당량 초과 상황 대응
                if (error.status === 429 || error.status === 404) {
                    // [Strategy A] 현재 시도하지 않은 다른 API 키가 있다면 즉시 전환
                    if (keySwitchAttempts < maxKeySwitches - 1 && this.switchToNextKey()) {
                        keySwitchAttempts++;
                        Logger.info(`[AI] 🔄 Retrying with new API key...`);
                        continue; // 대기 시간 없이 즉시 재시도
                    }

                    // [Strategy B] 모든 키가 소진된 경우, 지수 백오프 기반 대기 후 재시도
                    if (attempt < maxRetries) {
                        // 기본 대기 시간 + 지수 백오프 + 지터(Jitter)로 네트워크 충돌 방지
                        let delay = Math.pow(2, attempt) * 2000 + Math.random() * 1000;

                        // API 응답에 Retry-After 정보가 포함되어 있다면 해당 값 우선 사용
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

                        // [Safety] 대기 후 첫 번째 키로 다시 리셋하여 순환 루프 재시작
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

    /**
     * [Logic] Intelligent Search Grounding을 사용한 텍스트 생성
     * [Design Intent] AI가 학습 시점에 머물지 않고 실시간 웹 정보를 검색하여 최신 이슈에 실재하는 정보를 답변하도록 합니다.
     */
    async generateWithSearch(prompt: string, responseFormat: 'text' | 'json' = 'json'): Promise<string> {
        return this.withRetry(async () => {
            // [Safety] 매 재시도(Retry) 시마다 현재 활성화된 API 키(`genAI`) 인스턴스를 사용해야 
            // 키 로테이션 결과가 Search 모델에도 정상 반영됩니다.
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
