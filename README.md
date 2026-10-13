# Jarvis

내가 하는 모든 일을 한곳에서 관리하고, 필요하면 AI가 실행까지 도와주는 개인 통합 업무실입니다.
회사·개인 자료를 구분하고, 업무 맥락과 결과를 연결해 보존합니다.
제품 목적과 개발 기준은 [docs/PRODUCT.md](docs/PRODUCT.md)를 먼저 확인합니다.

Next.js App Router · TypeScript · Supabase · Vercel을 사용합니다.
Node.js 24와 npm 11을 기준으로 구성했습니다.

배포된 화면: https://jarvis-zeta-three-77.vercel.app

## 화면 구조

업무실(`/`), 업무(`/tasks`), 프로젝트(`/projects`), 자료실(`/library`), 맥락(`/notes`),
설정(`/settings`)을 구성했습니다. 업무실은 오늘의 요약, 대화창, 누적 맥락과 자료 패널을 함께 보여줍니다.
회사·개인과 프로젝트 범위를 전환할 수 있으며 모바일에서는 대화와 맥락·자료를 전환합니다.
공간 검색(`Ctrl/⌘ + K`), 모바일 메뉴와 사용 안내가 동작합니다. 로그인 화면은 추가하지 않습니다.

대화 저장·재개, 맥락 편집과 수정 이력, 업무·프로젝트 생성, 업무 상태 변경,
파일 추가·다운로드와 프로젝트·업무 연결이 동작합니다. 업무실의 수치는 보관한 업무에서 집계합니다.
대화 내용을 맥락으로 추가하거나 업무로 연결할 수 있습니다.

**현재 데이터는 이 브라우저의 IndexedDB에 보관합니다.** 새로고침과 같은 브라우저의 다른 탭에서
이어갈 수 있지만 다른 기기와 동기화되지 않습니다. 브라우저 데이터를 삭제하면 보관 내용도 삭제됩니다.
자료는 파일당 20 MB까지 추가할 수 있습니다. 파일 원본과 메타데이터는 같은 트랜잭션에 저장합니다.
실제 AI 응답·실행, 자동 요약, 파일 본문 분석, Supabase 서버 동기화와 v4 연결은 아직 구현하지 않았습니다.
화면에는 AI 연결 대기와 현재 저장 범위를 표시합니다.

- `src/app/(workspace)/layout.tsx`: 모든 업무 화면의 공통 레이아웃
- `src/components/workspace/workspace-shell.tsx`: 사이드바, 헤더, 검색, 모바일 탐색
- `src/components/workspace/agent-workspace.tsx`: 대화창, 업무 요약, 누적 맥락과 연결 자료
- `src/components/workspace/workspace-provider.tsx`: 기록 로드·저장과 탭 간 갱신
- `src/components/workspace/workspace-controls.tsx`: 회사·개인, 프로젝트 범위와 맥락 편집
- `src/components/workspace/library.tsx`: 파일 보관·다운로드와 프로젝트·업무 연결
- `src/components/workspace/work-items.tsx`: 프로젝트·업무 생성과 상태 변경
- `src/components/workspace/context-page.tsx`: 맥락 관리와 수정 이력
- `src/lib/workspace/types.ts`: 업무 맥락 데이터와 영역별 연결 검증
- `src/lib/workspace/storage.ts`: IndexedDB 저장 어댑터; 변경과 파일 저장은 원자적으로 처리
- `src/components/workspace/navigation.ts`: 메뉴 정의
- `src/components/workspace/workspace.module.css`: 공통 탐색 반응형 스타일
- `src/components/workspace/studio.module.css`: 업무실·자료실·맥락 화면 반응형 스타일

서버 저장과 AI 실행을 연결할 때 회사·개인 경계, 프로젝트 연결, 기록 복원과 저장 오류 동작을
유지합니다. 서버 데이터의 접근 방식은 로그인 화면을 추가하지 않는 요구사항에 맞춰 별도로 설계합니다.

## 개발 시작

```sh
npm ci
npm run dev
```

Supabase 계정을 연결하기 전에도 기본 화면과 `/api/health`가 실행됩니다.
`npm run check`는 ESLint, TypeScript 검사, 프로덕션 빌드를 실행합니다.
GitHub Actions에 동일한 검사 절차를 등록했습니다. 자동 UI 회귀 테스트는 아직 저장소에 등록하지 않았습니다.
현재 구현은 실제 Chromium에서 대화 복원, 맥락 수정 이력, 파일 원본 복원·다운로드,
회사·개인 분리, 자료 연결, 동시 탭 저장과 저장 실패 시 롤백을 검증했습니다.

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
현재 클라우드의 `.env.local`과 Vercel에는 원격 Jarvis 프로젝트의 공개 값을 준비해 두었습니다.
다른 프로젝트로 전환할 때는 두 값을 함께 바꾼 뒤 서버를 다시 시작합니다.
프로덕션 빌드에서는 NEXT_PUBLIC 값이 빌드에 포함되므로 변경 후 다시 빌드해야 합니다.
`.env.local`은 Git에서 제외되며 `.env.example`에는 값이 없습니다.

- 브라우저: `src/lib/supabase/client.ts`의 `createClient()`
- 서버: `src/lib/supabase/server.ts`의 비동기 `createClient()`
- 세션 갱신: `src/proxy.ts`

서버 클라이언트는 요청마다 생성합니다. 인증을 사용하는 Route Handler에서 세션 쿠키를
쓰기 시작하면 응답에 `Cache-Control: private, no-store`를 지정해야 합니다.
테이블을 추가할 때는 RLS와 접근 정책을 함께 설정합니다.
업무용 데이터 스키마는 아직 구현하지 않았습니다.

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

원격 Jarvis 프로젝트는 `yncczhnvlwkxwzmqqkke`이며 서울 리전에 생성되어 있습니다.
Codex 클라우드의 토큰은 HTTPS 프록시가 처리하는 보호된 값이라 CLI가 문법 검사에서 거부할 수 있습니다.
이 환경에서는 `/workspace/.setup/jarvis-cloud.py`의 `status`와 `sync` 명령 및
`jarvis_cloud_api.py`의 Management API를 사용합니다. DB 변경은 기능 구현에 필요한
마이그레이션으로 관리하며, 초기 화면에는 업무용 테이블이 없습니다.

## Vercel 배포

기본 Next.js 설정으로 배포하므로 별도 `vercel.json`은 필요하지 않습니다.
Vercel의 `ai-report/jarvis` 프로젝트는 `kjd1374/jarvis` 저장소와 연결되어 있습니다.
Node 버전은 24.x이며 공개 Supabase 값은 Development, Preview, Production에 등록했습니다.
`main` push는 프로덕션 배포, PR은 Preview 배포로 이어집니다.

Supabase Auth의 Site URL과 Redirect URLs에는 현재 프로덕션 주소를 등록해 두었습니다.
실제 로그인 화면을 추가할 때 그 흐름과 리디렉션을 별도 검증합니다.

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

Codex 클라우드에서 Git 연동 배포가 시작되지 않았다면, 변경을 커밋하고 push한 뒤
보호된 토큰을 지원하는 API 헬퍼로 해당 커밋을 배포할 수 있습니다.

```sh
python3 /workspace/.setup/jarvis-cloud.py deploy --ref main --target production
python3 /workspace/.setup/jarvis-cloud.py status
```

배포가 `READY`인지 확인한 뒤 공개 프로덕션 도메인에서 화면을 검증합니다.

## 상태 확인

`GET /api/health`가 `{ "status": "ok", "service": "jarvis", "supabaseConfigured": ... }`를
반환합니다. `supabaseConfigured`는 환경변수가 있는지만 나타내며 DB 연결 성공을 뜻하지 않습니다.
실제 Supabase 연결은 API 요청이나 프로젝트의 기능 테스트로 별도 확인해야 합니다.
