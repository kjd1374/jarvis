# 회귀·저장·연결 검증

Node 24 / npm 11, Playwright 1.64.0. 클라우드에서는 먼저 `source /workspace/.setup/jarvis-env.sh`를 적용한다. 일반 PC/CI에는 이 파일이 필요 없다.

## 실행 명령

```sh
npm ci
npx playwright install chromium
# Linux 브라우저 라이브러리 필요 시: npx playwright install --with-deps chromium
npm run check          # ESLint, TypeScript, Next 16.4.0 production build
npm run test:domain    # 합성 수집·검색·검증·이관 도메인 6건, 서버 불필요
npm run test:e2e       # desktop 11 + Pixel 7 에뮬레이션 11건
npm run test:storage   # 실제 브라우저 IndexedDB/파일 저장·백업 8건
npm run test:all       # UI+저장 30건을 한 임시 서버에서 실행
npm run test:deploy    # 배포 대상·비밀값 제외·운영 보호 합성 검증 4건
```

4317 포트를 테스트 전용으로 사용한다. 기존 서버를 재사용하지 않으며, 소스만 복사한 임시 앱을 webpack으로 빌드한 뒤 종료 시 정리한다. `npm run check`는 원래 Turbopack 빌드도 유지한다. 별도 포트를 사용하는 개발 서버를 켤 필요가 없다. `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`로 Chromium을 지정할 수 있으나 기본/CI는 Playwright에 맞는 버전이다.

실제 서버 저장은 **별도 로컬 Supabase**에서 검증한다.

```sh
npm run db:start       # Docker 필요, 원격 DB/키 사용 금지
npm run test:server    # localhost 엄격 검사 → 로컬 마이그레이션 → 합성 사용자 → 실제 Auth/RLS/RPC/브라우저
npm run db:stop        # 직접 시작한 로컬 스택만 종료
```

`test:server`는 `http://127.0.0.1:54321`과 `supabase_db_jarvis`만 사용한다. 테스트가 만든 임시 사용자만 삭제하고 기존 로컬 데이터를 reset하지 않는다. 로컬 CLI 키는 프로세스 내부에서 읽고 출력하지 않는다. 운영 자격 증명은 자식 앱에 전달하지 않는다. 다른 테스트와 4317 포트를 동시에 사용하지 않는다.

## 일반 CI: 합성 자료와 격리

| 검증 | 범위 |
| --- | --- |
| UI/모바일 | 6개 메뉴·현재 위치·검색/없음/단축키, 320·390·760·1024·1440px, 모바일 메뉴/대화 패널, 홈과 상세 |
| 로딩·오류·입력 | 로딩을 빈 화면과 구분, 저장/읽기 실패 재시도와 입력 보존, 긴 한국어·IME·줄바꿈, 저장 중 중복 제출 방지 |
| 프로젝트·업무 | 생성/수정/새로고침, 다른 프로젝트·회사/개인 분리, 명시적 상세→대화→복귀 |
| 서비스·요청 | 프로젝트별 등록/웹 열기(실제 로컬 HTTP 주소), 바로가기 표시, 요청 등록 ≠ 실행, 증거/확인 없는 완료 거부, 사용자 검증 표시 |
| 수집·근거 | 완전/부분 수집, 중복·수정·삭제·재연결·오래된 응답, 마지막 정상 결과 보존, 사실/메모 구분·원본 링크·시각·오류 표시, 범위 밖 검색 차단 |
| 파일·이관 | 실제 파일 bytes, 원자적 저장 실패 롤백, 탭 동시 저장, 원본 링크 미복제, 원본 포함 백업→빈 프로필 복원, 확인 전 미반영·재가져오기 중복 없음·내용/파일 충돌 보존 |

일반 테스트의 앱은 `.env*`, `.vercel`, 기존 대화·업로드·프로필을 복사하지 않으며 Supabase public 변수와 서버 활성화를 상속하지 않는다. 외부 HTTP 요청은 테스트 실패로 처리하고 서비스 워커도 차단한다. 각 테스트는 새 비영구 프로필/합성 자료만 사용한다. IndexedDB와 파일 보관 성공은 모킹하지 않는다. 대기/오류 테스트에서만 IDB 실패·잠금을 주입한다. 수집 응답은 합성 fixture이며 v4 실제 호출이 아니다.

실제 AI 모델은 미연결이다. 성공 답변을 가장하는 mock endpoint나 운영 예시 답변을 만들지 않는다. 검색 결과와 501 연결 필요, 실행 권한 false를 검증한다. 향후 모델 계약이 생기면 해당 응답을 모킹하고 외부 차단을 유지한다. 운영 DB·고객 자료·유료 모델 호출에 의존하지 않는다.

## 별도 실제 로컬 서버 검증

`test:server`는 실제 로컬 Auth/RLS/RPC/서버 Route Handler를 사용한다. 같은 계정의 두 로그인 세션과 다른 계정, 별도 브라우저 프로필을 사용해 다음을 확인한다.

- 인증/명시적 영역 요구, 익명 RLS 거부, 서버 저장/다른 세션 복원.
- 다른 계정·다른 영역의 자료 차단, 혼합 영역 저장 거부.
- revision 충돌 409로 오래된 기기의 덮어쓰기 방지.
- v4 미연결 상태와 마지막 정상 합성 자료 보존.
- 서버 근거 검색·최신성·501 AI 미연결, 개인 자료 미전달.
- 설정의 검토→병합→서버 저장을 통해 새 메모를 다른 세션에서 실제 조회.

이것은 **로컬 DB 실검증 + 합성 업무 자료**다. v4/유료 모델/운영 연동 검증과 구분한다. 물리적 두 기기 검증은 아니다. 로컬 slim stack에 storage-api가 없어 사설 서버 파일 업로드·다운로드는 이번에 실행하지 못했다. 브라우저 원본·백업 이관은 위 storage suite에서 검증한다. 운영 앱 계정·서버 저장 활성화, 실제 기기, 사설 서버 파일 전송은 별도 연결/검증 대상이다.

## 실패 화면·로그 확인

```sh
npm run test:report
npx playwright show-trace 'test-results/artifacts/<실패한 테스트>/trace.zip'
npm run test:e2e -- --grep '프로젝트에 서비스'
npm run test:storage -- --grep '원본 포함 백업'
```

- `playwright-report/index.html`: 단계·결과와 `browser.log` 첨부.
- `test-results/artifacts/`: 실패 PNG·WebM·trace.zip·error-context.md. 대표 정상 화면도 테스트별 디렉터리에 저장한다.
- `test-results/server.log`: 임시 앱 빌드·서버 로그.
- `test-results/server-storage.log`, `device-a.png`, `device-b.png`, `other-owner.png`: 별도 로컬 서버 검증 로그와 프로필별 화면.
- GitHub Actions의 `playwright-e2e` / `playwright-storage` / `local-server-storage` artifact, 7일 보관. workflow의 원격 실행은 push 금지에 따라 미실행이다.

자동 재시도는 0이다. 원인을 고친 뒤 필요한 흐름을 다시 검사한다. 산출물은 합성 자료만 포함하며 Git에서 제외한다. 실제 휴대폰·Safari/Firefox는 검증하지 않았다.

## 이번 검증 기록 (통합 업무실)

기존 프로젝트 상세 단계의 21건을 유지하고 홈/검색 이동 경로를 갱신했다. 신규 통합 흐름에서 폼 선택 항목의 접근성 이름을 명확히 했고, 화면 이동 완료 전 주소를 읽던 테스트의 대기를 수정했다. 해당 desktop/mobile 2건은 수정 후 통과했다.

최종 검증 결과와 한계는 아래와 같다. 이 작업의 운영 배포·push·merge·운영 DB/인증/환경 변경은 하지 않았다.

- 2026-10-14 `npm run check` 최종 통과: ESLint 경고/오류 없음, TypeScript, Next 16.4.0 Turbopack production build.
- `npm run test:domain` **6/6 통과**, `npm run test:all` **28/28 통과**(desktop 10 / mobile 10 / storage 8), 합계 **34건**. 자동 재시도·skip 없음.
- 화면 캡처에서 긴 메모가 홈을 과하게 늘리는 것을 확인해 접기/펼치기를 추가했다. 최근 메모가 많아도 수집 결과가 최근 결과 목록에서 밀려 사라지지 않도록 사실 종류를 먼저 필터링했다. 수정 후 domain **6/6**, 관련 desktop/mobile **6/6**, `npm run check`를 재실행해 통과했다.
- `npm run test:server` 별도 실제 로컬 Supabase 검증 통과: Auth/RLS·같은 계정의 두 세션/브라우저 복원·다른 계정/영역 격리·혼합 저장 거부·revision 충돌·설정 UI의 실제 서버 저장과 다른 세션 조회. 합성 업무 데이터만 사용하고 임시 사용자/자료를 정리했다.
- v4 상태/원본 보존 테스트는 합성 수집 결과를 사용했다. **실제 v4 호출 0, 운영 DB 호출 0, 유료 모델 호출 0**. 미연결 모델 API는 501이며 실제 답변을 생성하지 않는다.
- `test-results/review/home-desktop.png`, `home-mobile.png`, `scoped-evidence.png`는 **합성 테스트 자료**로 만든 화면이다. 홈·프로젝트·검색·요청 흐름과 320px 가로 넘침을 확인했다.
- 미실행: 두 물리 기기(환경에 실제 장비 없음), Safari/Firefox(현재 Chromium 범위), 사설 서버 파일 원본 API(로컬 slim 스택의 storage-api 제외), v4 실제 연동(API/인증 계약 없음), AI 실제 응답(모델·전송 범위 미결정), 운영 저장(인증/활성화 별도 승인 필요), 원격 Actions(push 금지). 브라우저 파일·백업 복원은 실행했다.
- 이번 변경을 배포하거나 push·merge하지 않았으며 운영 설정·인증·데이터를 변경하지 않았다. 기존 배포 URL은 이 변경을 포함하지 않는다.

### 배포 문제 수정 검증

사용자의 후속 배포 수정 요청에 따라 `npm run test:deploy`의 합성 단위 검증 4건(업로드 범위/비밀값 제외·현재 소스 포함·소스 링크 거부·프로덕션/다른 프로젝트 보호)이 통과했다. `npm run check`도 통과했다. 앱 UI/저장 로직은 이번 진단에서 변경하지 않아 기존 34건을 반복 실행하지 않았다. 실제 Vercel 미리보기 빌드는 READY로 완료했고 고정 주소의 대상 ID·소스 해시를 확인한다. 배포 상세와 로그인 보호에 따른 검증 범위는 `DEPLOYMENT.md`에 기록한다. 이번 후속 요청은 미리보기 배포만 수행하며 production·push·merge·운영 데이터/인증 변경은 하지 않는다.

### 2026-10-15 연결 준비 업데이트

- 신규 경로가 없는 상태에서 desktop/mobile 실패를 재현한 후 구현했다.
- `npm run check`: lint·타입 검사·Turbopack production build 통과.
- `npm run test:all`: **30/30 통과**(desktop 11 / mobile 11 / 실제 IndexedDB·파일 storage 8), `npm run test:domain`: **6/6**, `npm run test:deploy`: **4/4**. 재시도·skip 없음.
- 신규 흐름은 홈→설정 연결 준비→v4 기본 주소/저장소 확인→중복 등록 거부→GitHub/시트 주소 등록→새로고침 유지→미연결 상태/진척 기준 확인→320px 가로 넘침 없음→개인 전환 시 회사 주소 미노출을 검증한다. 임시 앱과 합성 기록만 사용하며 등록 주소로 외부 요청하지 않는다. v4 기본값은 사용자 제공 주소와 일치하는지만 확인한다.
- `test-results/artifacts/workroom-*/connection-setup*.png`에서 화면을 확인한다. 브라우저 오류·외부 호출은 fixture가 실패로 처리한다.
- 화면 캡처의 포커스를 정리하고 desktop/mobile 레이아웃을 남긴 뒤 관련 2건을 다시 실행해 통과했다. 제품 코드는 40건 검증 이후 변경하지 않았다.
- 이번 변경은 서버/API/인증/마이그레이션을 수정하지 않아 별도 `test:server`를 반복하지 않았다. 기존 실제 로컬 Supabase 검증 결과는 위 기록이며, 이번 40건은 실제 v4/GitHub/시트 연동 검증이 아니다. 실제 두 기기·AI·Google 인증/읽기/쓰기·v4 조회·GitHub 자동 수집은 미연결/미검증이다.
- 현재 소스를 Vercel에 배포하지 않았다. 기존 보호된 미리보기 URL에 이번 연결 준비 UI가 반영됐다고 주장하지 않는다. GitHub push가 자동 배포를 유발하는 설정임을 읽기 조회로 확인했으며 이전 배포 유발 push 금지 조건을 유지한다. 운영 설정·인증·데이터는 변경하지 않는다.

### 승인 후 GitHub CI 첫 실행

2026-10-15 사용자의 작업 브랜치 push/미리보기 승인으로 PR #2와 원격 CI를 실행했다. 첫 실행 `38660227527`에서 `check`, storage suite, 일회용 로컬 Supabase의 실제 server-storage 검증은 통과했고, e2e의 프로젝트 저장 흐름에서 저장 요청 직후 새로고침해 요청이 없는 실패를 발견했다. 실패 trace와 실제 IndexedDB 조회를 확인한 결과 테스트가 비동기 저장 완료 전에 이동/새로고침했다. 업무 저장 뒤 이동과 요청 저장 뒤 새로고침을 **저장 성공 후 닫히는 dialog**로 대기하도록 수정했다. 재시도나 임의 지연으로 덮지 않으며 저장 구현을 모킹하지 않는다. 수정 후 해당 desktop/mobile 흐름을 각 3회, 합계 6회 실행해 모두 통과했고 lint·타입 검사를 통과했다. 앱 런타임 코드는 변경하지 않았다. 최종 원격 결과는 PR/Issue에 SHA와 함께 기록한다.

### 2026-10-15 프로젝트 저장 보존 수정 (Issue #4)

- 변경 전 프로젝트 읽기 오류 테스트가 빈 목록 표시 때문에 실패하는 것을 확인했다. 사용자 환경의 실제 기록 소실 자체는 재현하지 못했다.
- `npm run check`: lint·타입 검사·Next 16.4.0 production build 통과.
- `npm run test:all`: **42/42 통과**(desktop 14 / mobile 14 / 실제 IndexedDB·파일 storage 14). `npm run test:domain` **6/6**, `npm run test:deploy` **4/4**. 자동 재시도·skip 없음.
- 신규 검증: 읽기 실패와 정상 빈 목록 구분/재시도, 저장 진단의 비변경·320px 화면, 구버전 v1 정상본 없는 기록 보존, 개인 프로젝트의 브라우저 프로세스 종료/재시작 후 유지, 현재 값 누락/손상 시 확인 후 복구와 원본 바이트 보존, 정상본 쓰기 실패의 전체 롤백/재시도, 복구 직전 정상 기록을 다른 탭이 저장한 경우 덮어쓰기 거부.
- `npm run test:server`: 별도 로컬 Supabase의 실제 Auth/RLS/API/UI 검증 통과. 같은 계정의 두 세션·별도 프로필 저장/복원, 다른 계정/영역 분리, revision 충돌 확인. 합성 사용자/자료만 사용하고 정리했다. 운영 DB·유료 모델·실제 v4/시트 호출 0.
- 운영 주소의 수정 전 별도 합성 프로필에서는 프로젝트 생성→화면 이동→새로고침 3회→브라우저 재시작이 통과했다. 이는 사용자 브라우저의 원인 확인이나 기존 번역 기록 복구 증거가 아니다.
- 진단 화면: `test-results/artifacts/ui-저장-진단*/storage-diagnostics.png`. 실패 로그/trace는 위의 기존 경로와 `npm run test:report`로 확인한다. 재시작 테스트의 임시 브라우저 프로필은 `/tmp`에만 생성하고 종료 후 삭제하며 Git/artifact에 포함하지 않는다.
- 미검증: 사용자의 실제 브라우저 저장 공간·소실 원인·기존 번역 기록 복구, 물리 기기 2대, Safari/Firefox, 운영 서버 저장/인증, 서버 파일 API(storage-api 없는 로컬 slim 스택), 실제 외부 연동. GitHub CI와 정식 배포 결과는 해당 PR/Issue #4에서 SHA와 함께 별도로 기록한다.

### 2026-10-15 로그인 없는 기기 연결·서버 자동 보관 (Issue #6)

- 사용자 정정에 따라 이메일/로그인/가입 UI는 제외했다. 합성 테스트는 실제 구현한 기기 상태/서버 API 계약을 모킹하고 외부 네트워크·운영 DB·유료 AI를 사용하지 않는다.
- `npm run test:all` **52/52 통과**(desktop 19 / mobile 19 / 기존 실제 IndexedDB storage 14). 기존 v1 기록/파일/백업/복구/브라우저 재시작 검증을 유지했다. 새 10건은 미등록 기기 차단, 서버 자동 저장과 영역 분리, 실패 후 새로고침/재시도, 응답 유실 중복 방지, 충돌 확인/병합과 명시적 레거시 이관을 검증한다.
- `npm run test:domain` **6/6**, `npm run test:deploy` **4/4**, `npm run test:devices` **4/4** 통과. 기기 관리 검증은 실제 관리 API를 호출하지 않고 잘못된 대상/인자/무자격 요청·SQL 삽입·불일치 승인을 차단하는지 확인한다.
- `npm run check`: lint/TypeScript/production build 통과. 새 의존성 없음.
- 별도 `npm run test:server`: 실제 로컬 Supabase에서 기기 세션/승인 목록/RLS/자동 저장/회사·개인 분리/revision 충돌, 실제 사설 원본 업로드·동일 원본 재시도·다른 원본 덮어쓰기 거부·새 브라우저 다운로드, 연결 해제 즉시 차단, 기존 HttpOnly 쿠키를 가진 새 빈 캐시의 자동 복원을 검증했다. 테스트용 storage-api를 포함하도록 로컬 시작 명령을 보강했다. 운영 호출·실제 v4/시트·유료 모델 0, 물리 기기 2대/Safari/Firefox는 미검증이다.
- 실제 브라우저 등록 첫 시도에서 Origin 검사 실패를 재현했다. 프록시 내부 URL로 추정하는 대신 `JARVIS_APP_ORIGIN`의 명시적 정식 주소로 검사하도록 고친 뒤 실제 등록/파일/해제 검증이 통과했다. 기기 생성/해제는 위조한 Authorization 헤더가 있어도 브라우저 Origin 검증을 생략하지 않는다.
- 서버 테스트는 임시 세션/원본/업무 행만 정리한다. 쿠키/토큰을 화면·로그·Git/artifact에 저장하지 않는다. 복원용 cookie state는 메모리에만 보관한다. 실패 시 `test-results/device-registration-failure.png`와 합성 화면/기기 상태를 기록하며, 일반 실패 trace·browser.log 위치는 기존 안내와 같다.
- 운영 스키마 적용·익명 기기 세션 설정·정식 배포·실제 사용자 기기 확인 결과는 해당 PR/Issue #6에 별도로 기록한다. 로컬 검증 결과만으로 운영 사용자 기록 저장이 완료됐다고 주장하지 않는다. 과거 프로젝트 소실 원인과 복구는 Issue #4에서 계속 구분한다.

### 2026-10-15 큰 파일 전송과 운영 활성화 확인

- 별도 실제 로컬 Supabase `npm run test:server` **12개 검증 그룹 통과**. 기존 10개에 6 MB 직접 업로드/다운로드와 실제 브라우저 직접 업로드를 추가했다. 함수 요청 본문이 4 MB 미만임을 확인하고, 다른 기기에서 내려받은 원본 바이트 일치·SHA-256 검증·다른 바이트 덮어쓰기 거부·영역/미등록 기기 차단을 검증했다. 브라우저 localStorage에 인증 토큰이 없고 업무 메타데이터에도 임시 전송 권한이 없음을 확인했다. 운영 데이터/유료 모델 호출은 0이다.
- 업로드 테스트의 초기 실패는 숨은 input이 활성화된 UI 준비 상태를 나타내지 않는데 파일을 먼저 넣은 테스트 순서 문제였다. 실제 `자료 추가` 버튼이 활성화될 때까지 대기하도록 수정했다. 임의 지연·테스트 재시도·성공 응답 모킹을 추가하지 않았다. 로컬 서버 검증과 일반 브라우저 검증은 같은 4317 포트를 사용하므로 **순서대로 실행**한다. 병렬 실행 시 확인된 EADDRINUSE 결과를 제품 회귀로 분류하지 않는다.
- 파일 검증 실패 시 `test-results/large-transfer-failure.png`, 서버 로그 및 쿼리 문자열을 제외한 전송 상태를 확인한다. 임시 권한/쿠키/원본 파일은 CI artifact에 저장하지 않는다.
- PR #7 및 main CI(38679641672/38680106646)의 4개 작업이 모두 통과했다. main `79479e8064c74f2e4b901c5953b62ba13e6ccb03`의 운영 배포에서 health·미등록 기기 데이터 접근 거부·이메일/로그인 입력 부재·HttpOnly/Secure/Lax 쿠키·320px 화면을 별도 합성 프로필로 확인했다. 합성 요청은 해제했으며 운영 업무 행은 쓰지 않았다. 운영 사용자 기기 등록과 실제 사용자 기록 저장·물리 기기 2대는 아직 확인하지 않았다. 과거 번역 프로젝트 복구도 확인되지 않았다.

- 최종 파일 전송 수정 상태에서 `npm run check`와 일반 회귀 `npm run test:all` **52/52**, domain **6/6**, deploy **4/4**, devices **4/4**가 통과했다. 일반 회귀는 실제 로컬 서버 검증 종료 후 순차 실행했다.
