import { supabase } from '../db/supabase-client';
import { Logger } from '../lib/logger';
import * as fs from 'fs-extra';
import * as path from 'path';

/**
 * 인스타그램용 이미지들을 Supabase Storage에 업로드합니다.
 * 
 * [동작 방식]
 * 1. 지정된 출력 디렉토리에서 'Version_B' (인스타그램용 테마) 이미지들을 스캔합니다.
 * 2. 필터링: 'Ranking', 'P2' ~ 'P7' (실제 포스팅에 필요한 이미지들만 선별)
 * 3. Supabase Storage의 'instagram-feeds' 버킷에 업로드합니다.
 * 4. 업로드된 파일들의 공용 URL(Public URL)을 배열로 반환합니다.
 * 
 * @param dir - 업로드할 이미지가 있는 로컬 디렉토리 경로
 * @param outputTag - Storage 경로 구성을 위한 고유 태그 (예: 2026.01.17_CUSTOM_...)
 * @returns 업로드된 이미지들의 파일명과 공용 URL 객체 배열
 */
export async function uploadInstagramImages(dir: string, outputTag: string): Promise<{ fileName: string, publicUrl: string }[]> {
    const files = await fs.readdir(dir);
    // Version_B 이미지만 우선적으로 업로드 (인스타그램 게시용)
    const imagesToUpload = files
        .filter(f => f.endsWith('.png') && (f.includes('P1_Ranking') || f.includes('P2') || f.includes('P3') || f.includes('P4') || f.includes('P5') || f.includes('P6') || f.includes('P7')))
        .sort();

    Logger.info(`🚀 Uploading ${imagesToUpload.length} images to Supabase Storage...`);
    const urls: { fileName: string, publicUrl: string }[] = [];

    for (const fileName of imagesToUpload) {
        const filePath = path.join(dir, fileName);
        const fileBuffer = await fs.readFile(filePath);

        // [Sanitization] Supabase Storage keys should be ASCII-safe.
        // Extract prefix (1, P2, P3...) to create a safe filename.
        const prefix = fileName.split('_')[0];
        const safeFileName = prefix.startsWith('P') ? `${prefix}.png` : `P${prefix}.png`;
        const storagePath = `${outputTag}/${safeFileName}`;

        const { data, error } = await supabase.storage
            .from('instagram-feeds')
            .upload(storagePath, fileBuffer, {
                contentType: 'image/png',
                upsert: true
            });

        if (error) {
            Logger.error(`Failed to upload ${fileName}`, error);
            continue;
        }

        const { data: { publicUrl } } = supabase.storage
            .from('instagram-feeds')
            .getPublicUrl(storagePath);

        urls.push({ fileName, publicUrl });
        Logger.success(`Uploaded: ${fileName} -> ${publicUrl}`);
    }

    return urls;
}
