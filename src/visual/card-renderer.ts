import puppeteer, { Browser } from 'puppeteer';
import * as Handlebars from 'handlebars';
import { Logger } from '../lib/logger';
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

export interface IssueDetailCardData extends BaseCardData {
    type: 'issue-detail';
    rank: number | string;
    keyword: string;
    subKeywords: string[];
    summary: string[];
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
}

// Handlebars 공통 헬퍼 등록
Handlebars.registerHelper('eq', (a, b) => a === b);

// Singleton Pattern for Browser Instance
// Why? 브라우저 런칭 비용(Overhead)이 크기 때문에, 매 요청마다 띄우지 않고 재사용합니다.
let browser: Browser | null = null;

/**
 * 브라우저 인스턴스 획득 (Singleton)
 * 
 * - 없으면 새로 띄우고, 연결이 끊어졌으면 재연결합니다.
 * - Docker/Server 환경 호환을 위한 플래그(`--no-sandbox` 등)가 적용되어 있습니다.
 */
async function getBrowser() {
    if (!browser || !browser.isConnected()) {
        browser = await puppeteer.launch({
            args: ['--no-sandbox', '--disable-setuid-sandbox'] // Docker/Server 환경 호환성
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
 * [Phase 5] 카드 뉴스 이미지 렌더링 함수
 * 
 * HTML 템플릿과 CSS를 조합하여 Puppeteer로 스크린샷을 찍습니다.
 * 
 * [Pipeline]
 * 1. Template & Data Prep: Handlebars로 HTML 생성 및 CSS 주입
 * 2. Browser & Render Loop: 페이지 로드, 폰트 대기, 뷰포트 설정
 * 3. Screenshot Capture: PNG 이미지 생성 및 저장
 * 
 * [Features]
 * - Retry Logic: 렌더링 실패 시 자동 재시도
 * - Font Ready Wait: 폰트 로딩 완료를 명시적으로 대기하여 글자 깨짐 방지
 * - High DPI Support: deviceScaleFactor 옵션 지원
 */
export async function renderCard(data: CardData, options: RenderOptions) {
    const {
        outputPath,
        width = 1080,
        height = 1080,
        deviceScaleFactor = 2,
        timeout = 15000,
        retry = 1
    } = options;

    const templatePath = path.join(__dirname, 'template.html');
    const stylePath = path.join(__dirname, 'style.css');

    // 1. 템플릿 로드
    Logger.time('Template & Data Prep');
    const templateHtml = await fs.readFile(templatePath, 'utf-8');
    const styleCss = await fs.readFile(stylePath, 'utf-8');

    // 2. Handlebars 컴파일 및 데이터 가공
    const template = Handlebars.compile(templateHtml);
    const templateData = {
        ...data
    };
    const renderedHtml = template(templateData);

    // 포매터(Prettier 등)가 <style> 안의 Handlebars 문법을 망가뜨리는 것을 방지하기 위해 
    // 수동으로 CSS를 주입합니다.
    const html = renderedHtml.replace('/* STYLING_PLACEHOLDER */', styleCss);
    Logger.timeEnd('Template & Data Prep');

    // 3. 렌더링 루프 (재시도 로직 포함)
    let lastError: any = null;
    for (let attempt = 0; attempt <= retry; attempt++) {
        Logger.time('Browser & Render Loop');
        const currentBrowser = await getBrowser();
        const page = await currentBrowser.newPage();

        try {
            if (attempt > 0) {
                Logger.info(`🔄 [${data.theme}] Retry attempt ${attempt}/${retry}...`);
            }

            await page.setViewport({ width, height, deviceScaleFactor });

            Logger.time('Page Content Set');
            await page.setContent(html, {
                waitUntil: ['load', 'networkidle0'],
                timeout
            });
            Logger.timeEnd('Page Content Set');

            // 폰트 로딩 완벽 대기 (Correctness)
            // 폰트가 로드되기 전에 스크린샷이 찍히면 글자가 깨지거나 기본 폰트로 나올 수 있음.
            // document.fonts.ready 프로미스를 명시적으로 대기하여 'Flash of Unstyled Text' 방지.
            await page.evaluate(`(async () => {
                await document.fonts.ready;
            })()`);

            // 4. 스크린샷 캡처
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

