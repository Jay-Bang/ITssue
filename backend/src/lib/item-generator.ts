import { Logger } from './logger';
import { supabase } from '../db/supabase-client';
import { ai } from './ai-engine';

/**
 * [Single Item Regeneration Service]
 * 
 * [Description] 관리자 요청에 따라 특정 이슈 보드 항목의 AI 요약과 태그를 개별적으로 재생성합니다.
 * 
 * [Usage] Admin Dashboard -> Board Detail -> "Regenerate AI Summary"
 */
export async function regenerateItemSummary(itemId: string): Promise<string[]> {
    Logger.info(`🔄 [ItemGenerator] Starting regeneration for Item ID: ${itemId}`);

    // 1. Fetch Item Details
    const { data: item, error: fetchError } = await supabase
        .from('issue_board_items')
        .select('*')
        .eq('id', itemId)
        .single();

    if (fetchError || !item) {
        throw new Error(`Item not found: ${fetchError?.message}`);
    }

    const keyword = item.keyword;
    const rank = item.rank;
    const todayStr = new Date().toLocaleDateString('ko-KR');

    Logger.info(`🔍 [ItemGenerator] Regenerating for keyword: [${keyword}] (Rank: ${rank})`);

    // 2. Construct Prompt (Logic synced with summary-generator.ts)
    const isTop3 = rank <= 3;
    const sentenceCount = isTop3 ? 2 : 1;
    const summaryRule = isTop3
        ? "인스타그램 포스팅에 적합하도록 '정중한 어미(~습니다)'를 사용한 **2문장 요약**으로 작성해주세요."
        : "인스타그램 포스팅에 적합하도록 '정중한 어미(~습니다)'를 사용한 **딱 1문장**으로 핵심만 요약해주세요.";

    const prompt = `
당신은 트렌드 분석 전문가입니다.
오늘 날짜(${todayStr})를 기준으로 다음 키워드가 **하루 동안 왜 화제가 되었는지(이슈가 된 핵심 이유)**를 검색하여 분석해주세요.
${summaryRule}

[제약 사항]
1. 요약문 내에 **당일 날짜(${todayStr})의 표현을 포함하지 마세요. (독자가 이미 날짜를 인지하고 있음)

[키워드]: ${keyword}

결과는 반드시 아래 JSON 형식으로만 응답하세요:
{
  "summary": [${Array.from({ length: sentenceCount }, (_, i) => `"문장${i + 1}"`).join(', ')}],
  "tags": ["태그1", "태그2", "태그3", "태그4"]
}
`;

    // 3. Call AI Engine
    try {
        const text = await ai.generateWithSearch(prompt);

        // Robust JSON Parsing
        let jsonStr = text.replace(/```json|```/g, '').trim();
        const firstOpen = jsonStr.indexOf('{');
        const lastClose = jsonStr.lastIndexOf('}');

        if (firstOpen !== -1 && lastClose !== -1 && lastClose > firstOpen) {
            jsonStr = jsonStr.substring(firstOpen, lastClose + 1);
        }

        const parsed = JSON.parse(jsonStr);

        // Sanitization
        const rawSummary: string[] = parsed.summary || [];
        const sanitizedSummary = rawSummary.map((line: string) =>
            line.replace(/\*\*/g, '').replace(/\*/g, '').trim()
        );

        const rawTags: string[] = parsed.tags || [];
        const sanitizedTags = rawTags.map(tag => tag.replace(/^#/, '').trim());

        // 4. Update Database
        const { error: updateError } = await supabase
            .from('issue_board_items')
            .update({
                instagram_summary: sanitizedSummary.join('\n'), // Store as string for DB compatibility with existing schema/renderer
                tags: sanitizedTags
            })
            .eq('id', itemId);

        if (updateError) {
            throw updateError;
        }

        Logger.success(`✅ Successfully regenerated item: ${itemId}`);
        return sanitizedSummary;

    } catch (error: any) {
        Logger.error(`❌ Regeneration failed for item provided: ${keyword}`, error);
        throw error;
    }
}
