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
     * [Logic] 이미지 리스트를 사용하여 MP4 영상 생성
     * @param images - 순서대로 정렬된 이미지 파일 경로 배열 (P1~P6 등)
     * @param outputDir - 영상이 저장될 로컬 작업 디렉토리
     * @param outputFilename - (Optional) 생성할 영상 파일명
     * @returns 생성된 영상 파일의 절대 경로 (Local Path)
     */
    static async generatePreview(images: string[], outputDir: string, outputFilename: string = 'preview_clip.mp4'): Promise<string> {
        if (!images || images.length === 0) {
            throw new Error("No images provided for video generation.");
        }

        const listFilePath = path.join(outputDir, 'ffmpeg_input.txt');
        const outputVideoPath = path.join(outputDir, outputFilename);

        // [Step 1] FFmpeg Concat Demuxer용 입력 시퀀스 텍스트 파일 생성
        // [Logic] 각 이미지 노출 시간(Duration)을 3초로 고정하여 정적인 카드 뉴스 전달력을 높입니다.
        const DURATION = 3;
        const escapePath = (p: string) => p.replace(/'/g, "'\\''");

        const fileContent = images
            .map(img => `file '${escapePath(img)}'\nduration ${DURATION}`)
            .join('\n');

        await fs.writeFile(listFilePath, fileContent);

        Logger.info(`🎬 Generating video preview from ${images.length} images...`);

        return new Promise((resolve, reject) => {
            // [Step 2] FFmpeg 프로세스 Spawn 및 인코딩 파라미터 적용
            // [Logic] scale/pad: 4:5(이미지) -> 9:16(캔버스) 중앙 배치하여 Instagram Story 규격에 최적화합니다.
            // [Safety] libx264 및 pix_fmt yuv420p를 사용하여 모바일 기기 하드웨어 가속 재생 호환성을 확보합니다.
            // [Optimization] movflags +faststart를 통해 스트리밍 환경에서 'Moov Atom'을 선행 배치하여 재생 대기 시간을 단축합니다.
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
                // [Clean-up] 작업 완료 후 임시 ffmpeg_input.txt 파일 삭제
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
