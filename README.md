# Jarvis

회사 업무·개인 프로젝트·메모·자료·AI 활용을 한곳에서 관리하는 개인 업무실입니다.
실제 업무는 각 서비스에서 수행하고 Jarvis에서는 결과·진행·후속 행동을 연결해 관리합니다.
회사·개인 자료를 구분하고, 업무 맥락과 결과를 연결해 보존합니다.
제품 목적과 개발 기준은 [docs/PRODUCT.md](docs/PRODUCT.md)를 먼저 확인합니다.

Next.js App Router · TypeScript · Supabase · Vercel을 사용합니다.
Node.js 24와 npm 11을 기준으로 구성했습니다.

운영 주소(기존 버전): https://jarvis-zeta-three-77.vercel.app

고정 미리보기 주소: https://jarvis-preview-ai-report.vercel.app (Vercel 로그인 필요).
승인된 후속 미리보기 배포는 이 별칭을 새 preview deployment에 연결해 주소를 유지한다.
기존 일회성 미리보기 주소의 IndexedDB 기록은 이 고정 주소로 자동 이동하지 않는다.

## 화면 구조

업무실(`/`)은 오늘/기한 지난 업무, 결정·검증 요청, 연결 오류·오래된 자료, 빠른 메모,
자주 쓰는 서비스와 최근 수집 결과를 보여줍니다. 기존 네이비·블루·바이올렛 디자인을 유지했습니다.
업무(`/tasks`, 수정 요청은 `?view=requests`), 프로젝트(`/projects`), 자료실(`/library`),
맥락(`/notes`), 설정(`/settings`)의 메뉴 구조는 유지합니다.

프로젝트 상세(`/projects/[id]`)에서 목표·현재 상태·다음 행동, 결과·할 일·자료·맥락,
서비스·수정 요청·메모를 관리합니다. 자료 검색·AI 질문(`/assistant`)은 프로젝트와 영역을 제한합니다.
실제 모델은 연결되지 않았으므로 검색 결과를 답변으로 가장하지 않습니다.
서비스 등록은 웹 바로가기이며 읽기/실행 연동 완료를 의미하지 않습니다.
요청 등록과 실제 변경은 다르며, 현재 처리 상태는 사용자가 외부 서비스에서 확인해 기록합니다.

**기본 저장은 주소별 브라우저 IndexedDB입니다.** 설정에서 기존 데이터와 파일을 내보내고,
새 주소/브라우저에서 내용을 검토한 뒤 기존 기록을 보존하며 병합할 수 있습니다.
자료실에서는 파일 원본 대신 링크만 등록할 수도 있습니다.
인증된 계정·회사/개인별 Supabase 저장 API·RLS·충돌 방지와 검토/병합 UI를 구현했지만
운영에서는 기본 비활성이고 신규 인증 화면/권한 변경을 하지 않았습니다.
실제 v4 수집·AI 응답·로컬/외부 실행·자동 동기화는 연결이 필요합니다.

- [제품 기준과 구현 상태표](docs/PRODUCT.md)
- [백업·서버 저장 구조와 활성화 검토](docs/STORAGE.md)
- [v4 읽기 연결에 필요한 최소 계약](docs/integrations/v4.md)
- [검증 명령과 실패 화면/로그](docs/TESTING.md)

2026-10-14 배포 문제 진단 뒤 현재 작업 소스를 기존 고정 미리보기에 반영하는 경로를 보완했습니다. 프로덕션 공개·push·merge 및 운영 설정·인증·데이터 변경은 별도 승인 범위입니다. [배포 방법과 진단](docs/DEPLOYMENT.md)을 확인합니다.

## 개발 시작

```sh
npm ci
npm run dev
```

Supabase 계정을 연결하기 전에도 기본 화면과 `/api/health`가 실행됩니다.
`npm run check`는 ESLint, TypeScript 검사, 프로덕션 빌드를 실행합니다.
GitHub Actions에 동일한 검사와 Playwright UI·저장 회귀 테스트를 등록했습니다.
`npm run test:e2e`는 메뉴·검색·모바일·업무실 상태를, `npm run test:storage`는 실제 IndexedDB의
대화·맥락·파일 연결·복원·오류 재시도·동시 저장을 합성 자료로 검증합니다.
실행 명령과 실패 화면·로그 확인은 [docs/TESTING.md](docs/TESTING.md),
도구 비교와 채택 이유는 [docs/ENGINEERING-DECISIONS.md](docs/ENGINEERING-DECISIONS.md)를 확인합니다.

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
업무용 데이터 스키마와 인증된 서버 API는 구현했으며 운영에는 아직 적용·활성화하지 않았습니다. [저장 구조](docs/STORAGE.md)를 확인합니다.

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
마이그레이션으로 관리합니다. 이번 업무용 마이그레이션은 로컬 합성 데이터로만 검증했으며 운영에는 적용하지 않았습니다.

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
npm run deploy:preview:plan   # 업로드 대상만 확인
npm run deploy:preview        # check 후 현재 소스를 보호된 고정 미리보기로 배포
# 프로덕션으로 공개할 별도 승인이 있을 때:
npm run deploy:production
```

GitHub 연동 자동 배포만 사용할 경우 Vercel CLI 토큰은 필요하지 않습니다.
`.vercel`의 연결 정보와 `.env.local`은 커밋하지 않습니다.

Codex 클라우드의 미커밋 작업을 확인할 때는 `npm run deploy:preview`를 사용합니다. 커밋·push가 필요하지 않습니다. 기존 Git 소스 API 헬퍼는 원격 커밋 배포 전용이며 로컬 변경이 있으면 중단합니다. 프로덕션 배포를 별도로 승인받은 경우에만 아래 명령을 사용합니다.

```sh
python3 /workspace/.setup/jarvis-cloud.py deploy --ref main --target production
python3 /workspace/.setup/jarvis-cloud.py status
```

배포가 `READY`인지 확인한 뒤 공개 프로덕션 도메인에서 화면을 검증합니다.

## 상태 확인

`GET /api/health`가 `{ "status": "ok", "service": "jarvis", "supabaseConfigured": ... }`를
반환합니다. `supabaseConfigured`는 환경변수가 있는지만 나타내며 DB 연결 성공을 뜻하지 않습니다.
실제 Supabase 연결은 API 요청이나 프로젝트의 기능 테스트로 별도 확인해야 합니다.
