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
SUPABASE_SERVICE_ROLE_KEY=...
KAKAO_REST_API_KEY=...
KAKAO_CLIENT_SECRET=...
KAKAO_REDIRECT_URI=http://localhost:3000/api/kakao/callback
APP_URL=http://localhost:3000
CRON_SECRET=...
```

3. Supabase Auth에서 Email OTP/Magic Link를 활성화합니다.
4. 기존 `profiles` 테이블을 이미 만들었다면 `supabase-coach-migration.sql`도 실행합니다.
5. 카카오 디벨로퍼스에서 Redirect URI에 `APP_URL/api/kakao/callback`을 등록하고, 동의항목에서 카카오톡 메시지 전송 권한을 활성화합니다.
6. 현재 Elastic Habit 단일 화면 구조를 쓰려면 `supabase-elastic-migration.sql`을 Supabase SQL Editor에서 실행합니다.

## 화면

- `/onboarding`: Layer 0 입력 3개
- `/onboarding`: GPT 구체 질문과 행동 강령 생성
- `/evening`: 오늘 체크인 → 패턴 인사이트 → 내일 계획
- `/record`: A3 트랙레코드, done/partial/no_response/not_done 구분
- `/settings`: 저녁 회고 시간과 카카오 나에게 보내기 연결

## 현재 메인 경험

- `/`: Elastic Habit 온보딩과 일상 체크인을 한 화면에서 처리합니다.
- GPT API: Step 3 전환 문장에서 `identity_motive`를 짧게 요약하는 데만 사용합니다.
- Supabase:
  - `elastic_profiles`: 온보딩 5단계 결과 저장
  - `elastic_checkins`: 매일 Mini/Plus/Elite/not_done/no_response 저장

## 카카오 알림

- 카카오 OAuth 연결: `/api/kakao/login`
- 카카오 콜백: `/api/kakao/callback`
- 서버 알림 호출: `POST /api/notifications/kakao`

`POST /api/notifications/kakao`는 현재 한국 시간 기준 `checkin_time`이 일치하고 `kakao_linked=true`인 사용자에게 카카오 "나에게 보내기" 메시지를 보냅니다. Vercel Cron 등에서 주기적으로 호출하도록 연결하면 됩니다.
