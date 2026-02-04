# ITssue Admin Dashboard

**ITssue-AI** 전용 관리자 대시보드입니다. 발행된 이슈 보드를 실시간으로 모니터링하고, AI가 생성한 요약문 및 태그를 수동으로 수정하여 즉시 재발행할 수 있는 인터페이스를 제공합니다.

## 🛠 Tech Stack

- **Framework:** Next.js 16 (App Router)
- **Styling:** Tailwind CSS 4
- **Auth & DB:** Supabase (Auth, PostgreSQL)
- **Deployment:** Vercel

## ✨ 주요 기능

- **📊 실시간 모니터링**: 발행된 보드 목록 및 인스타그램 게시 상태 조회.
- **📝 인라인 에디터**: 이슈별 요약문 및 해시태그 즉시 수정 및 자동 DB 저장.
- **🚀 스마트 재발행**: 수동 수정 후 백엔드(GCP) 웹훅을 트리거하여 카드 뉴스 재생성 및 인스타그램 게시물 교체.
- **🛡️ 보안 프록시**: Next.js API Routes를 Proxy 계층으로 활용하여 백엔드 API 키 노출 없이 안전한 통신 구현.

## ⚙️ 로컬 실행 가이드

1. **의존성 설치**:
   ```bash
   cd admin
   npm install
   ```

2. **환경 변수 설정**:
   `.env.local.example` 파일을 복사하여 `.env.local` 생성 후 Supabase 및 백엔드 정보를 입력합니다.
   ```bash
   cp .env.local.example .env.local
   ```

3. **실행**:
   ```bash
   npm run dev
   ```

## ☁️ Vercel 배포 설정

1. Vercel 프로젝트 생성 시 `Root Directory`를 `admin`으로 설정합니다.
2. 다음 환경 변수를 반드시 프로젝트 설정에 추가하세요.
   - `NEXT_PUBLIC_SUPABASE_URL`: Supabase 프로젝트 URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase 익명 API 키
   - `BACKEND_URL`: GCP 백엔드 서버 주소 (e.g., `http://34.x.x.x:3000`)
   - `ADMIN_API_KEY`: 백엔드 웹훅 인증용 시크릿 키
