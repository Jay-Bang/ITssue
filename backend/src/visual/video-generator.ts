import { spawn } from 'child_process';
import * as fs from 'fs-extra';
import * as path from 'path';
import { Logger } from '../lib/logger';

/**
 * [Video Preview Generator]
 * 
 * [Description] 렌더링된 PNG 이미지들을 연결하여 미리보기용 MP4 영상을 생성합니다.
 * 
 * [Design Intent]
 * - FFmpeg를 활용하여 고품질/저용량의 영상을 생성.
 * - 텔레그램 등 메신저 공유에 최적화된 H.264 코덱 사용.
 * - 이미지당 3초의 고정 노출 시간 적용.
 */
export class VideoGenerator {
    /**
     * 이미지 리스트를 사용하여 MP4 영상 생성
     * @param images - 순서대로 정렬된 이미지 파일 경로 배열
     * @param outputDir - 영상이 저장될 디렉토리
     * @param outputFilename - (Optional) 생성할 영상 파일명 (기본값: preview_clip.mp4)
     * @returns 생성된 영상 파일의 절대 경로
     */
    static async generatePreview(images: string[], outputDir: string, outputFilename: string = 'preview_clip.mp4'): Promise<string> {
        if (!images || images.length === 0) {
            throw new Error("No images provided for video generation.");
        }

        const listFilePath = path.join(outputDir, 'ffmpeg_input.txt');
        const outputVideoPath = path.join(outputDir, outputFilename);

        // [Step 1] FFmpeg Concat Demuxer용 입력 시퀀스 파일 생성
        // [Logic] 각 이미지 노출 시간을 3초로 지정합니다.
        const DURATION = 3;
        const escapePath = (p: string) => p.replace(/'/g, "'\\''");

        const fileContent = images
            .map(img => `file '${escapePath(img)}'\nduration ${DURATION}`)
            .join('\n');

        await fs.writeFile(listFilePath, fileContent);

        Logger.info(`🎬 Generating video preview from ${images.length} images...`);

        return new Promise((resolve, reject) => {
            // [Step 2] FFmpeg 프로세스 실행 및 인코딩 파라미터 적용
            // - scale/pad: 4:5 이미지를 9:16 캔버스 중앙에 배치 (Instagram Story 대응)
            // - c:v libx264: 범용적인 H.264 코덱 사용
            // - movflags +faststart: 웹 및 모바일 기반 프로그레시브 다운로드/재생 최적화
            const ffmpeg = spawn('ffmpeg', [
                '-y', // 기존 파일 덮어쓰기
                '-f', 'concat',
                '-safe', '0',
                '-i', listFilePath,
                '-vf', 'scale=1080:1350,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black',
                '-c:v', 'libx264',
                '-pix_fmt', 'yuv420p',
                '-crf', '23',
                '-preset', 'fast',
                '-r', '30',
                '-movflags', '+faststart',
                outputVideoPath
            ]);

            let stderr = '';
            ffmpeg.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            ffmpeg.on('close', async (code) => {
                // 임시 파일 정리
                await fs.unlink(listFilePath).catch(() => { });

                if (code === 0) {
                    Logger.success(`🎥 Video generated successfully: ${outputVideoPath}`);
                    resolve(outputVideoPath);
                } else {
                    Logger.error(`❌ FFmpeg exited with code ${code}`);
                    Logger.error(stderr);
                    reject(new Error(stderr || `FFmpeg exited with code ${code}`));
                }
            });

            ffmpeg.on('error', (err) => {
                Logger.error("❌ Failed to start FFmpeg", err);
                reject(err);
            });
        });
    }
}
