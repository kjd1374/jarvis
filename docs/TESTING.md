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
