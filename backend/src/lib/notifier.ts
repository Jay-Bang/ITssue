import axios from 'axios';
import * as fs from 'fs-extra';
import * as dotenv from 'dotenv';
import { Logger } from './logger';
import { FinalIssueBoard } from '../types';
import { VideoGenerator } from '../visual/video-generator';
import * as path from 'path';

dotenv.config();

/**
 * [Notification Service]
 * 
 * [Description] 분석 결과를 텔레그램을 통해 전송하는 서비스입니다.
 * 
 * [Design Intent]
 * - 이미지 묶음(Media Group)과 텍스트(Capion)를 분리하여 전송함으로써 정보 전달 효율성 극대화.
 * - 텔레그램 API의 최대 전송 제약(10장)을 엔진 레벨에서 관리.
 * 
 * [Key Logic Flow]
 * 1. 텔레그램 봇 토큰 및 챗 ID 유효성 검증.
 * 2. [Step] 이미지 파일들을 읽어 `form-data` 스트림 생성 및 Media Group 전송.
 * 3. [Step] 인스타그램 캡션 데이터를 마크다운 형식으로 가공하여 메시지 전항.
 */
export class NotificationService {
    private readonly telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    private readonly telegramChatId = process.env.TELEGRAM_CHAT_ID;

    /**
     * 텔레그램으로 이미지 묶음과 인스타그램 캡션을 전송합니다.
     */
    async sendTelegram(type: string, date: string, issues: FinalIssueBoard[], imagePaths: string[], caption?: string) {
        if (!this.telegramToken || !this.telegramChatId) {
            Logger.warn('⚠️ Telegram environment variables missing. Skipping Telegram notification.');
            return;
        }

        try {
            // [Step 1] 이미지 묶음 전송 (Media Group) - 텔레그램 미디어 그룹은 최대 10개까지 지원
            if (imagePaths.length > 0) {
                const FormData = require('form-data');
                const formData = new FormData();
                formData.append('chat_id', this.telegramChatId);

                const mediaLimit = 10;
                const targetImages = imagePaths.slice(0, mediaLimit);

                const media = targetImages.map((_, idx) => ({
                    type: 'photo',
                    media: `attach://file${idx}`
                }));

                formData.append('media', JSON.stringify(media));

                targetImages.forEach((img, idx) => {
                    formData.append(`file${idx}`, fs.createReadStream(img));
                });

                await axios.post(`https://api.telegram.org/bot${this.telegramToken}/sendMediaGroup`, formData, {
                    headers: formData.getHeaders(),
                    maxContentLength: Infinity,
                    maxBodyLength: Infinity
                });
            }

            // [Step 1.5] 비디오 프리뷰 생성 및 전송 (FFmpeg)
            // [Logic] 이미지 묶음을 동영상으로 변환하여 더 생동감 있는 미리보기를 제공합니다.
            try {
                if (imagePaths.length > 0) {
                    const outputDir = path.dirname(imagePaths[0]);
                    const videoFilename = `video_${type}_${date}.mp4`;
                    const videoPath = await VideoGenerator.generatePreview(imagePaths, outputDir, videoFilename);

                    const FormData = require('form-data');
                    const videoForm = new FormData();
                    videoForm.append('chat_id', this.telegramChatId);
                    videoForm.append('video', fs.createReadStream(videoPath));
                    videoForm.append('caption', `🎬 Issue Board Video Preview (${date})`);

                    await axios.post(`https://api.telegram.org/bot${this.telegramToken}/sendVideo`, videoForm, {
                        headers: videoForm.getHeaders(),
                        maxContentLength: Infinity,
                        maxBodyLength: Infinity
                    });

                    Logger.success('🎥 Telegram video preview sent.');
                }
            } catch (videoError: any) {
                Logger.warn('⚠️ Failed to generate or send video preview (Skipping...)', videoError.message);
            }

            // [Step 2] 인스타그램 캡션 전송
            if (caption) {
                await axios.post(`https://api.telegram.org/bot${this.telegramToken}/sendMessage`, {
                    chat_id: this.telegramChatId,
                    text: caption,
                    parse_mode: 'Markdown'
                });
            }

            Logger.success('✅ Telegram notification (MediaGroup + Caption) sent.');
        } catch (error) {
            Logger.error('❌ Failed to send Telegram notification', error);
        }
    }
}
