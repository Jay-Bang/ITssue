# ITssue Admin Dashboard

관리자 페이지 - 발행된 이슈 보드 조회 및 수정

## 기능

- ✅ 발행 이력 목록 조회 및 실시간 모니터링
- ✅ 특정 보드 상세 내용 확인 (이미지 캐러셀)
- ✅ 요약문/태그 인라인 수정 (자동 저장)
- ✅ 정오/야간 보드 재발행 (Server API Proxy 연동 완료)
- ✅ 로깅(`Logger`) 및 주석 체계 표준화

## 로컬 실행

```bash
cd admin
cp .env.local.example .env.local
# .env.local에 Supabase 정보 입력
npm run dev
```

## Vercel 배포

1. Vercel 프로젝트 생성
2. Root Directory: `admin`
3. Environment Variables 설정:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `BACKEND_URL` (백엔드 서버 주소)
   - `ADMIN_API_KEY` (백엔드 웹훅 인증 키)
