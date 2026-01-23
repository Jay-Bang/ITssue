import { Logger } from '../lib/logger';
import { IssueEntity, FinalIssueBoard } from '../types';
import { ai } from '../lib/ai-engine';

/**
 * [AI Summary Generator (Pass 3)]
 * 
 * [Description] 병합된 최종 이슈들에 대해 Cloud AI 서비스의 Search Grounding 기능을 활용하여 심층 요약 및 태그를 생성합니다.
 * 
 * [Design Intent]
 * - 단순 뉴스 요약을 넘어 실시간 웹 검색을 통한 사건의 본질적 원인 분석.
 * - Instagram 포스팅에 최적화된 문체(정중한 3문장) 및 관련 해시태그 생성.
 * - API Quota 보호를 위한 Throttle 및 Retry 로직 통합.
 * 
 * [Key Logic Flow]
 * 1. 각 이슈에 대해 실시간 검색 기반의 맞춤형 프롬프트 생성.
 * 2. API 쿼터 분산을 위한 일정한 지연 시간(`GENERATION_DELAY_MS`) 적용.
 * 3. AI 응답에서 JSON 데이터 추출 및 태그 정규화(Sanitization).
 * 4. 실패 시 Fallback 메시지 생성을 통한 파이프라인 연속성 보장.
 */

const GENERATION_DELAY_MS = 10000; // API 쿼터 보호를 위한 10초 대기

export async function generateAISummaries(issues: IssueEntity[]): Promise<FinalIssueBoard[]> {
    const results: FinalIssueBoard[] = [];
    const todayStr = new Date().toLocaleDateString('ko-KR');

    Logger.info(`🚀 Starting AI Search Summarization for ${issues.length} issues...`);

    for (let i = 0; i < issues.length; i++) {
        const issue = issues[i];
        const keyword = issue.representative_keyword;

        // [Optimization] API 쿼터 보호를 위한 Throttle (지연 실행)
        // [Logic] AI 서비스의 분당 요청 제한(RPM)을 초과하지 않도록 
        // 각 이슈 분석 사이에 의도적인 지연 시간(10초)을 삽입합니다.
        if (i > 0) {
            Logger.info(`⏱️ Waiting ${GENERATION_DELAY_MS / 1000}s for API quota... (${i + 1}/${issues.length})`);
            await new Promise(resolve => setTimeout(resolve, GENERATION_DELAY_MS));
        }

        Logger.info(`🔍 [AI] Analyzing keyword: [${keyword}]`);


        const isTop3 = i < 3;
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

        const MAX_RETRIES = 3;
        let success = false;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                if (attempt > 1) {
                    Logger.info(`🔄 [AI] Retrying... (Attempt ${attempt}/${MAX_RETRIES})`);
                    await new Promise(resolve => setTimeout(resolve, 3000)); // 재시도 전 짧은 대기
                }

                const text = await ai.generateWithSearch(prompt);

                // [Logic] Robust JSON Parsing (강력한 추출 로직)
                // AI 응답 텍스트 내에 JSON 외의 설명 문구가 포함되더라도, 
                // 가장 바깥쪽의 중괄호(`{`, `}`) 범위를 찾아 순수 JSON 데이터만 추출합니다.
                let jsonStr = text.replace(/```json|```/g, '').trim();
                const firstOpen = jsonStr.indexOf('{');
                const lastClose = jsonStr.lastIndexOf('}');

                if (firstOpen !== -1 && lastClose !== -1 && lastClose > firstOpen) {
                    jsonStr = jsonStr.substring(firstOpen, lastClose + 1);
                }

                const parsed = JSON.parse(jsonStr);

                // [Sanitization] AI 응답에서 마크다운 기호 제거 (**, *)
                // 인스타그램 카드 뉴스나 캡션에 마크다운 기호가 노출되지 않도록 함
                const rawSummary: string[] = parsed.summary || [];
                const sanitizedSummary = rawSummary.map((line: string) =>
                    line.replace(/\*\*/g, '').replace(/\*/g, '').trim()
                );

                // [Tag Sanitization] AI가 생성한 태그에 #이 포함되어 있으면 제거
                const rawTags: string[] = parsed.tags || [];
                const sanitizedTags = rawTags.map(tag => tag.replace(/^#/, '').trim());

                // [Step] 수집된 메트릭 및 요약 정보 통합
                results.push({
                    representative_keyword: issue.representative_keyword,
                    news_titles: issue.news_titles,
                    merge_reasons: issue.merge_reasons || [],
                    instagram_summary: sanitizedSummary,
                    tags: sanitizedTags,
                    merged_keywords: issue.merged_keywords || [],
                    // [Pass-through] 랭킹 단계에서 계산된 중요도 메트릭 유지
                    score: issue.score,
                    snapshot_count: issue.snapshot_count,
                    first_seen_at: issue.first_seen_at,
                    last_seen_at: issue.last_seen_at
                });

                Logger.success(`✅ AI analysis complete for [${keyword}]`);
                success = true;
                break; // 성공 시 재시도 루프 중단

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
