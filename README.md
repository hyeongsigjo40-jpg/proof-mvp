# Proof MVP

Next.js + Supabase로 만든 Proof MVP입니다. Supabase 환경변수가 없으면 브라우저 localStorage 기반 데모 모드로 동작합니다.

## 실행

```bash
npm install
npm run dev
```

## Supabase 연결

1. Supabase 프로젝트를 만들고 `supabase-schema.sql`을 SQL editor에서 실행합니다.
2. `.env.example`을 참고해서 `.env.local`에 값을 넣습니다.

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.4-mini
```

3. Supabase Auth에서 Email OTP/Magic Link를 활성화합니다.
4. 기존 `profiles` 테이블을 이미 만들었다면 `supabase-coach-migration.sql`도 실행합니다.

## 화면

- `/onboarding`: Layer 0 입력 3개
- `/onboarding`: GPT 구체 질문과 행동 강령 생성
- `/plan`: A1 한 줄 계획
- `/check-in`: A9 체크인
- `/record`: A3 트랙레코드
