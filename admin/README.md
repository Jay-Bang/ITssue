# ITssue Admin Dashboard

관리자 페이지 - 발행된 이슈 보드 조회 및 수정

## 기능

- ✅ 발행 이력 목록 조회
- ✅ 특정 보드 상세 내용 확인
- ✅ 요약문/태그 인라인 수정 (자동 저장)
- ⏸️ 재발행 (서버 연동 필요)

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
