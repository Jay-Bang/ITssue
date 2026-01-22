# ITssue 프로젝트 명령어 가이드 (USAGE GUIDE)

이 문서는 ITssue 프로젝트의 운영, 디버깅, 유지보수를 위한 다양한 명령어 실행 방법을 정리한 가이드입니다.

---

## 🚀 1. 운영 (Production Operations)

### ☀️ 정오 이슈 보드 (Daily Noon Board)
매일 **12:00 KST 이후**에 실행하여 오전 트렌드를 분석하고 발행합니다.

```bash
# [기본] 오늘자 정오 보드 생성 (분석 및 로컬 저장)
npm run board:noon

# [과거] 특정 날짜의 정오 보드 생성 (예: 2026-01-20 기준)
npm run board:noon -- 2026-01-20

# [배포] 분석 후 인스타그램 자동 발행까지 수행
npm run board:noon -- --publish
```

### 🌙 일일 이슈 보드 (Daily Night Board)
매일 **22:00 KST 이후**에 실행하여 하루 전체 트렌드를 분석하고 발행합니다.

```bash
# [기본] 오늘자 일일 보드 생성
npm run board:night

# [과거] 특정 날짜의 일일 보드 생성
npm run board:night -- 2026-01-20

# [배포] 분석 후 인스타그램 자동 발행까지 수행
npm run board:night -- --publish
```

### 🎯 커스텀 이슈 보드 (Custom Board)
특정 시간 범위를 자유롭게 지정하여 분석할 때 사용합니다.

```bash
# 날짜 지정 (YYYY-MM-DD)
npm run board:custom -- 2026-01-17 2026-01-18

# 날짜 시간 지정 (ISO 포맷)
npm run board:custom -- 2026-01-17T09:00:00 2026-01-17T18:00:00

# 분석 후 발행까지 원스톱 실행
npm run board:custom -- 2026-01-17 2026-01-18 --publish
```

---

## 🐛 2. 디버깅 및 테스트 (Debugging Tools)

`scripts/debug.ts`를 통해 전체 파이프라인을 돌리지 않고도 특정 모듈만 빠르게 검증할 수 있습니다.

### 🏆 랭킹 엔진 테스트 (Ranking Engine)
```bash
# 2026년 1월 20일 정오(NOON) 기준 랭킹 점수 확인 (Top 20)
npm run debug rank 2026-01-20 NOON
```

### 🔗 이슈 병합 테스트 (Issue Merger)
```bash
# 병합 로직 및 클러스터링 결과 확인
npm run debug merge 2026-01-20 NOON
```

### ⏱️ 정밀 시간 범위 테스트 (New!)
원하는 시간대(ISO String)를 직접 지정하여 테스트할 수 있습니다.
```bash
# 예: 2026-01-20 오전 9시 ~ 11시 사이의 랭킹 확인
npm run debug rank 2026-01-20T09:00:00 2026-01-20T11:00:00

# 해당 구간의 병합 결과 확인
npm run debug merge 2026-01-20T09:00:00 2026-01-20T11:00:00
```

### 🤖 AI 요약 테스트 (AI Summary)
```bash
# Gemini AI 요약 생성 테스트
npm run debug summary "비트코인"
```

### 🕒 시간대 로직 확인 (Date Logic)
```bash
# 현재 시스템 기준 분석 Time Window 계산 결과 확인
npm run debug date
```

---

## 🎨 3. 수동 렌더링 및 재발행 (Rendering & Republishing)

이미 생성된 분석 결과(`results_*.json`)를 디자인만 바꿔서 다시 그릴 때 사용합니다.

### 🖼️ 이미지 단순 재생성
```bash
npm run board:render -- output/2026.01.20_NIGHT/results_NIGHT_2026.01.20.json
```

### 🚀 이미지 재생성 후 인스타그램 재발행 ✨
기존 게시물 정보를 `publish_info.json`에서 읽어와 **기존 게시물을 삭제하고 새 버전으로 교체(재발행)**합니다.
```bash
npm run board:render -- output/2026.01.20_NIGHT/results_NIGHT_2026.01.20.json --publish
```

---

## 🛠️ 4. 데이터 수집 (Collection)

### 📡 트렌드 수집 (Manual Trigger)
Supabase Edge Function이 자동 수행하지만, 로컬 테스트가 필요할 때 사용합니다.
```bash
npm run collect
```

---

## ⚙️ 5. 개발 환경 (Development)

- **빌드**: `npm run build`
- **타입 체크**: `npx tsc --noEmit`

---

## ☁️ 6. 서버 배포 및 자동화 (GCP)

구글 클라우드 플랫폼(GCP)의 **e2-micro (무료 등급)** 서버를 활용하여 24시간 자동화 시스템을 구축하는 방법입니다.

### 1️⃣ 서버 초기 세팅 (One-Click Setup)
서버에 접속한 후 프로젝트를 클론하고, 다음 스크립트를 실행하면 필요한 모든 환경(Node.js, Swap Memory, Puppeteer Deps, PM2)이 자동으로 설치됩니다.

```bash
# 1. 스크립트 실행 권한 부여
chmod +x scripts/setup_gcp_server.sh

# 2. 설치 스크립트 실행 (약 5~10분 소요)
./scripts/setup_gcp_server.sh
```

### 2️⃣ 환경 변수 설정
`.env` 파일을 생성하고 API 키를 입력합니다.
```bash
cp .env.example .env
nano .env
```

### 3️⃣ 자동화 데몬 시작
`src/daemon.ts`를 PM2로 실행하여 백그라운드에서 스케줄러가 돌도록 합니다.

```bash
# 데몬 시작
pm2 start npm --name "itssue-daemon" -- run daemon

# 서버 재부팅 시 자동 실행 등록
pm2 save
pm2 startup
```

이제 서버가 24시간 켜져 있으며, 매일 정해진 시간(12:00, 22:00 KST)에 자동으로 보드를 분석하고 발행합니다.
로그 확인: `pm2 logs itssue-daemon`


---

## 🔔 7. 알림 설정 (Notifications)

파이프라인 실행 완료 시 텔레그램으로 결과 리포트와 이미지 묶음을 받을 수 있습니다.

### 1️⃣ 텔레그램 (Telegram Bot) 설정
1. [@BotFather](https://t.me/botfather)를 통해 봇을 생성하고 `API Token`을 받습니다.
2. [@userinfobot](https://t.me/userinfobot)을 통해 본인의 `Chat ID`를 확인합니다.
3. `.env` 파일에 발급받은 정보를 입력합니다 (따옴표 없이 입력 가능):
   ```env
   TELEGRAM_BOT_TOKEN=your_token_here
   TELEGRAM_CHAT_ID=your_chat_id_here
   ```

이제 분석이 완료되면 텔레그램으로 이미지 묶음과 인스타그램 캡션이 자동으로 전송됩니다.
