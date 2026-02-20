import { supabase } from '../db/supabase-client';
import { Logger } from '../lib/logger';

/**
 * [Supabase Storage Manager]
 * 
 * [Description] 로컬에서 렌더링된 카드 뉴스 이미지들을 Supabase Storage에 업로드하고 공용 URL을 관리합니다.
 * 
 * [Design Intent]
 * - [Strategy] 인스타그램 발행에 필요한 특정 페이지(P1~P6) 이미지들만 선별적으로 업로드하여 저장 공간을 최적화합니다.
 * - [Safety] 파일명 정규화(Sanitization)를 통해 공백이나 특수문자로 인한 Storage 키 오류를 방지합니다.
 */
export async function uploadInstagramImages(images: { fileName: string, buffer: Buffer }[], outputTag: string): Promise<{ fileName: string, publicUrl: string }[]> {
    // [Step 1] 인스타그램 발행 규격(P1~P6)에 맞는 이미지 필터링 및 정렬
    const imagesToUpload = images
        .filter(f => f.fileName.endsWith('.png') && /P[1-6]/.test(f.fileName))
        .sort((a, b) => a.fileName.localeCompare(b.fileName));

    Logger.info(`🚀 Uploading ${imagesToUpload.length} images to Supabase Storage from memory...`);
    const urls: { fileName: string, publicUrl: string }[] = [];

    for (const image of imagesToUpload) {
        // [Logic] 파일명 정규화 (Sanitization): Storage Key 정책 준수 및 ASCII 안전성 확보
        const prefix = image.fileName.split('_')[0];
        const safeFileName = prefix.startsWith('P') ? `${prefix}.png` : `P${prefix}.png`;
        const storagePath = `${outputTag}/${safeFileName}`;

        // [Step 2] Supabase Storage 버킷에 바이너리 데이터 직접 업로드
        const { data, error } = await supabase.storage
            .from('instagram-feeds')
            .upload(storagePath, image.buffer, {
                contentType: 'image/png',
                upsert: true
            });

        if (error) {
            Logger.error(`Failed to upload ${image.fileName}`, error);
            continue;
        }

        // [Step 3] 업로드된 파일의 공용 URL (Public URL) 획득
        const { data: { publicUrl } } = supabase.storage
            .from('instagram-feeds')
            .getPublicUrl(storagePath);

        urls.push({ fileName: image.fileName, publicUrl });
        Logger.success(`Uploaded: ${image.fileName} -> ${publicUrl}`);
    }

    return urls;
}
