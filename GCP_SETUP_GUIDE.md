# ITssue - GCP 서버 배포 및 자동화 가이드 (무료 티어)

이 문서는 ITssue 프로젝트를 **Google Cloud Platform (GCP)**의 **평생 무료 서버(e2-micro)**에 배포하여 24시간 자동 실행되도록 설정하는 방법을 처음부터 끝까지 설명합니다.

---

## 🏗️ 1단계: GCP 프로젝트 및 인스턴스 생성

GCP 무료 티어를 활용하기 위해 정확한 설정이 필요합니다.

### 1. 가입 및 프로젝트 만들기
1. [Google Cloud Console](https://console.cloud.google.com/)에 접속하여 구글 계정으로 로그인합니다.
2. 우측 상단 **"무료로 사용해 보기"** 버튼을 눌러 가입합니다. (신용카드 등록이 필요하지만, 무료 등급 내에서는 결제되지 않습니다.)
3. 상단 프로젝트 선택 메뉴에서 **"새 프로젝트"**를 클릭하고 이름을 입력(예: `itssue-server`)하여 생성합니다.

### 2. VM 인스턴스 생성 (중요!)
무료 혜택을 받기 위해 아래 설정을 정확히 따라야 합니다.

1. 메뉴(좌측 상단 햄버거 버튼) > **Compute Engine** > **VM 인스턴스** 클릭.
2. **"인스턴스 만들기"** 클릭.
3. **설정값 입력**:
   - **이름**: `itssue-instance` (원하는 대로)
   - **리전(Region)**: `us-central1` (아이오와) 
     > ⚠️ 중요: `us-central1`, `us-west1`, `us-east1` 중 하나여야 무료입니다.
   - **머신 구성**:
     - 시리즈: `E2`
     - 머신 유형: `e2-micro` (vCPU 2개, 메모리 1GB)
   - **부팅 디스크**:
     - **변경** 클릭.
     - 운영체제: **Ubuntu**
     - 버전: **Ubuntu 22.04 LTS** (x86/64)
     - 크기: **30 GB** (표준 영구 디스크) 
       > ⚠️ 중요: 30GB까지 무료입니다. 기본값 10GB보다 넉넉하게 잡으세요.
4. **"만들기"** 버튼 클릭. 잠시 후 서버가 생성됩니다.

---

## 📡 2단계: 서버 접속 및 코드 업로드

### 1. SSH 접속
1. 생성된 인스턴스 목록에서 **`SSH`** 버튼을 클릭합니다.
2. 브라우저 창에서 검은색 터미널이 열리면 성공입니다.

### 2. 코드 가져오기 (GitHub Clone)
서버 터미널에 다음 명령어를 입력합니다. (`[YOUR_GITHUB_URL]`은 본인 저장소 주소로 변경)

```bash
# 1. 깃허브 저장소 클론
git clone https://github.com/Jay-Bang/ITssue.git

# 2. 폴더 이동
cd ITssue
```
> **Tip:** 비공개 저장소라면 ID/PW(토큰)를 물어볼 수 있습니다. HTTP 대신 SSH 키 설정을 하거나 토큰을 준비하세요.

---

## ⚙️ 3단계: 원터치 서버 세팅 (One-Click Setup)

복잡한 리눅스 명령어를 몰라도 됩니다. 미리 만들어둔 스크립트가 다음 작업을 자동으로 수행합니다:
- ✅ Node.js 및 필수 라이브러리 설치
- ✅ Swap Memory 2GB 설정 (1GB 램 한계 극복)
- ✅ Google Chrome (Puppeteer) 의존성 설치
- ✅ PM2 (자동 실행 관리자) 설치

```bash
# 1. 실행 권한 부여
chmod +x scripts/setup_gcp_server.sh

# 2. 셋업 스크립트 실행 (커피 한 잔 하고 오세요 ☕️, 약 5~10분 소요)
./scripts/setup_gcp_server.sh
```

---

## 🔑 4단계: 환경 변수 설정

API 키 등 비밀 정보를 서버에 입력해야 합니다.

```bash
# 1. 예제 파일 복사
cp .env.example .env

# 2. 편집기로 열기
nano .env
```

`nano` 편집기가 열리면 `SUPABASE_KEY`, `GEMINI_API_KEY` 등의 값을 입력하세요.
- **저장 방법**: `Ctrl + O` -> `Enter`
- **종료 방법**: `Ctrl + X`

---

## 🤖 5단계: 자동화 데몬 시작

서버가 24시간 켜져 있어도 프로그램을 실행시켜두지 않으면 소용없습니다. `PM2`를 사용하여 백그라운드에서 계속 돌게 만듭니다.

```bash
# 1. 프로젝트 빌드 (타입스크립트 컴파일)
npm run build

# 2. 데몬 시작 (로그 이름: itssue-daemon)
pm2 start npm --name "itssue-daemon" -- run daemon

# 3. 서버 재부팅 시에도 자동 실행되도록 등록
pm2 save
pm2 startup
```
> `pm2 startup` 명령어를 치면 나오는 긴 명령어(sudo env...)를 복사해서 한 번 더 실행해줘야 완벽하게 등록됩니다.

이제 모든 준비가 끝났습니다! 🎉
서버 창을 닫아도 알아서 매일 12:00, 22:00에 보드를 만들어 올릴 것입니다.

---

## 📋 유용한 관리 명령어

```bash
# 실행 로그 확인 (잘 돌아가나 궁금할 때)
pm2 logs itssue-daemon

# 데몬 상태 확인
pm2 status

# 데몬 중지
pm2 stop itssue-daemon

# 데몬 재시작 (코드 수정 후 적용 시)
git pull origin main  # 코드 최신화
npm run build         # 다시 빌드
pm2 restart itssue-daemon
```
