import { supabase } from '../db/supabase-client';
import { Logger } from '../lib/logger';
import * as fs from 'fs-extra';
import * as path from 'path';

/**
 * [Supabase Storage Manager]
 * 
 * [Description] 로컬에서 렌더링된 카드 뉴스 이미지들을 Supabase Storage에 업로드하고 공용 URL을 관리합니다.
 * 
 * [Design Intent]
 * - 인스타그램 발행에 필요한 특정 테마 및 페이지(P1~P7) 이미지들만 선별적으로 업로드.
 * - 파일명 정규화(Sanitization)를 통해 Storage 키의 안정성 확보.
 * 
 * [Key Logic Flow]
 * 1. 출력 디렉토리 내의 PNG 파일 스캔 및 필터링.
 * 2. Supabase Storage 버킷(`instagram-feeds`)으로 바이너리 업로드.
 * 3. 업로드된 각 파일의 Public URL 생성 및 배열 반환.
 */
export async function uploadInstagramImages(dir: string, outputTag: string): Promise<{ fileName: string, publicUrl: string }[]> {
    const files = await fs.readdir(dir);
    // Version_B 이미지만 우선적으로 업로드 (인스타그램 게시용)
    const imagesToUpload = files
        .filter(f => f.endsWith('.png') && /P[1-6]/.test(f))
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
