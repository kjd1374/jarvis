# Jarvis

Next.js App Router · TypeScript · Supabase · Vercel을 사용하는 초기 프로젝트입니다.
Node.js 24와 npm 11을 기준으로 구성했습니다.

## 개발 시작

```sh
npm ci
npm run dev
```

Supabase 계정을 연결하기 전에도 기본 화면과 `/api/health`가 실행됩니다.
`npm run check`는 ESLint, TypeScript 검사, 프로덕션 빌드를 실행합니다.
현재 기능 테스트는 없으며 GitHub Actions에 동일한 검사 절차를 등록했습니다.

Codex 클라우드에서는 기존 `/workspace/jarvis` 체크아웃을 사용합니다.
작업마다 환경이 격리되므로 별도 Git worktree를 만들 필요가 없습니다.
홈 디렉터리가 읽기 전용인 환경에서는 명령을 실행할 셸에 다음을 적용합니다.

```sh
source /workspace/.setup/jarvis-env.sh
```

이 초기화 파일은 클라우드 설치 스크립트가 준비합니다. 도구 캐시·설정을 쓰기 가능한
`/workspace` 아래에 두고, 로컬 Supabase 컨테이너의 HTTPS 프록시 경로를 유지하고 HTTP 상태 검사를
컨테이너 안에서 직접 요청하도록 설정합니다. 경량 이미지의 BusyBox wget은
`no_proxy`를 무시하므로 로컬 스택용 Docker 설정에서 HTTP 프록시를 제외합니다. 기존 인증 정보는 복사하지 않습니다.
일반적인 로컬 PC에서는 이 클라우드 전용 초기화가 필요하지 않습니다.

## Supabase

공개 프로젝트 URL과 publishable key를 사용합니다. 기존 프로젝트의 anon key도 같은
환경변수에 사용할 수 있습니다. service-role/secret key는 브라우저에 넣지 않습니다.

```sh
test -f .env.local || cp .env.example .env.local
```

`.env.local`에 `NEXT_PUBLIC_SUPABASE_URL`과
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`를 채운 뒤 개발 서버를 다시 시작합니다.
두 값은 Supabase 프로젝트의 API 설정에서 확인할 수 있습니다.
현재 클라우드에는 검증한 로컬 Supabase 값으로 `.env.local`을 준비해 두었습니다.
원격 프로젝트로 전환할 때는 두 값을 함께 바꾼 뒤 서버를 다시 시작합니다.
프로덕션 빌드에서는 NEXT_PUBLIC 값이 빌드에 포함되므로 변경 후 다시 빌드해야 합니다.
`.env.local`은 Git에서 제외되며 `.env.example`에는 값이 없습니다.

- 브라우저: `src/lib/supabase/client.ts`의 `createClient()`
- 서버: `src/lib/supabase/server.ts`의 비동기 `createClient()`
- 세션 갱신: `src/proxy.ts`

서버 클라이언트는 요청마다 생성합니다. 인증을 사용하는 Route Handler에서 세션 쿠키를
쓰기 시작하면 응답에 `Cache-Control: private, no-store`를 지정해야 합니다.
테이블을 추가할 때는 RLS와 접근 정책을 함께 설정합니다.
로그인 화면과 업무용 데이터 스키마는 아직 구현하지 않았습니다.

### 선택: 로컬 데이터베이스

Docker가 필요합니다. 초기 단계에서는 Postgres, Auth, REST API와 게이트웨이만 실행합니다.
Studio, Realtime, Storage, 메일, Edge Functions, Analytics 등은 기본 명령에서 제외했습니다.
필요해지면 `npx --no-install supabase start`로 전체 스택을 실행할 수 있습니다.
위의 slim-image 옵션은 공식 CLI가 제공하는 digest 고정 이미지를 사용해 디스크 사용을 줄입니다.

```sh
npm run db:start
npm run db:status
npm run db:stop
```

로컬 API URL과 공개 키를 `.env.local`에 넣으면 로컬 Supabase를 앱에서 사용할 수 있습니다.
`db:status`는 키도 출력하므로 그 전체 출력을 채팅이나 공개 로그에 복사하지 않습니다.
`npm run db:reset`은 로컬 데이터를 초기화합니다. 클라우드 DB에 실행하지 않습니다.

마이그레이션은 `supabase/migrations`에 관리합니다.
원격 프로젝트를 관리할 때에는 환경 설정에 저장한 `SUPABASE_ACCESS_TOKEN`과 프로젝트 ref를
사용합니다. CLI 접근 토큰은 앱의 publishable key와 별개입니다.

```sh
npx --no-install supabase projects list
npx --no-install supabase link --project-ref "$SUPABASE_PROJECT_REF"
```

원격 연결은 계정과 프로젝트를 확인한 뒤 실행합니다. DB 연결에 추가 인증이 필요하면
Supabase가 안내하는 안전한 입력 경로를 사용합니다. 이 초기 설정은 원격 DB를 변경하지 않습니다.

## Vercel 배포

기본 Next.js 설정으로 배포할 수 있어 별도 `vercel.json`은 필요하지 않습니다.
계정 연결과 배포는 아직 수행하지 않았습니다.

1. 이 초기 코드를 GitHub의 `kjd1374/jarvis` 저장소에 커밋하고 push합니다.
2. Vercel에서 해당 GitHub 저장소를 Import하고 Framework를 Next.js로 선택합니다.
   저장소 내 앱 루트는 `/`이며 Node 버전은 24.x입니다.
3. Vercel의 Development, Preview, Production 환경에 위의 공개 Supabase 환경변수 두 개를
   각각 등록합니다. 실제 배포에서는 원격 프로젝트 값을 사용합니다.
4. 연결 후 `main` push는 프로덕션 배포, PR은 Preview 배포로 이어집니다.
5. Supabase Auth를 사용할 때에는 프로젝트의 Site URL과 Redirect URLs에 실제 배포 주소를
   등록합니다.

CLI를 사용할 경우 환경 설정에 `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`를
등록한 후 기존 프로젝트에 연결할 수 있습니다. 토큰 값을 채팅이나 저장소에 넣지 않습니다.

```sh
npx --no-install vercel link --yes --team "$VERCEL_ORG_ID" --project "$VERCEL_PROJECT_ID"
npm run deploy:preview
# 프로덕션으로 공개할 준비가 되었을 때:
npm run deploy:production
```

GitHub 연동 자동 배포만 사용할 경우 Vercel CLI 토큰은 필요하지 않습니다.
`.vercel`의 연결 정보와 `.env.local`은 커밋하지 않습니다.

## 상태 확인

`GET /api/health`가 `{ "status": "ok", "service": "jarvis", "supabaseConfigured": ... }`를
반환합니다. `supabaseConfigured`는 환경변수가 있는지만 나타내며 DB 연결 성공을 뜻하지 않습니다.
실제 Supabase 연결은 API 요청이나 프로젝트의 기능 테스트로 별도 확인해야 합니다.
