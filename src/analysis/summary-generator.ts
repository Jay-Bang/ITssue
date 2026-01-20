import { Logger } from '../lib/logger';
import { IssueEntity, FinalIssueBoard } from '../types';
import { ai } from '../lib/ai-engine';

/**
 * Phase 3-G: Intelligent Search Grounding 전용 요약 생성기
 * 
 * [설계 의도]
 * 1. 실시간 검색 기반(Grounding): 뉴스 제목에 의존하지 않고, 실시간 웹 검색을 통해 사건의 본질과 최신 현황을 직접 파악합니다.
 * 2. 원인 분석 중심: "무슨 일이 있었다"를 넘어 "왜 이슈가 되었는가"에 대한 통찰을 제공합니다.
 * 3. 쿼터 관리: Free Tier의 속도 제한을 방지하기 위해 각 요청 사이에 지연 시간(Throttle)을 둡니다.
 */

const GENERATION_DELAY_MS = 10000; // API 쿼터 보호를 위한 10초 대기

export async function generateAISummaries(issues: IssueEntity[]): Promise<FinalIssueBoard[]> {
    const results: FinalIssueBoard[] = [];
    const todayStr = new Date().toLocaleDateString('ko-KR');

    Logger.info(`🚀 Starting AI Search Summarization for ${issues.length} issues...`);

    for (let i = 0; i < issues.length; i++) {
        const issue = issues[i];
        const keyword = issue.representative_keyword;

        // [Throttle] 두 번째 요청부터 지연 시간 적용
        if (i > 0) {
            Logger.info(`⏱️ Waiting ${GENERATION_DELAY_MS / 1000}s for API quota... (${i + 1}/${issues.length})`);
            await new Promise(resolve => setTimeout(resolve, GENERATION_DELAY_MS));
        }

        Logger.info(`🔍 [AI] Analyzing keyword: [${keyword}]`);


        const prompt = `
당신은 트렌드 분석 전문가입니다.
오늘 날짜(${todayStr})를 기준으로 다음 키워드가 **하루 동안 왜 화제가 되었는지(이슈가 된 핵심 이유)**를 검색하여 분석해주세요.
인스타그램 포스팅에 적합하도록 '정중한 어미(~습니다)'를 사용한 3문장 요약으로 작성해주세요.

[제약 사항]
1. 요약문 내에 **당일 날짜(${todayStr})의 표현을 포함하지 마세요. (독자가 이미 날짜를 인지하고 있음)

[키워드]: ${keyword}

결과는 반드시 아래 JSON 형식으로만 응답하세요:
{
  "summary": ["문장1", "문장2", "문장3"],
  "tags": ["태그1", "태그2", "태그3", "태그4"]
}
`;

        const MAX_RETRIES = 3;
        let success = false;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                if (attempt > 1) {
                    Logger.info(`🔄 [AI] Retrying... (Attempt ${attempt}/${MAX_RETRIES})`);
                    await new Promise(resolve => setTimeout(resolve, 3000)); // 재시도 전 짧은 대기
                }

                const text = await ai.generateWithSearch(prompt);

                // [Robust JSON Parsing]
                let jsonStr = text.replace(/```json|```/g, '').trim();
                const firstOpen = jsonStr.indexOf('{');
                const lastClose = jsonStr.lastIndexOf('}');

                if (firstOpen !== -1 && lastClose !== -1 && lastClose > firstOpen) {
                    jsonStr = jsonStr.substring(firstOpen, lastClose + 1);
                }

                const parsed = JSON.parse(jsonStr);

                // [Tag Sanitization] AI가 생성한 태그에 #이 포함되어 있으면 제거
                const rawTags: string[] = parsed.tags || [];
                const sanitizedTags = rawTags.map(tag => tag.replace(/^#/, '').trim());

                results.push({
                    representative_keyword: issue.representative_keyword,
                    news_titles: issue.news_titles,
                    merge_reasons: issue.merge_reasons || [],
                    instagram_summary: parsed.summary || [],
                    tags: sanitizedTags,
                    merged_keywords: issue.merged_keywords || [],
                    // [Metric Pass-through]
                    score: issue.score,
                    snapshot_count: issue.snapshot_count,
                    first_seen_at: issue.first_seen_at,
                    last_seen_at: issue.last_seen_at
                });

                Logger.success(`✅ AI analysis complete for [${keyword}]`);
                success = true;
                break; // 성공 시 루프 탈출

            } catch (error: any) {
                Logger.warn(`⚠️ [AI] Attempt ${attempt} failed for [${keyword}]: ${error.message}`);
                if (attempt === MAX_RETRIES) {
                    // 최종 실패 시 Fallback
                    results.push({
                        representative_keyword: issue.representative_keyword,
                        news_titles: issue.news_titles,
                        merge_reasons: issue.merge_reasons || [],
                        instagram_summary: ["요약을 생성하지 못했습니다.", "뉴스 원문을 참고해주세요.", ""],
                        tags: [],
                        merged_keywords: issue.merged_keywords || [],
                        score: issue.score,
                        snapshot_count: issue.snapshot_count,
                        first_seen_at: issue.first_seen_at,
                        last_seen_at: issue.last_seen_at
                    });
                }
            }
        }
    }

    return results;
}
