/**
 * [Visual Card Renderer]
 * 
 * [Description] Puppeteer를 기반으로 HTML/CSS를 고해상도 카드 뉴스 이미지로 변환합니다.
 */
import puppeteer, { Browser } from 'puppeteer';
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
    outputPath: string;
    width?: number;
    height?: number;
    deviceScaleFactor?: number; // 고해상도(Retina 등) 대응 배율
    timeout?: number;
    retry?: number; // 렌더링 실패 시 재시도 횟수
    visualVersion?: 'bubblegum' | 'arcade'; // 디자인 스타일 (bubblegum, arcade)
}

// Handlebars 공통 헬퍼 등록
Handlebars.registerHelper('eq', (a, b) => a === b);
Handlebars.registerHelper('or', (a, b) => a || b);

// Singleton Pattern for Browser Instance
// Why? 브라우저 런칭 비용(Overhead)이 크기 때문에, 매 요청마다 띄우지 않고 재사용합니다.
let browser: Browser | null = null;

/**
 * [Logic] 브라우저 인스턴스 획득 (Singleton)
 * [Optimization] 크롬 브라우저 실행(Puppeteer Launch)은 메모리와 CPU 소모가 큰 작업이므로, 
 * 한 번 띄운 인스턴스를 유지(Keep-alive)하며 다수의 카드 렌더링 요청을 처리합니다.
 */
async function getBrowser() {
    // 세션이 없거나 끊어진 경우에만 새로 런칭
    if (!browser || !browser.isConnected()) {
        browser = await puppeteer.launch({
            // [Safety] 리눅스 서버 및 Docker 환경에서의 샌드박스 보안 충돌 방지
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
    }
    return browser;
}

/**
 * 브라우저 리소스 정리
 * 
 * 모든 렌더링 작업이 끝난 후 호출하여 메모리 누수를 방지합니다.
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
export async function renderCard(data: CardData, options: RenderOptions) {
    const {
        outputPath,
        width = 1080,
        height = 1350,
        deviceScaleFactor = 2,
        timeout = 15000,
        retry = 1,
        visualVersion = 'bubblegum'
    } = options;

    const templatePath = path.join(__dirname, visualVersion, 'template.html');
    const stylePath = path.join(__dirname, visualVersion, 'style.css');

    // [Step 1] 리소스 로드 (HTML/CSS)
    Logger.time('Template & Data Prep');
    const templateHtml = await fs.readFile(templatePath, 'utf-8');
    const styleCss = await fs.readFile(stylePath, 'utf-8');

    // [Step 2] Handlebars 데이터 바인딩 및 CSS 주입
    const template = Handlebars.compile(templateHtml);
    const templateData = {
        ...data
    };
    const renderedHtml = template(templateData);

    // [Layout] CSS를 수동으로 주입하여 템플릿 정합성 유지
    const html = renderedHtml.replace('/* STYLING_PLACEHOLDER */', styleCss);
    Logger.timeEnd('Template & Data Prep');

    // [Step 3] 브라우저 렌더링 루프 (Retry 지원)
    let lastError: any = null;
    for (let attempt = 0; attempt <= retry; attempt++) {
        Logger.time('Browser & Render Loop');
        const currentBrowser = await getBrowser();
        const page = await currentBrowser.newPage();

        try {
            // [Optimization] 뷰포트 및 고해상도 배율 설정
            // deviceScaleFactor를 높여(기본 2) 망막 디스플레이(Retina)급의 선명한 비트맵 이미지를 생성합니다.
            await page.setViewport({ width, height, deviceScaleFactor });

            Logger.time('Page Content Set');
            // [Step] HTML/CSS 주입 및 로딩 대기
            // 'networkidle0'을 통해 모든 시각적 에셋(이미지 등)이 로드될 때까지 대기합니다.
            await page.setContent(html, {
                waitUntil: ['load', 'networkidle0'],
                timeout
            });
            Logger.timeEnd('Page Content Set');

            // [Safety] 웹 폰트 로딩 완벽 대기 (Flash of Unstyled Text 방지)
            // 폰트가 렌더링되기 전에 스크린샷이 찍히면 깨진 레이아웃이 출력될 수 있으므로 명시적으로 대기합니다.
            await page.evaluate(`(async () => {
                await document.fonts.ready;
            })()`);

            // [Step 4] 스크린샷 캡처 및 이미지 저장
            Logger.time('Screenshot Capture');
            await fs.ensureDir(path.dirname(outputPath));
            await page.screenshot({
                path: outputPath,
                type: 'png',
                omitBackground: false
            });
            Logger.timeEnd('Screenshot Capture');

            // 타입 안전한 로그 출력
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

            Logger.success(`[${data.theme}] Card Rendered (${logInfo}): ${outputPath}`);
            return; // 성공 시 종료

        } catch (error: any) {
            lastError = error;
            Logger.error(`[${data.theme}] Attempt ${attempt} failed: ${error.message}`);
        } finally {
            await page.close();
            Logger.timeEnd('Browser & Render Loop');
        }
    }

    Logger.error(`[${data.theme}] All ${retry + 1} attempts failed.`);
    throw lastError;
}

// 로컬 테스트용 로직 (Violet Bloom 전체 세트 생성)

