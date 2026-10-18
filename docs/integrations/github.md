# GitHub 개발 기록과 구독 CLI 점검

Issue #11의 요청에 따라 저장소를 등록하면 읽기 점검을 대기열에 저장한다. 프로젝트와 설정에서 같은 점검·근거·AI 제안을 확인한다. **실제 자료 읽기와 AI 분석은 사용자가 연결한 실행기가 켜져 있을 때만 수행한다.** 웹 URL 등록만으로 로그인·수집·실행이 완료되지는 않는다.

## ChatGPT 구독으로 연결

별도 OpenAI API 결제 없이 공식 Codex CLI의 저장된 ChatGPT 로그인을 사용한다. 구독별 Codex 이용 가능 여부·사용 한도가 적용된다. 웹 구독을 Vercel 서버의 API 키로 바꾸는 방식이 아니다. 이번 실행기는 Codex만 지원하며 Claude Code 연결을 제공한다고 표시하지 않는다.

1. macOS·Linux·WSL의 실행할 컴퓨터에 Node 24+, [GitHub CLI](https://cli.github.com/), [공식 Codex CLI](https://developers.openai.com/codex/cli/)를 설치한다.
2. `gh auth login`으로 허용할 저장소의 읽기 권한을 확인한다. `codex login`에서 ChatGPT 로그인, `codex login status`에서 ChatGPT 방식을 확인한다. API 키 방식이면 실행기가 분석을 거절하며 API 과금으로 전환하지 않는다.
3. Jarvis 설정 → **구독 CLI 실행기**에서 현재 회사/개인 영역과 프로젝트를 확인하고 실행기 `jarvis-runner.mjs`, 설정 `jarvis-runner.json`을 받는다. 설정에는 공개 앱 주소·공급자·명시적 영역/프로젝트 ID만 들어간다. 두 영역을 실행하려면 각각 확인한 scopes만 구성한다. 새 프로젝트는 설정을 다시 받아야 한다.
4. 두 파일이 있는 폴더에서 `node jarvis-runner.mjs --config jarvis-runner.json`을 실행한다. 처음 표시되는 12자리 **이 실행기의 기기 요청 번호**만 소유자가 기존 기기 관리 절차로 확인한다. Codex/GitHub 인증 파일·토큰은 공유하거나 Jarvis에 입력하지 않는다. 요청 번호는 인증 비밀이 아니다.
5. 승인 후 대기 요청을 가져오며 이후 15분 간격으로 원본 변경을 조회한다. 브라우저가 닫혀 있어도 실행기가 켜져 있으면 계속된다. Ctrl+C로 중단한다. PC 전원이 꺼지면 실행되지 않는다. 맥미니 자동 시작·미리보기는 아래 2.1 설치 절차를 사용한다.

GitHub 및 모델 로그인은 각 공식 CLI가 로컬에서 관리한다. Jarvis용 별도 기기 세션과 미전달 분석 결과만 사용자 홈 `.jarvis-runner/<앱주소해시>`에 디렉터리 0700·파일 0600으로 보관한다. 공급자 인증을 웹으로 복사하지 않고 외부에서 접속하는 로컬 HTTP 포트도 열지 않는다. 기기를 해제하면 접근이 차단된다. 설정 파일을 바꿔도 이미 승인된 기기의 기본 권한 체계를 확장하지 않는다.

## 조회 범위와 결과

- 등록한 저장소의 기본 브랜치 HEAD SHA를 고정해 파일 구조를 확인한다. 코드/문서 중 허용한 텍스트 파일을 우선순위에 따라 한 회 최대 24개, 저장한 확인 파일 최대 300개 범위에서 읽는다. 대형·비밀·고객/대화/업로드·빌드/의존성 파일은 제외한다. 미변경 blob SHA는 재다운로드하지 않는다. 전체 파일 실행·의존성 설치·테스트 실행은 하지 않는다.
- Issues/PR(각 최대 300), 커밋(20), HEAD checks(100)/statuses, 최근 배포(5)를 조회한다. 페이지·권한·GitHub tree 제한과 미확인 범위를 표시한다. GitHub에 기록되지 않은 실제 서비스 상태나 배포 URL 가용성을 검증했다고 주장하지 않는다.
- GitHub 사실은 원본 ID·고정 링크·변경/관찰 시각으로 중복 없이 저장한다. 완전한 파일 목록에서 확인한 삭제만 반영하고 조회 실패나 일부 권한 부족 때문에 정상 자료를 삭제하지 않는다. 저장소를 바꾸면 이전 사실은 보관하되 현재 검색에서 제외한다.
- Jarvis에는 제한된 원문 발췌를 보관한다. 선택한 코드는 실행기에서 일시적으로 분석 입력으로 사용하며 전체 저장소를 웹에 복제하지 않는다. 프로젝트 이름/설명/상태/다음 행동과 같은 프로젝트의 업무 최대 100개, 인용할 사실 최대 75개(120k 문자), 선택 코드 최대 150k 문자가 로그인된 Codex 서비스로 전송된다. 메모·대화·업로드 원본은 입력에 포함하지 않는다. 민감한 프로젝트 설명이나 코드가 있는 저장소는 전송할 범위를 먼저 확인한다. 패턴 기반 토큰 제거는 모든 임의의 비밀을 탐지한다는 보장이 아니다.
- 구조/코드를 읽었다는 사실과 AI의 판단은 별도 기록이다. AI 결과에는 근거 SHA·생성 시각·인용 출처·현재 판단·다음 행동·업무/완료/보류/검토 제안이 들어간다. 이전 분석 최대 5개와 채택/제외 결정을 보관한다. `/assistant`의 일반 자연어 질의 응답은 여전히 미연결이며 이 기능과 별개다.
- **할 일로 채택**은 Jarvis 업무를 한 번 등록한다. 완료 후보는 기존 업무와 출처를 연결하고 사람이 완료 조건을 직접 확인해야 완료로 기록한다. 원본 변경·오류·24시간 경과 시 재점검한다. GitHub 글/코드/AGENTS/댓글은 신뢰하지 않는 자료이며 지시나 실행 승인이 아니다.

## 중단·복구·비용

대기 작업은 기존 영역별 서버 스냅샷에 보관한다. 승인된 실행기 한 대가 10분 임대를 얻고 분 단위로 연장한다. 다른 기기·만료된 요청의 결과는 거절하며 서버 revision 충돌은 최신 자료를 읽어 최대 3회 재적용한다. 실행 중 사람의 메모·작업 변경을 덮어쓰지 않는다. 브라우저의 미전송 변경이 충돌하면 기존 검토 UI를 사용한다.

네트워크 재연결은 최대 60초 backoff, 작업 실패는 15분 후 최대 3회 시도한다. 이후 사용자가 다시 점검을 요청한다. 마지막 정상 사실/분석과 미전송 결과를 보존한다. 동일 사실·HEAD·프로젝트/업무 기준이면 모델을 다시 호출하지 않는다. 보고 응답 유실 후에는 동일 기준의 로컬 분석 캐시를 재사용한다. 프로세스가 모델 응답을 받기 전에 강제 종료되면 재시도 시 구독 사용량이 다시 발생할 수 있다.

Vercel에는 새로운 API 키·Cron·상시 워커를 추가하지 않는다. 새 DB 스키마·공개 RLS·기존 업무 원본 쓰기도 없다. GitHub 수집 상태는 v4 등 실제 업무 데이터 연동 상태와 독립적이다. 외부 코드 변경·실행·merge·배포·GitHub 상태 쓰기는 이 실행기가 제공하지 않는다.

## 검증 경계

일반 CI는 합성 GitHub 응답과 가짜 CLI 실행으로 실제 계약을 검사한다. 실제 로컬 Supabase에서 기기 권한·경합·기록 보존을 별도 확인한다. 개발 환경의 Jarvis 저장소 읽기를 실제 GitHub 전송 확인에 사용하며 사용자의 등록 저장소/구독 로그인/실제 모델 실행을 대신 검증했다고 주장하지 않는다. 사용자 컴퓨터에서 최초 로그인·기기 연결 후 실제 구독 분석을 확인해야 한다.

공식 근거: [Codex 인증](https://developers.openai.com/codex/auth/), [비대화형 실행](https://developers.openai.com/codex/noninteractive/), [GitHub tree 제한](https://docs.github.com/en/rest/git/trees?apiVersion=2022-11-28).

## 실행기 2.0: 프로젝트 대화에서 수정·반영 (Issue #15)

앞의 읽기 전용 설명은 정기 점검에 적용한다. 사용자가 프로젝트 AI 작업실에서 보낸 **수정 요청**은 별도 실행 계약으로 처리한다. 이미 1.0 실행기를 실행 중이라면 설정에서 새 `jarvis-runner.mjs`를 받고 같은 설정 파일로 재시작한다. 새 인증 키는 필요하지 않으며 기존 Jarvis 기기 상태를 재사용한다. 1.0 실행기는 새 작업을 가져가지 않는다.

### 자동 발견과 대화

`gh`의 저장소 homepage, 성공한 deployment status의 environment_url, built Pages html_url, 읽은 README의 명시적인 demo/website 링크를 사용한다. HTTPS, 공개 도메인, 인증값 없는 주소만 허용하고 출처/조회 시각을 저장한다. 홈페이지 → 운영 배포 → Pages → README → 기타 배포 순서로 표시한다. 새로운 서비스 인증을 자동으로 만들어내지는 않는다. 파일 읽기 한도 때문에 README 주소가 뒤늦게 발견될 수 있다. 주소 없음은 임의 추측으로 채우지 않는다.

요청은 `Project.automation.turns`에 보관한다. 사용자 요청, 명시적 저장소/영역/프로젝트, 질문/수정, PR/병합 범위를 고정한다. 서버 claim/report는 기존 기기 인증과 CAS 저장을 사용한다. 새 DB 테이블/인증 정책은 없다. 10분 임대, 30초 실행 heartbeat, 새로운 claim마다 토큰을 사용한다. 기기·저장소·토큰이 바뀌거나 취소되면 늦은 결과를 거부한다. 만료된 쓰기 요청은 자동 재실행하지 않고 `이어서 실행`으로 확인한다. 백업 복원도 기존 실행 승인을 재생하지 않고 멈춘 기록으로 보관한다.

### 코드 실행과 검증

- PC의 사용자 gh/Codex 로그인으로 선택 저장소만 접근한다. Codex는 ChatGPT 로그인만 허용하며 API 키로 자동 전환하지 않는다. GitHub 쓰기 권한은 PR/선택적 병합에 필요하다.
- 요청마다 사용자 작업 폴더와 분리된 private checkout/작업 기록을 만든다. 로컬 폴더와 사용자 미커밋 변경을 덮어쓰지 않는다. `.env`, 인증/고객/업로드/대화 자료, symlink, 숨김/agent/CI 정책 파일은 모델의 작업 파일에서 제외하고 원래대로 보존한다. `.git`의 쓰기는 모델 sandbox 보호를 따르며 커밋/푸시는 runner가 수행한다.
- 일반 npm 레지스트리의 package-lock이 있으면 `npm ci --ignore-scripts`로 의존성을 준비한다. 사용자 npm 설정/토큰을 전달하지 않는다. 다른 설치 체계·사설 의존성은 자동 설치하지 않으므로 검증이 제한될 수 있다. 프로젝트 설치 스크립트는 자동 실행하지 않는다.
- 공식 `codex exec --sandbox workspace-write`(질문은 read-only), ephemeral, ignore-user-config/rules, project_doc_max_bytes=0, 네트워크 차단, 환경 상속 제한을 사용한다. 저장소 본문은 새 지시/승인이 아니다. 모델의 외부 GitHub/배포/DB/인증/보호 정책 변경은 허용하지 않는다. 모델이 완료하지 못하면 blocked로 분류한다.
- 파일 변경·비밀값 패턴·실제 `git diff --check`를 확인하고 요청별 `jarvis/work-UUID` 브랜치와 PR을 만든다. 공개 PR에는 비공개 요청 원문·대화·개인 맥락을 게시하지 않고 요청 식별자, 변경 파일, 검증 안내를 남긴다.
- 검사 결과는 GitHub check-runs/statuses에서 대상 HEAD SHA로 조회한다. 실패/미완료/검사 없음이면 자동 병합하지 않는다. 최대 30분 동안 CI를 기다리며 검사 자체가 나타나지 않으면 약 1분 후 검토로 돌린다. 모델의 답변을 검사 성공으로 사용하지 않는다.
- `merge` 요청만 일반 GitHub merge API로 해당 HEAD SHA와 기본 브랜치를 다시 확인해 병합한다. 기본 브랜치가 도중에 바뀌면 검토로 남긴다. 보호 규칙 우회, admin merge, force push는 없다. CI 설정을 새로 만들거나 임의 배포 명령/유료 서비스를 실행하지 않는다.
- 병합 후 기존 자동 배포를 기다린다. 병합 SHA의 production 배포 성공과 URL을 확인한 경우만 `배포 확인 완료`다. GitHub에 배포가 기록되지 않거나 5분 내 성공이 확인되지 않으면 병합 상태와 배포 확인 업무를 남긴다.
- 사용자 PC의 작업 기록으로 모델 결과/커밋/PR 전달을 복구한다. 응답 재전송이 새 수정/새 PR/중복 업무를 만들지 않는다. 중단 시 결과가 없는 모델 실행은 명시적 재시도에서만 이어간다. 작업 기록은 `~/.jarvis-runner/<origin>/work-*`에 보존되므로 완료 후 필요에 따라 정리한다.

### 자동 정리와 한계

AI 답변/요약과 runner가 관찰한 변경·검사·PR·배포를 구분한다. 후속 업무/확인 항목은 같은 프로젝트의 Jarvis 업무로 자동 등록하며 동일 제목을 중복 추가하지 않는다. 정기 분석의 미완료 자동 제안 자체는 추가 모델 호출을 유발하지 않도록 기준 해시에서 제외한다. 사용자가 완료한 업무는 다음 분석 기준에 반영한다. 기존 수기 목표와 상태 원문은 보존한다.

CLI가 로컬 코드를 보고 수정하는 기능이며 실제 웹 브라우저의 로그인 세션/화면을 자동 관찰하는 기능은 아니다. 실행기 2.0의 공식 CLI 인자/격리/재시도 및 GitHub 계약은 합성 응답과 실제 임시 Git 저장소로 검증한다. 실제 사용자 구독 모델 호출과 사용자 프로젝트 코드는 테스트에 사용하지 않는다.

### 실행기 2.0.1 — 의존성 준비 오류 수정 (Issue #19)

2.0.0은 npm의 사용자·전역 설정을 모두 `/dev/null`로 지정해 npm 11에서 `double-loading config`로 종료됐다. 외부 의존성이 없는 package-lock에서도 설치 전 실패하므로 이 결과는 CLI 미연결을 뜻하지 않는다. 2.0.1은 요청별 private 작업 폴더에 서로 다른 빈 설정 파일을 사용하고 `--ignore-scripts`, 사용자 설정/토큰 제외를 유지한다. 실패 시 알려진 오류 종류/종료 코드만 보고하고, 실제 준비 검사 결과를 모델에게 전달한다. 원본 npm 로그·기기 경로·인증값은 서버나 모델에 보내지 않는다.

Mac에서 실행 중인 runner를 `Ctrl+C`로 종료한 후 Jarvis 설정에서 실행기 파일을 다시 내려받아 기존 `jarvis-runner.mjs`를 교체한다. 기존 `jarvis-runner.json`과 `~/.jarvis-runner`는 유지하고 같은 폴더에서 `node jarvis-runner.mjs --config jarvis-runner.json`으로 재시작한다. 시작 로그의 버전은 2.0.1이다. 기존 기기 승인은 재사용하므로 새 번호를 만들 필요가 없다.

### 실행기 2.1 — 맥미니 자동 실행·화면 준비 (Issue #23)

기획과 실제 설정은 [맥미니 웹 작업 흐름](../PROJECT-WEB-WORKFLOW.md)을 따른다. 설정의 **맥미니 자동 실행·미리보기 설치**에서 설치 파일과 현재 범위 설정을 받아 Mac에서 `node jarvis-mac.mjs install --config jarvis-runner.json`을 실행한다. Node 24+, gh 로그인, Codex ChatGPT 로그인, Docker 엔진을 검사하고 배포된 runner/preview 파일을 SHA-256 manifest와 대조한다. 모든 파일을 확인한 뒤 LaunchAgent를 교체하며 등록 실패는 이전 설정으로 복구한다. 설치기는 기존 기본 위치의 기기 승인/저널을 재사용하고 `preview.enabled`를 켠다. 일반 단일 실행기 다운로드는 미리보기를 자동 활성화하지 않는다.

`화면 준비`는 모델 호출 없이 현재 기본 브랜치의 배포 또는 격리된 임시 화면을 확인한다. 수정 요청 뒤에도 해당 커밋의 화면 결과를 붙인다. 오래된 실행기는 preview 작업을 가져가지 않는다. 서버는 SHA·URL 종류·만료·영역·기기/임대를 검증하고 코드 작업 실패와 미리보기 실패를 독립적으로 보존한다. 루프백 링크는 실행한 Mac에서만 유효하고 2시간 후 만료한다. 별도 데이터·비밀 설정·실제 AI 연동이 필요한 앱은 이를 준비하지 않으며 운영 배포 완료로 처리하지 않는다. 기존 성공 배포 주소는 다른 기기에서도 사용할 수 있다.

런타임 파일 변경 후 `npm run runtime:manifest`로 해시를 갱신한다. 일반 CI는 배포 manifest와 파일 일치 여부를 검사한다. `npm run test:preview`는 실제 Docker/Chromium에서 합성 SQLite 앱과 연결·격리를 검사한다. 실제 사용자 Mac 설치와 구독 호출은 최초 사용 시 별도로 확인해야 한다.

이미 결과가 저장된 요청은 업데이트만으로 재실행하거나 성공으로 바꾸지 않는다. 사용자가 새 프로젝트 요청을 보내 새 검사 결과를 받아야 한다. 의존성 준비 성공과 대상 앱 CLI 통합·계정 호출·CI·병합·배포 완료는 각각 실제 결과로 확인한다. 이번 수정이 대상 앱의 미완료 연동을 대신 구현하지는 않는다.


### Remote checks and selected revisions (2.4.0)

Use the project's **테스트 실행** for supported repository checks and **화면 준비** for interactive HTTP preview. Both actions run on the registered execution server. An unmerged recent change is selectable as the source; subsequent edits reuse its PR. The runner revalidates that PR and commit before using it, and does not silently substitute main for a changed/closed PR. Already merged PRs resolve to current main. Old runners skip test/source-aware requests until updated with the existing scope-preserving installer.

Checks use a sanitized local Docker image and public locked npm dependencies with installation hooks disabled. Execution has no external network, host mounts or provider credentials. npm test/lint/typecheck (or check when those are absent), then Node test-file discovery are supported. Missing prerequisites/zero tests remain not-run; real exit failures remain failures. These checks do not establish external AI/provider/microphone functionality. A project's missing GitHub CI still prevents automatic merge. No CI workflow or authentication change is inferred from a test request.

### Mac update entrypoint repair (2.4.1)

Installers downloaded into macOS `/tmp` could exit successfully without running: Node canonicalizes the ESM URL to `/private/tmp`, while the old main-entry check compared it with the literal argument path. Both installer and runner now compare filesystem real paths. Download success is not installation success; verify the versioned LaunchAgent registration message and the next project runner observation. Re-download the installer before `node jarvis-mac.mjs update`; existing scopes and device approval are preserved. Already queued requests remain eligible after a compatible runner reconnects and do not need resubmission.

Claim observations record the reported version (unknown for older clients) and actual capability flags. The old server-generated `2.0.0` value was not evidence of the installed version. Connected but incompatible runners now show an update requirement; preview-disabled, unknown-capability and disconnected states have separate waiting messages. Admission remains capability-based so correctly installed 2.4.0 clients keep working without reporting a version.

### Remote startup diagnostics (2.4.2)

Installer registration, runner contact, local app health and public remote readiness are separate observations. A failed remote preparation now records a stage and symbolic reason in **연결 진단**, with HTTP or process exit status where available. Updating alone is not proof that the provider connection or the app works. Existing generic failures have no recoverable detailed cause; their records remain intact without a false legacy-address instruction.

The official tunnel client selects QUIC with HTTP2 fallback; the runner waits for edge registration and then checks public gateway identity, with bounded retry/deadlines and cancellation cleanup. The optional `verify-live-preview` PR label (or workflow dispatch) runs real provider verification on synthetic Linux/macOS fixtures. It never uses user records, provider logins, production APIs or model calls. Routine CI continues to mock the external transport.

### Standalone Node apps (2.4.3)

Without package.json, a root server.js, server.mjs or server.cjs now starts with Node before any static HTML fallback. The app must honor PORT/HOST and use Node built-ins or its tracked local modules. Its sanitized source runs from bounded temporary storage so app-local config/record initialization works without writing to the original checkout. Existing stored records, credentials and host model services are not copied. Public HTML alone still uses static serving; npm projects keep their declared scripts and public-lockfile requirements. After updating, prepare a new screen to replace an already completed static preview.

### Preview reuse verification (2.4.4)

Retries reuse a preview only when its request, commit and installed preview-runtime hash match. An older or missing runtime identity forces a fresh owned container so an outdated static-only recipe cannot survive an update. Docker/browser CI now exercises the standalone server through authenticated HTTPS and API initialization, temporary write/reload and access revocation in one path. Screen readiness is not a real AI/model validation; the result states that limitation directly.
