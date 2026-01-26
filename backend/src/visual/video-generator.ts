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

        // [Step 1] FFmpeg Concat Demuxer용 입력 파일 생성
        // 각 이미지마다 'duration 3'을 지정하여 3초씩 보여주도록 설정
        // [Fix] 마지막 이미지를 중복 입력할 경우 타임라인이 늘어나는 현상이 있어 제거 (FFmpeg 8.x 기준)
        const fileContent = images.map(img => `file '${img}'\nduration 3`).join('\n');

        await fs.writeFile(listFilePath, fileContent);

        Logger.info(`🎬 Generating video preview from ${images.length} images...`);

        return new Promise((resolve, reject) => {
            // [Step 2] FFmpeg 실행
            // -f concat: 연결 모드
            // -safe 0: 절대 경로 허용
            // -pix_fmt yuv420p: 대부분의 플레이어 호환성 확보
            // -c:v libx264: H.264 인코딩
            // -r 30: 30fps (부드러운 전환을 위해, 실제로는 정지 영상이지만 메타데이터상)
            const ffmpeg = spawn('ffmpeg', [
                '-y', // 덮어쓰기 허용
                '-f', 'concat',
                '-safe', '0',
                '-i', listFilePath,
                '-vf', 'scale=1080:1350,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black', // 4:5 -> 9:16 conversion
                '-c:v', 'libx264',
                '-pix_fmt', 'yuv420p',
                '-r', '30',
                '-movflags', '+faststart', // 웹 재생 최적화
                outputVideoPath
            ]);

            ffmpeg.stderr.on('data', (data) => {
                // FFmpeg 로그는 stderr로 출력됨 (너무 많아서 에러만 필터링하거나 디버그 모드에서만 볼 수 있음)
                // console.debug(`ffmpeg: ${data}`);
            });

            ffmpeg.on('close', async (code) => {
                // 임시 파일 정리
                await fs.unlink(listFilePath).catch(() => { });

                if (code === 0) {
                    Logger.success(`🎥 Video generated successfully: ${outputVideoPath}`);
                    resolve(outputVideoPath);
                } else {
                    Logger.error(`❌ FFmpeg exited with code ${code}`);
                    reject(new Error(`FFmpeg exited with code ${code}`));
                }
            });

            ffmpeg.on('error', (err) => {
                Logger.error("❌ Failed to start FFmpeg", err);
                reject(err);
            });
        });
    }
}
