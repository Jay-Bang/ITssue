/**
 * [Visual Card Renderer]
 * 
 * [Description] Puppeteer(Headless Chrome)를 기반으로 HTML/CSS 템플릿을 고해상도 카드 뉴스 이미지로 변환하는 시각화 엔진입니다.
 * 
 * [Design Intent]
 * - 브라우저 인스턴스 재사용(Singleton)을 통한 성능 최적화 및 리소스 관리.
 * - 디바이스 픽셀 비율(deviceScaleFactor) 조정을 통한 인스타그램 최적화 고화질 에셋 생성.
 * - 셀프 힐링(Self-healing) 로직을 통해 서버 환경에서의 브라우저 미설치 이슈에 대응합니다.
 */
import puppeteer, { Browser, Page } from 'puppeteer';
import * as Handlebars from 'handlebars';
import { Logger } from '../lib/logger';
import { FinalIssueBoard } from '../types';
import * as fs from 'fs-extra';
import * as path from 'path';

export interface BaseCardData {
    theme: string;
    date: string;
    boardTitle: string; // e.g., "정오 이슈 보드", "일일 이슈 보드"
}

export interface RankingCardData extends BaseCardData {
    type: 'ranking';
    p1Title?: string; // e.g., "MIDDAY<br>TRENDS" or "DAILY<br>TRENDS"
    ranking: Array<{ rank: number | string; keyword: string }>;
}

/**
 * [Description] 개별 이슈의 상세 정보(요약, 태그)를 담는 카드 데이터입니다.
 * FinalIssueBoard 타입을 확장하여 사용합니다.
 */
export interface IssueDetailCardData extends BaseCardData {
    type: 'issue-detail';
    rank: number | string;
    keyword: string;
    subKeywords: string[];  // FinalIssueBoard.tags 와 매핑
    summary: string[];      // FinalIssueBoard.instagram_summary 와 매핑
}

export interface GroupCardData extends BaseCardData {
    type: 'group';
    groupTitle?: string;
    rankRange?: string; // e.g., "TOP 5 ~ TOP 7"
    issues: Array<{ rank: number | string; keyword: string; summaryLines: string[] }>;
}

export type CardData = RankingCardData | IssueDetailCardData | GroupCardData;

export interface RenderOptions {
    outputPath?: string; // [Logic] 호출부에서 버퍼를 직접 처리하므로 선택 사항임
    fileName?: string; // [Logic] 버퍼 식별용 이름
    width?: number;
    height?: number;
    deviceScaleFactor?: number; // [Optimization] 고해상도(Retina 등) 대응 배율
    timeout?: number;
    retry?: number; // [Safety] 렌더링 실패 시 재시도 횟수
    visualVersion?: 'bubblegum' | 'arcade'; // [Logic] 디자인 스타일 (bubblegum, arcade)
}

// [Logic] Handlebars 공통 헬퍼 등록
Handlebars.registerHelper('eq', (a, b) => a === b);
Handlebars.registerHelper('or', (a, b) => a || b);

// [Logic] Browser Instance Singleton Pattern
// [Optimization] 브라우저 런칭 비용(Overhead)이 매우 크기 때문에, 인스턴스를 하나만 생성하여 프로세스 전반에서 영속적으로 공유합니다.
let browser: Browser | null = null;

/**
 * [Logic] 브라우저 인스턴스 획득 (Singleton)
 * [Optimization] 크롬 브라우저 실행(Puppeteer Launch)은 메모리와 CPU 소모가 큰 작업이므로, 
 * 한 번 띄운 인스턴스를 유지(Keep-alive)하며 다수의 카드 렌더링 요청을 처리합니다.
 */
import { execSync } from 'child_process';

/**
 * [Logic] 브라우저 인스턴스 획득 (Singleton + Self Healing)
 * 
 * [Optimization] 크롬 브라우저 실행은 리소스 소모가 크므로, 기존 인스턴스가 살아있다면 재사용합니다.
 * [Self-Healing] 환경 설정 미비로 크롬을 찾지 못할 경우, 유저 개입 없이 자동으로 설치를 시도하여 파이프라인 중단을 방지합니다.
 */
async function getBrowser(retryCount = 0): Promise<Browser> {
    // 세션이 없거나 끊어진 경우에만 새로 런칭
    if (!browser || !browser.isConnected()) {
        try {
            browser = await puppeteer.launch({
                // [Safety] 리눅스 서버 및 Docker 환경에서의 샌드박스 보안 충돌 방지
                // [Networking] --force-ipv4를 통해 GCP 환경에서의 IPv6 연결 지연 및 타임아웃 방지
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--force-ipv4'
                ]
            });
        } catch (error: any) {
            // [Critical Path] 크롬 브라우저 미설치/버전 미스매치 대응
            if (error.message.includes('Could not find Chrome') && retryCount === 0) {
                Logger.warn('⚠️ [Self-Healing] Chrome browser not found. Attempting automatic installation...');
                try {
                    // Puppeteer 공식 브라우저 설치 명령어 실행
                    execSync('npx puppeteer browsers install chrome', { stdio: 'inherit' });
                    Logger.success('✅ [Self-Healing] Chrome installed successfully. Retrying launch...');
                    return getBrowser(1); // 재시도 (최대 1회)
                } catch (installError: any) {
                    Logger.error('❌ [Self-Healing] Failed to install Chrome automatically', installError);
                    throw error;
                }
            }
            throw error;
        }
    }
    return browser;
}

/**
 * [Cleanup] 브라우저 리소스 정리
 * 모든 렌더링 작업 종료 후 호출하여 점유 중인 메모리와 프로세스를 해제합니다.
 */
export async function closeBrowser() {
    if (browser) {
        await browser.close();
        browser = null;
        Logger.info('🌐 Browser Singleton Closed.');
    }
}

/**
 * [Dynamic Visual Renderer]
 * 
 * [Description] Puppeteer를 사용하여 HTML/CSS 템플릿을 고해상도 인스타그램용 카드 뉴스 이미지로 렌더링합니다.
 * 
 * [Design Intent]
 * - 브라우저 인스턴스 재사용(Singleton)을 통한 성능 최적화.
 * - 장치 픽셀 비율(deviceScaleFactor) 조정을 통한 고퀄리티 시각 자산 생성.
 * - 폰트 로딩 대기 및 동적 텍스트 스케일링을 통한 레이아웃 정합성 유지.
 * 
 * [Key Logic Flow]
 * 1. 브라우저 싱글톤 인스턴스 획득 및 새 페이지 생성.
 * 2. Handlebars 템플릿에 데이터 주입 및 CSS 삽입.
 * 3. `document.fonts.ready`를 통한 웹 폰트 로딩 완벽 대기.
 * 4. 뷰포트 설정 후 PNG 스크린샷 캡처 및 자동 저장.
 */
export async function renderCard(page: Page, data: CardData, options: RenderOptions): Promise<Buffer> {
    // [Logic] 기본 옵션 및 폴백 설정
    const {
        fileName,
        timeout = 30000,
        retry = 1,
        visualVersion = 'bubblegum'
    } = options;

    const templatePath = path.join(__dirname, visualVersion, 'template.html');
    const stylePath = path.join(__dirname, visualVersion, 'style.css');

    // [Step 1] 리소스 로드 (HTML/CSS)

    const templateHtml = await fs.readFile(templatePath, 'utf-8');
    const styleCss = await fs.readFile(stylePath, 'utf-8');

    // [Step 2] Handlebars 데이터 바인딩 및 CSS 주입
    const template = Handlebars.compile(templateHtml);
    const templateData = {
        ...data
    };
    // [Logic] 템플릿 렌더링 및 CSS 수동 주입 (레이아웃 정합성 유지)
    const renderedHtml = template(templateData);
    const html = renderedHtml.replace('/* STYLING_PLACEHOLDER */', styleCss);


    // [Step 3] 브라우저 렌더링 루프 (Retry 지원) - Page is now injected
    let lastError: any = null;
    for (let attempt = 0; attempt <= retry; attempt++) {
        try {

            // [Step] HTML/CSS 주입 및 로딩 대기
            // [Optimization] 'networkidle0'은 외부 폰트/에셋의 네트워크 상황에 따라 타임아웃을 유발할 수 있습니다.
            // HTML 본문과 구조 로딩('domcontentloaded')까지만 대기한 후, 폰트 로딩은 JS에서 별도로 관리합니다.
            await page.setContent(html, {
                waitUntil: ['load', 'domcontentloaded'],
                timeout
            });


            // [Safety] 웹 폰트 로딩 완벽 대기 (Flash of Unstyled Text 방지)
            // 폰트가 렌더링되기 전에 스크린샷이 찍히면 깨진 레이아웃이 출력될 수 있으므로 명시적으로 대기합니다.
            await page.evaluate(`(async () => {
                await document.fonts.ready;
            })()`);

            // [Step 4] 스크린샷 캡처 및 이미지 반환

            // path 파라미터를 제거하여 Uint8Array(Buffer)로 반환받음
            const imageBuffer = await page.screenshot({
                type: 'png',
                omitBackground: false
            });


            // [Logic] 타입 안전한 로그 문자열 생성
            let logInfo = '';
            switch (data.type) {
                case 'ranking':
                    logInfo = `Ranking (${data.ranking.length} items)`;
                    break;
                case 'issue-detail':
                    logInfo = `Issue: ${data.keyword}`;
                    break;
                case 'group':
                    logInfo = `Group: ${data.rankRange || data.groupTitle}`;
                    break;
            }

            Logger.success(`[${data.theme}] Card Rendered to memory (${logInfo})`);
            return Buffer.from(imageBuffer); // [Step] 성공 시 Buffer 반환 및 종료

        } catch (error: any) {
            lastError = error;
            Logger.error(`[${data.theme}] Attempt ${attempt} failed: ${error.message}`);
        }
    }

    Logger.error(`[${data.theme}] All ${retry + 1} attempts failed.`);
    throw lastError;
}

/**
 * [Logic] 카드 뉴스 이미지 세트 생성기 (Shared Utility)
 * [Description] P1(랭킹), P2~P4(상위 이슈 상세), P5~P6(하위 이슈 그룹) 이미지를 순차적으로 렌더링합니다.
 * [Optimization] Orchestrator와 RepublishService에서 공통으로 사용하며, 테마 및 시각적 일관성을 보장합니다.
 */
export async function renderFullSet(
    issues: FinalIssueBoard[],
    date: string,
    type: string,
    theme: string,
    boardTitle: string,
    visualVersion: 'bubblegum' | 'arcade',
    p1Title?: string,
    isSummaryMode: boolean = true
): Promise<{ fileName: string, buffer: Buffer }[]> {
    const renderOpts: RenderOptions = { visualVersion };
    const resultBuffers: { fileName: string, buffer: Buffer }[] = [];

    Logger.info(`[RenderFullSet] Initializing shared Puppeteer page instance...`);
    const currentBrowser = await getBrowser();
    const page = await currentBrowser.newPage();

    // [Optimization] 뷰포트(Viewport) 및 해상도 배율 1회 일괄 설정
    await page.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 2 });

    try {
        // [Step] P1: 랭킹 요약 카드(Ranking Page) 생성
        const p1Data: RankingCardData = {
            type: 'ranking',
            date,
            theme,
            boardTitle,
            p1Title,
            ranking: issues.map(i => ({ rank: i.rank!, keyword: i.representative_keyword }))
        };
        const p1Buffer = await renderCard(page, p1Data, renderOpts);
        resultBuffers.push({ fileName: `P1_${type}_${date}.png`, buffer: p1Buffer });

        if (!isSummaryMode) {
            // [Logic] Detail Mode: 모든 이슈를 개별 상세 페이지로 렌더링
            for (const issue of issues) {
                const detailData: IssueDetailCardData = {
                    type: 'issue-detail',
                    date,
                    theme,
                    boardTitle,
                    rank: issue.rank!,
                    keyword: issue.representative_keyword,
                    subKeywords: issue.tags,
                    summary: issue.instagram_summary
                };
                const buffer = await renderCard(page, detailData, renderOpts);
                resultBuffers.push({ fileName: `P${issue.rank! + 1}_${type}_${date}.png`, buffer });
            }
        } else {
            // [Logic] Summary Mode: P2~P4(상위 3개 상세) + P5~P6(하위 그룹)
            // [Step] P2~P4: Top 3 Issue Details 렌더링
            const top3 = issues.slice(0, 3);
            for (const issue of top3) {
                const detailData: IssueDetailCardData = {
                    type: 'issue-detail',
                    date,
                    theme,
                    boardTitle,
                    rank: issue.rank!,
                    keyword: issue.representative_keyword,
                    subKeywords: issue.tags,
                    summary: issue.instagram_summary
                };
                const buffer = await renderCard(page, detailData, renderOpts);
                resultBuffers.push({ fileName: `P${issue.rank! + 1}_${type}_${date}.png`, buffer });
            }

            // [Step] P5: Group 4~6 렌더링
            const group4to6 = issues.slice(3, 6);
            if (group4to6.length > 0) {
                const groupData: GroupCardData = {
                    type: 'group',
                    date,
                    theme,
                    boardTitle,
                    rankRange: "TOP 4 ~ TOP 6",
                    issues: group4to6.map(iss => ({
                        rank: iss.rank!,
                        keyword: iss.representative_keyword,
                        summaryLines: iss.instagram_summary.slice(0, 2)
                    }))
                };
                const buffer = await renderCard(page, groupData, renderOpts);
                resultBuffers.push({ fileName: `P5_${type}_${date}.png`, buffer });
            }

            // [Step] P6: Group 7~10 렌더링
            const group7to10 = issues.slice(6, 10);
            if (group7to10.length > 0) {
                const groupData: GroupCardData = {
                    type: 'group',
                    date,
                    theme,
                    boardTitle,
                    rankRange: "TOP 7 ~ TOP 10",
                    issues: group7to10.map(iss => ({
                        rank: iss.rank!,
                        keyword: iss.representative_keyword,
                        summaryLines: iss.instagram_summary.slice(0, 2)
                    }))
                };
                const buffer = await renderCard(page, groupData, renderOpts);
                resultBuffers.push({ fileName: `P6_${type}_${date}.png`, buffer });
            }
        }
    } finally {
        await page.close();
        Logger.info(`[RenderFullSet] Shared Puppeteer page closed.`);
    }

    return resultBuffers;
}

