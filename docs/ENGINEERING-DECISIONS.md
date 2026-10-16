# 개발 선택 기록

## 2026-10-14: 회귀 테스트와 업무실 상태 개선

기존 Next.js 16.4.0 / React 19.3.0 / Node 24 환경, CSS Modules·native dialog,
IndexedDB 트랜잭션과 기존 임시 Chromium 검증 스크립트를 먼저 확인했다.
임시 스크립트의 사용자 흐름을 저장소의 독립된 Playwright 테스트로 옮긴다.
새 업무 기능, 서버 저장, 실제 AI 응답은 추가하지 않는다.

| 공식 후보 / 확인 버전 | 출처·유지보수·호환성 | 비용·정보 전송 | 선택과 직접 구현 대비 이익 |
| --- | --- | --- | --- |
| [microsoft/playwright](https://github.com/microsoft/playwright) / `@playwright/test` 1.64.0 | Apache-2.0, 공식 저장소 archived 아님, 2026-10-13 갱신. Node ≥20, 현재 Node 24와 호환 | 무료 OSS, 로컬 브라우저 실행. 패키지·브라우저 다운로드만 외부 연결; 합성 데이터와 로그만 사용 | **채택**, 정확한 버전 고정. 직접 만든 단일 smoke 스크립트보다 테스트 격리·자동 대기·모바일 에뮬레이션·실패 trace·CI 보고서 관리에 이익 |
| [testing-library/react-testing-library](https://github.com/testing-library/react-testing-library) / 16.3.3 | MIT, archived 아님, 2026-08-27 갱신. React 18/19 지원, DOM 테스트 환경 추가 필요 | 무료 OSS, 로컬 실행 자체로 업무 데이터 전송 없음 | **보류**. 현재 우선순위인 메뉴·파일 다운로드·실제 IndexedDB·여러 탭은 브라우저 통합 검증이 적합. 컴포넌트 단위 복잡성이 커지면 재검토 |
| [shadcn-ui/ui](https://github.com/shadcn-ui/ui) / CLI 4.21.4 | MIT, archived 아님, 2026-10-13 갱신. Node ≥20.18.1. 현재 CSS Modules에 registry/스타일 기반을 추가로 맞춰야 함 | 무료 OSS. CLI 사용 시 registry 접속; 이번에는 실행·설치하지 않음 | **보류**. 기존 native dialog·버튼·CSS로 상태와 접근성 개선 가능. 이번 범위에는 스타일 기반 추가 비용보다 이익이 작음 |

공식 GitHub API와 npm registry에서 버전·라이선스·갱신 상태를 확인했다.
설치된 Next.js의 `node_modules/next/dist/docs/01-app/02-guides/testing/playwright.md`와
`environment-variables.md`, 공식 [Playwright 1.64.0 문서](https://github.com/microsoft/playwright/tree/v1.64.0/docs/src)의
web server·fixture·mock API 안내를 확인했다. Context7은 현재 도구 목록에 없어 공식 문서로 진행했다.
외부 저장소의 설치 스크립트는 실행하지 않았고, 패키지는 `--ignore-scripts`로 설치했다.

테스트 서버는 허용한 소스만 임시 폴더에 복사하고 별도 환경변수로 빌드한다.
`.env*`, 클라우드 토큰, 기존 브라우저 기록을 사용하지 않는다. 임시 앱 밖에 있는 기존
`node_modules`를 재사용하므로 공식 Next.js webpack 빌드 옵션을 사용한다.
기존 `npm run check`의 Turbopack 빌드는 유지해 두 빌드 경로를 모두 확인한다.

Superpowers는 테스트 우선·원인 분석·완료 검증 원칙만 적용하고 설치하지 않았다.
Repomix가 필요한 코드 전달 작업이 없으므로 사용하지 않았다.
Mastra·LangGraph·Codex App Server는 실제 AI 실행·재개 요구가 구체화될 때,
TTS는 음성 사용 요구가 있을 때, 별도 분석 서버는 현재 구조의 한계가 측정될 때만 재검토한다.

검증 결과는 `docs/TESTING.md`의 이번 검증 기록에 남긴다.

## 2026-10-14: 사용자 요청에 따른 테마 재디자인

사용자가 기존 색감·테마를 교체하고 더 화려하고 모던한 디자인을 요청했다.
기존 CSS Modules와 native dialog를 확인하고 다음 공식 후보를 비교했다.
기존의 디자인 유지 제한은 이번 명시적 요청에 한해 대체한다. 배포 제한은 유지한다.

| 후보 / 확인 버전 | 공식 출처·유지보수·호환성 | 비용·정보 전송·결정 |
| --- | --- | --- |
| [Radix Themes](https://github.com/radix-ui/themes) 3.3.0 | MIT, 2026-04-11 갱신, archived 아님, React 19 지원 | 무료 OSS. 로컬 UI 렌더링으로 업무 정보 전송 불필요. 완성형 테마가 있으나 기존 입력·레이아웃을 교체할 비용이 커 **보류** |
| [shadcn/ui](https://github.com/shadcn-ui/ui) CLI 4.21.4 | MIT, 2026-10-13 갱신, archived 아님. 현재 Next/React에서 사용 가능하나 스타일 기반 조정 필요 | 무료 OSS. CLI registry 네트워크 사용. 이번에는 미실행. 선택적 복사 가능하지만 기존 접근성·저장 동작이 있으므로 **보류** |
| [Headless UI](https://github.com/tailwindlabs/headlessui) 2.2.10 | MIT, 2026-04-13 갱신, archived 아님, React 18/19 지원 | 무료 OSS. 로컬 UI 렌더링으로 업무 정보 전송 불필요. 색상·테마 자체를 제공하지 않으므로 이번 시각 개편의 직접적 이익이 작아 **보류** |

**채택:** 기존 CSS Modules를 유지하며 전역 색상 토큰과 공통 표면·입력·팝업 스타일을 재구성한다.
짙은 네이비, 블루·바이올렛 그라디언트, 상태별 카드 포인트, 밝은 본문 색으로 통일한다.
새 패키지·외부 폰트·이미지 CDN·분석 스크립트는 추가하지 않는다.
공통 셸의 사용하지 않는 예전 대시보드 스타일을 제거하고, 기존 저장·오류 복구·모바일 동작을 보존한다.
설치된 Next.js 16.4.0의 `01-app/01-getting-started/11-css.md`를 확인했다.
Context7은 사용 가능한 도구가 없어 공식 로컬 문서와 공식 GitHub/npm 정보를 사용했다.

검증: `npm run check`와 `npm run test:all` 17건이 통과했다.
실제 캡처에서 빈 대화의 시작 버튼이 잘리는 문제를 찾아 자동 높이로 수정했다.
이후 UI 테스트 12건과 기존 lint·타입 검사·빌드를 다시 실행해 모두 통과했다.
합성 데이터로 1440px 데스크톱·390px/320px 모바일, 자료실·프로젝트·설정·검색·입력 팝업을 확인했다.
추가 비용·외부 전송 없이 검증했으며 운영 배포와 데이터 변경은 하지 않았다.

## 2026-10-14: korean-friend 연결 가능성 검토

사용자가 지정한 `kjd1374/korean-friend`의 `8c6f8bf`를 검토했다.
기존 Node/로컬 Ollama/JSON 학습 저장 구조를 유지하는 프로젝트 참조 연결을 권장하며,
Vercel에 전체 코드를 그대로 이식하는 방식은 저장소·사설 네트워크·API 접근 경계 조정이 필요해 보류한다.
별도 패키지나 후보 프레임워크 도입은 없는 읽기·검증 작업이다.
가짜 AI와 합성 데이터로 기존 앱 7개 흐름을 확인했다. 실제 모델·맥 장비·음성 서비스는 호출하지 않았다.
상세 구조·출처·비용·라이선스·검증 범위는 [연결 검토](integrations/korean-friend.md)에 기록했다.

## 2026-10-14: 프로젝트 선택 흐름 수정

프로젝트 카드의 기존 링크가 전역 프로젝트 범위를 바꾼 뒤 `/`로 이동해
프로젝트를 열어도 메인 대시보드처럼 보였다. 프로젝트 전용 상세 화면을 먼저 열고
대화 이동은 별도 버튼으로 선택하게 수정했다. 이름·설명·주소를 편집하고,
업무·자료·맥락·대화를 해당 프로젝트/영역으로 제한해 모아 보여준다.

기존 코드와 공식 후보를 비교했다. [Next.js](https://github.com/vercel/next.js) 16.4.0의
동적 경로·Link와 기존 CSS Modules/Modal을 채택한다(MIT, 현재 사용 중인 버전).
[Radix Themes](https://github.com/radix-ui/themes) 3.3.0,
[shadcn/ui](https://github.com/shadcn-ui/ui) CLI 4.21.4는 MIT이고 유지보수 중이지만,
이번 문제는 탐색 경로와 데이터 범위에 있어 UI 기반을 추가할 이익이 작아 계속 보류한다.
Next.js 로컬 공식 `page.md`와 `dynamic-routes.md`의 Promise params 규칙을 확인했다.
Context7은 현재 도구 목록에 없어 공식 로컬 문서로 진행했다.
추가 런타임 라이브러리·요금·외부 업무 정보 전송은 없다. GitHub/서비스 주소는
http/https만 허용하고 자격 증명이 담긴 URL은 거부하며, 자동 요청 없이 새 탭으로 연다.
기존 IndexedDB 버전과 프로젝트 ID를 유지하고 선택 필드만 추가해 이전 자료를 보존한다.
Prettier 3.9.10(MIT, 공식 npm 패키지)을 설치 스크립트 없이 임시 실행해 새 소스만 정리했으며 앱 의존성에 추가하지 않았다.

검증: 수정 전 프로젝트 상세 이동 테스트 실패를 재현했다. 수정 후 기존+신규 21건 통과.
프로젝트 상세 새로고침·이름/주소 편집·실패 후 재시도·다른 프로젝트/영역 분리와
모바일 320px 가로 넘침, 대화에서 돌아오기를 확인했다. 최종 `npm run check`의 lint·타입 검사·프로덕션 빌드도 통과했다.

프로젝트 상세 수정본을 기존 승인 범위의 Vercel 미리보기로 배포하고,
`jarvis-preview-ai-report.vercel.app` 별칭을 신규 preview deployment에 연결했다.
별칭이 기존에 없음을 확인했고 production 배포를 가리키지 않도록 검증했다.
고정 미리보기에서도 Vercel 로그인 보호를 유지한다. 이후 승인된 preview 배포는
이 주소를 재사용해 브라우저 저장 공간이 배포마다 바뀌지 않도록 한다.
이전 일회성 URL의 브라우저 기록은 자동 이전되지 않으며 기존 주소에 그대로 남는다.

## 2026-10-14: 통합 업무실·서버 저장·읽기 연결 기반

시작 상태: main / caeb78a, 이전 프로젝트 상세·디자인·테스트 미커밋 변경을 보존했다. 브라우저 IndexedDB v1에 실제 저장, 앱 계정/서버 업무 테이블·v4·AI 연결은 없는 상태를 확인했다. 기존 `/` 대화를 `/assistant`로 보존하고 결과/다음 행동 중심 홈을 추가한다. 별도 UI 프레임워크를 추가하지 않는다.

| 후보 / 확인 버전 | 출처·라이선스·유지보수·호환성 | 비용·전송·결정 |
| --- | --- | --- |
| [supabase/supabase-js](https://github.com/supabase/supabase-js) 2.117.3 | 공식 MIT, 2026-10-13 갱신, 설치된 버전과 일치. 기존 @supabase/ssr 0.12.7 및 Next 16.4.0과 재사용 | OSS SDK, 운영 저장/전송 비용은 기존 Supabase 요금제에 따름. 활성화 시 선택한 영역의 메타데이터·명시적으로 올린 파일만 기존 프로젝트로 전송. **채택: 기존 의존성 재사용**, 서비스 역할 키를 앱에서 사용하지 않음 |
| [TanStack/query](https://github.com/TanStack/query) 5.104.2 | 공식 MIT, 유지보수 중, React 19 지원 | 무료 OSS, 라이브러리 자체의 업무 정보 전송 불필요. 지금은 명시적 검토/병합 위주여서 기존 provider/fetch로 충분해 **보류** |
| [dexie/Dexie.js](https://github.com/dexie/Dexie.js) 4.4.6 | 공식 Apache-2.0, 유지보수 중, 브라우저 IndexedDB 호환 | 무료 OSS, 로컬 사용의 외부 전송 불필요. 기존 원자적 IDB·파일·탭 갱신 동작을 교체/이관할 이익이 작아 **보류** |

설치된 Next 16.4.0의 route handler·cookies 공식 로컬 문서를 먼저 확인했다. Context7은 사용 가능한 도구가 없어 공식 문서로 계속 진행했다. 새 패키지/유료 서비스·외부 설치 스크립트를 추가하지 않았다. 기존 Prettier 3.9.10 임시 실행으로 새 소스만 정리했다. Superpowers 원칙(실패 재현·원인 분석·완료 검증)을 참고하며 별도 도구·worktree 규칙을 도입하지 않았다.

서버는 사용자+영역별 JSON snapshot/RLS/revision CAS를 채택한다. 대규모 통계에 유리한 정규화 테이블은 후속 실제 사용량에 따라 검토한다. 기존 v1 형식 재사용과 백업 이관, 원자적 보관, 계정/영역 격리에 직접 이익이 있다. 자동 양방향 병합 대신 검토·확인 후 저장하며, 현재 문서의 삭제 동기화는 하지 않는다. 실서비스 수집은 독립 read-only adapter로 분리하고 실패를 삭제로 취급하지 않는다. v4 계약 부재로 실제 adapter/스케줄러는 보류했다.

AI는 비용/모델/전송 범위가 결정되기 전 근거 검색과 출처·최신성만 제공한다. 답변 생성·실행은 연결 필요로 남긴다. 실제 연결 전 모의 답변을 제품에 표시하지 않는다. 새 인증/접근 권한·운영 마이그레이션·배포는 적용하지 않았다. 최종 검증 결과와 미실행 범위는 `TESTING.md`에 기록한다.

최종 검증: lint/타입/빌드 통과, 합성 domain 6 + UI/실제 IDB 28건 통과. 화면 검토 후 긴 메모 접기와 사실 우선 필터를 보완하고 관련 6건·domain 6건·check를 다시 통과했다. 별도 실제 로컬 Supabase에서 소유자 RLS·영역 분리·다중 브라우저 복원·revision 충돌·UI 서버 저장을 검증했다. v4·AI·운영 연동과 실제 물리 기기는 미검증이며 서버 파일 API는 로컬 storage-api 부재로 미실행이다. 자세한 제한은 `TESTING.md`에 남겼다. 운영 배포·설정·인증·데이터 변경 없음.

## 2026-10-14: 미리보기 배포 누락 수정

사용자의 배포 문제 수정 요청으로 Vercel 이력과 main을 조회했다. 최근 ERROR 배포가 아니라 로컬 변경이 배포되지 않은 상태였다. 기존 Git 소스 헬퍼는 커밋/push 전용이고 이전 작업은 배포를 보류했다. 기본 미리보기 명령을 Node 24의 공식 `--use-env-proxy`와 Vercel 공식 REST createDeployment(files)/assignAlias로 보완했다. 기존 주입 토큰·프로젝트를 재사용하며 새 SDK·유료 서비스·권한을 도입하지 않았다. 작은 배포 경로 수정이므로 새 GitHub 라이브러리 비교는 생략했다.

운영 설정을 바꾸지 않고 현재 허용된 소스만 올리는 preview 경로다. 개인정보·비밀값·사용자 대화·업로드·백업을 전송하지 않는다. 이미 사용하는 Vercel 요금제의 일반 빌드이며 별도 유료 옵션은 선택하지 않는다. 빌드 확인·소스 해시·프로젝트/주소 소유권 검사·프로덕션 거부·이전 주소 보존·중단 후 resume을 지원한다. 합성 단위 검증 4건과 lint/타입/build가 통과했고 새 preview가 READY로 완료됐다. 상세 ID/주소/검증 한계는 `DEPLOYMENT.md`에 기록했다. Git push/merge와 운영 DB 변경은 하지 않았다.

## 2026-10-15: 제공된 v4 저장소의 읽기 연결 구조 검토

사용자가 제공한 kjd1374/33m2-v4-workspace main `939c906`의 코드·AGENTS·README를 읽었다. 별도 임시 clone의 읽기만 수행했으며 v4를 설치/실행/수정/배포하거나 고객 데이터/API를 조회하지 않았다. 익명 웹 진입은 /login 응답으로 확인했다. 기존 RecordEnvelope와 Supabase 서버 조회, 성과 함수와 수집 상태를 재사용할 수 있다. 현재 owner 쿠키 전체 조회와 lookup/importer의 쓰기도 가능한 장치 API는 Jarvis 전용 최소 읽기 권한과 구분한다.

전용 reader 역할/최소 필드 조회/완전 수집 계약/항목 링크를 v4의 별도 변경 후보로 제안했다. 지금은 구현 승인 전이며 신규 라이브러리·프레임워크·유료 호출·인증 권한 변경을 하지 않았다. 통화 AI 요약을 사실로 표시하지 않도록 Jarvis 출처 종류와 v4 상류 수집 최신성도 후속 보강 대상이다. 상세 근거와 미검증 범위는 `integrations/v4.md`에 기록했다.

## 2026-10-15: 웹 v4·GitHub·시트 연결 준비

기존 main의 미커밋 구현과 최신 디자인을 보존하고 서비스 등록·IndexedDB·설정 화면을 재사용했다. 설치된 Next 16.4.0의 공식 로컬 server/client components·Playwright 안내를 먼저 읽었다. Context7은 현재 제공되지 않는다. 실제 연동보다 서비스 주소 등록과 연결 순서·완료 기준을 이번 범위로 한정한다. 합성 브라우저 테스트로 새 연결 준비 경로 부재를 먼저 확인한 뒤 구현했다.

| 공식 GitHub 후보 / 확인 버전 | 유지보수·호환성·라이선스 | 비용·개인정보·직접 구현 대비 결정 |
| --- | --- | --- |
| [vercel/next.js](https://github.com/vercel/next.js) / 설치 16.4.0 | MIT, archived 아님, 2026-10-14 갱신, 기존 React 19.3/Node 24 환경 | 기존 컴포넌트·CSS·폼을 **재사용**. 새 서비스 요금/외부 업무 정보 전송 없음. 등록 안내에 새 프레임워크 이익이 없음 |
| [octokit/rest.js](https://github.com/octokit/rest.js) / npm @octokit/rest 22.0.1 | MIT, archived 아님, 2026-10-14 갱신, Node >=20으로 현재 Node 24 호환 | 무료 SDK, 연결 시 GitHub API로 허용된 정보/인증 전송. 실제 인증/조회 범위가 결정되지 않아 **보류**. 등록 UI에는 SDK 불필요 |
| [googleapis/google-api-nodejs-client](https://github.com/googleapis/google-api-nodejs-client) / npm googleapis 186.0.0 | Apache-2.0, archived 아님, 2026-10-14 갱신, Node >=22로 현재 Node 24 호환 | 무료 SDK, 연결 시 Google에 허용 데이터 전송 및 서비스별 API 쿼터 적용. 사용할 시트·권한·열이 미정이므로 **보류**. 현재는 원본 열기만 제공 |

GitHub 공식 API/npm registry의 메타데이터만 조회했으며 설치·외부 스크립트·실제 고객/API 호출은 없다. 새 런타임 의존성과 AI 프레임워크를 추가하지 않았다. 등록 양식은 비밀값을 받지 않으며 읽기/입력 전송/실행을 활성화하지 않는다. 기존 동기화 어댑터는 null이며 가짜 수집·답변·승인·완료 시각을 만들지 않는다. 검증과 GitHub 반영 경계는 TESTING.md와 integrations/github.md에 기록한다.

## 2026-10-15: 프로젝트 저장 보존과 오류 표시

Issue #4의 같은 브라우저/주소 소실 보고를 조사했다. 운영 응답에 Clear-Site-Data 헤더가 없고 앱에 초기화/삭제 동작은 없었다. 별도 합성 운영 프로필의 화면 이동·3회 새로고침·브라우저 재시작은 통과했으며, 사용자 환경의 실제 원인은 미확정이다. 프로젝트 목록이 읽기 실패를 빈 목록으로 표시하는 결함은 변경 전 실패 테스트로 확인했다.

Next 16.4.0/React 19.3.0/Playwright 1.64.0과 기존 IndexedDB v1을 재사용했다. 작은 저장 보존/오류 수정이므로 새 GitHub 패키지 검색·설치는 생략했고, 이전에 비교한 Dexie 등으로 교체하지 않았다. 설치된 Next 공식 로컬 client-components 문서를 확인했다. Context7은 제공되지 않았다. 추가 비용·업무 데이터 외부 전송·인증/운영 DB 변경은 없다.

마지막 정상 메타데이터 사본을 현재 값/파일과 원자적으로 보관하고 명시적 검토·확인 후에만 복구한다. 정상 기록이 생기면 복구를 거부하며 손상 값도 삭제하지 않는다. 이는 브라우저 전체 삭제를 막는 서버 백업이 아니다. 기존 v1, 저장 실패/롤백, 복구 경쟁, 실제 파일 바이트, 브라우저 프로세스 종료 후 재시작을 합성 테스트로 검증한다. 사용자의 번역 기록 복구와 실제 소실 원인은 완료로 주장하지 않는다. 최종 결과는 TESTING.md에 기록한다.

## 2026-10-15: 로그인 화면 없는 기기 연결과 서버 자동 보관 (Issue #6)

사용자가 서버 저장을 승인한 뒤 이메일/로그인은 제외하라고 정정했다. 이메일 주소·OTP·로그인/가입 화면을 요구하지 않는다. Supabase의 내부 기기 세션과 별도 승인된 기기 목록으로 단일 업무실을 제한한다. 최초 방문자가 소유권을 선점하게 하지 않으며, 웹의 기기 확인 번호는 인증 비밀값이 아닌 요청 식별자다. 기존 관리 권한으로 사용자가 확인한 번호만 등록한다. 실제 접근 증명은 HttpOnly 세션 쿠키와 서버/RLS의 기기 승인 여부다. 앱에는 service-role 키를 넣지 않는다.

| GitHub 후보 / 설치·확인 버전 | 공식 출처·라이선스·유지보수·호환성 | 비용·개인정보·결정 |
| --- | --- | --- |
| supabase/ssr / 설치 0.12.7 | 공식 MIT, archived 아님, 2026-10-10 갱신. 기존 Next 16.4.0 cookie/proxy와 호환 | **재사용**. 기존 Supabase에 기기 세션만 전송. 새 유료 서비스 없음 |
| supabase/supabase-js / 설치 2.117.3 | 공식 MIT, archived 아님, 2026-10-15 갱신. 기존 RLS/RPC/사설 원본 API 재사용 | **재사용**. 승인된 업무 자료/파일은 기존 Supabase 요금·쿼터 적용. 내부 기기 세션도 공급자의 활성 사용자 한도에 포함 |
| nextauthjs/next-auth / 확인 4.24.15, 미설치 | 공식 ISC, archived 아님, 2026-10-14 갱신. 추가 인증 계층과 설정이 필요 | **보류**. 이메일/소셜 로그인 UI 요구가 없고, 기존 Supabase 세션과 별도 계층을 만들 이익이 없음. 설치하지 않음 |

설치된 Next의 authentication/cookies 공식 로컬 문서와 Supabase의 Next SSR/passwordless 공식 문서를 확인했다. Context7은 제공되지 않는다. 이메일 방식을 검토했으나 사용자 정정에 따라 미채택했고 운영 메일 설정을 변경하지 않았다. 새 프레임워크·설치 스크립트·worktree를 도입하지 않았다.

기존 IndexedDB v1은 그대로 남긴다. 서버 업무실별 사본은 별도 DB에 보관하고 레거시 기록은 범위/충돌/원본 확인 후 명시적으로 이관한다. 정상/대기/실패/충돌을 구분하고, 서버 revision과 로컬 세대를 비교해 새 변경을 늦은 응답으로 지우지 않는다. 응답만 유실된 같은 내용은 재수집 확인 후 중복 저장하지 않는다. 충돌은 양쪽을 유지하고 사용자 검토 후 병합한다. 파일은 원본 링크를 복제하지 않고 사용자가 올린 원본만 사설 저장소에 보관한다.

업무실 UUID는 기기 세션 계정과 독립시켜 익명 세션 정리/연결 해제로 업무 기록이 연쇄 삭제되지 않게 한다. 새 마이그레이션은 기존 서버 업무 행이 있으면 중단해 별도 이관 검토를 요구한다. 등록되지 않은 기기는 메타데이터·파일·직접 RPC에서 모두 거부한다. 운영 적용·검증 결과는 별도 기록한다.

## 2026-10-15: 사설 파일의 배포 환경 전송 제한 보완

공식 [Vercel Functions 제한](https://vercel.com/docs/functions/limitations)의 요청/응답 4.5 MB 한도 때문에 기존 20 MB 원본을 앱 함수로 통과시키면 운영에서 실패한다. 새 기능/프레임워크가 아닌 기존 파일 저장의 배포 호환성 수정이며, 설치된 supabase-js 2.117.3 및 storage-js의 createSignedUploadUrl/uploadToSignedUrl/createSignedUrl 구현·타입을 확인해 재사용했다. 추가 패키지·유료 서비스·원본 복제 범위를 늘리지 않는다. 직접 업로드 라이브러리 추가는 이익이 없어 보류했다.

승인된 기기와 현재 영역/파일 메타데이터를 확인한 뒤, 단일 사설 경로에만 쓰는 upsert=false 임시 권한을 발급한다. 원본 바이트는 기존 Supabase로 직접 전송하고 서버에서 크기·SHA-256을 검증해야 저장 완료가 된다. 같은 원본 재시도는 확인만 하고 다른 원본은 409로 보존한다. 다운로드 권한은 60초, 업로드 권한은 공급자 기본 2시간이며 브라우저 메모리에서만 사용한다. 이미 발급한 권한은 기기 해제 후에도 만료까지 유효할 수 있다. 새 권한 발급과 일반 데이터 접근은 해제 즉시 차단된다. 파일 API 응답/권한 문자열은 private,no-store로 처리하며 업무 메타데이터·localStorage·로그에 저장하지 않는다.

## 2026-10-15: 프로젝트 주소와 서비스 등록의 공통 관리 (Issue #9)

기존 프로젝트의 주소 필드와 서비스 저장소가 분리돼 중복 입력과 설정 목록 누락이 발생했다. 최신 디자인·Next 16.4.0/React 19.3.0·IndexedDB v1·승인된 사설 서버 저장을 재사용한다. 프로젝트/설정에 동일 ServiceEditor를 쓰고 `services`를 현재 연결의 기준으로 삼는다. 예전 주소는 보존하며 순수 호환 변환에서 기존 ID/참조를 재사용한다. 운영 DB/인증 변경, 양방향 외부 동기화, 새 프레임워크는 없다.

| 확인한 GitHub 후보 / 버전 | 출처·라이선스·유지보수·호환성 | 결정·비용·자료 전송 |
| --- | --- | --- |
| supabase/supabase-js / 설치 2.117.3 | 공식 MIT, archived 아님, 2026-10-14 갱신. 현재 서버 snapshot/RLS와 호환 | 기존 저장만 재사용. 기존 Supabase 쿼터 내이며 이 변경으로 외부 수집/전송 대상을 추가하지 않음 |
| reduxjs/redux-toolkit / 공식 최신 v2.13.0 확인, 미설치 | 공식 MIT, archived 아님, 2026-10-06 갱신. entity adapter 가능하나 새 상태 계층 필요 | 보류. 기존 스냅샷과 공통 컴포넌트로 해결되며 추가 store의 이익이 없음. 별도 비용/외부 자료 전송 없음 |
| paularmstrong/normalizr / 공식 최신 v3.6.2 확인, 미설치 | 공식 MIT, archived, 마지막 갱신 2022-03-19. 기존 평면 데이터에 추가 정규화 계층 불필요 | 보류. 유지보수·실익 부족. 별도 비용/외부 자료 전송 없음 |

설치된 Next 공식 client-components 문서를 확인했다. Context7은 제공되지 않아 로컬/공식 문서로 진행했다. 저장소의 메타데이터/릴리스 정보만 확인했고 외부 설치 스크립트를 실행하지 않았다. 공통 등록에서 영역·프로젝트별 중복을 막고 GitHub 전용 양식의 중복 주소 입력을 없앴다. 웹+저장소 연결도 GitHub 목록에 나타나지만 자동 조회/AI는 미연결 상태를 명시한다. 실제 검증 결과는 TESTING.md와 PR에 기록한다.

## 2026-10-15: subscription CLI GitHub inspection (Issue #11)

Compared official `octokit/octokit.js` v5.0.5 (MIT, maintained 2026-10-13), `octokit/auth-app.js` v8.3.1 (MIT, maintained 2026-10-13) and existing official GitHub CLI + `openai/codex` (Apache-2.0, maintained 2026-10-15). Octokit/App would fit a hosted collector but require separately provisioned runtime GitHub auth; API SDKs would require API billing and do not reuse a ChatGPT web subscription. Adopt the user's official local gh/Codex authentication via a small outbound Node 24 runner; no new npm dependency. Local GitHub CLI 2.46.0 transport and Codex 0.159.2 help/capability contract were inspected. Codex must support ignore-user-config, ignore-rules, ephemeral and output-schema; shell/unified execution/multi-agent/web search disabled. Context7 is unavailable; official Codex authentication/noninteractive docs, GitHub REST tree/best-practice docs and installed Next16.4 Route Handler docs used. No Codex App Server, Mastra, LangGraph, paid model/API key or production credential sharing.

Durable jobs/inspection/AI history live under existing scoped Service JSON; no migration. Approved device leases + revision CAS fence concurrent results and preserve human edits. GitHub facts use independent success/error timestamps so reading code never marks v4 business data synchronized. Incremental SHA reuse and bounded excerpts reduce reads/context; complete tree only permits explicit file deletion. AI basis includes source contents/titles/statuses, HEAD, project context and scoped task state. Human proposal decisions dedupe by cited sources/kind/target, not model wording. Completed local analysis caches pending delivery with private permissions. New task execution, GitHub writes, merge/deploy and source data changes are excluded from the runner. CLI subscription/limits and actual user runner readiness are separate from code availability.

Verification: lint/typecheck/build passed; domain 20, runner 7, deploy 4, device 4; browser full regression 66 plus 8 targeted desktop/mobile rechecks after immutable citation/long-path fixes; actual local Supabase 14 groups including real runner cookie/device bootstrap, concurrent lease claims, stale-device rejection, cited analysis validation, preservation of concurrent human edits, unchanged-basis skip and read-error recovery. GitHub live read of the Jarvis source repository returned 110 files, 24 selected file reads, complete tree and 63 facts, with no writes/model calls. Actual end-user PC/Codex subscription login/model output remains unverified until first-use setup. CI uses synthetic external transports and production DB/model calls remain zero.

## 2026-10-15: project header links (Issue #13)

Inspected existing unified service registration and URL validation. Compared `vercel/next.js` (MIT, maintained 2026-10-15; installed 16.4.0) built-in navigation with `radix-ui/primitives` (MIT, maintained 2026-10-14; evaluated repository, not installed). Two external-link actions need no menu framework or new dependency: reuse existing buttons/registration, native anchors with noopener/noreferrer and safe URL validation. Installed Next16.4 Link docs distinguish internal client navigation from ordinary external links. Header derives links from current service records, scopes by space+project, and dedupes canonical repositories without reviving archived project URLs. Explicit registration project ID avoids relying on a different global active-project preference after a direct project URL visit. No external web fetch, iframe, AI call, new storage schema or authentication changes. Existing environment/toolchain reused; no setup configuration changes needed.

Validation: lint/typecheck/production build and domain 20 passed. The new end-to-end case passes on desktop/mobile: canonical GitHub dedupe, project/space/common/archive isolation, actual popup navigation with synthetic pages, explicit registration scope despite another active-project preference, reload, settings edit propagation and request creation, including 320px width. Full browser/storage regression: 68 passed. Initial new-case failure was the synthetic HTML fixture's missing UTF-8 response charset; corrected the fixture and reran it and the full suite. External pages are mocked; no production workspace/model/business data used. Existing actual local server suite is exercised by CI; this change does not alter server storage/authentication.

## 2026-10-15 — 프로젝트 대화와 구독 CLI 실행 (Issue #15)

문제: URL/수기 기록 중심 화면은 사용자가 원한 GitHub 자동 파악 → 대화 요청 → 코드 수정·검증 → 후속 업무 자동 정리를 충족하지 못했다. 프로젝트 전용 대화/실행 큐와 결과 분류를 기존 private workspace snapshot에 추가한다. 스키마 마이그레이션/새 인증/별도 API 과금 없이 Codex outbound runner를 확장한다.

비교: 공식 `openai/codex`(Apache-2.0, 2026-10-15 활동, 환경 CLI 0.159.2)와 `anthropics/claude-code`(공식 배포 저장소, API 메타데이터 license 없음·독립 이용약관, 2026-10-14 활동)를 확인했다. 사용자의 기존 구독 재사용과 이미 구현한 Codex 인증/JSON 계약에 맞춰 `codex exec`를 유지한다. Claude는 실제 구독 선택/어댑터 검증 전 도입하지 않는다. App Server/에이전트 프레임워크는 이 작업에 필요한 장점을 추가하지 않아 보류한다. Next 16.4의 로컬 Route Handler 문서 및 OpenAI 공식 noninteractive/auth/security 문서를 확인했고 새 의존성은 추가하지 않았다.

선택: GitHub 구조화 메타데이터/명시적 README 링크에서 웹 주소를 발견하고 출처를 보관한다. 모델은 선택 저장소의 isolated checkout에서 수정, runner는 실제 Git diff/검사/PR/선택적 merge와 exact merged SHA 배포를 관찰한다. 공개 PR에는 사적 요청 대화를 넣지 않는다. workspace-write sandbox·네트워크 차단·구독 인증 유지, CI 정책/비밀/사용자 데이터 제외, 기기+요청 lease token, 취소 fencing, private journal/중복 전달 복구를 적용했다. 자동 제안은 업무로 등록하되 새 외부 실행 승인으로 확대하지 않는다. 백업의 대기 요청은 복원 시 일시 중단한다.

검증: 실제 임시 Git fixture에서 수정/커밋/푸시/복구를 수행하며 GitHub와 Codex 계약은 합성 처리한다. 도메인에서 scope/lease/late-result/PR-vs-deployment/backup pause를 확인하고, 데스크톱/모바일에서 프로젝트 대화·자동 링크·자동 결과/후속 업무 및 320px을 검증한다. 서버 검증은 disposable local Supabase의 실제 owner/device/CAS를 사용한다. 최종 수치와 운영 배포 증거는 연결 PR에 기록한다. 실제 사용자 subscription/model run은 사용자 PC 최초 연결 이후 별도 확인하며 개발/플랫폼 인증을 대신 사용하지 않는다.

## 2026-10-15 프로젝트 장문/중복 노출과 연결 상태 구분 (Issue #17)

설치된 Next 16.4.0 CSS Modules/client components 공식 문서를 확인했다. 기존 React 19.3.0, CSS Modules, native details/summary를 재사용한다. 앞서 비교한 공식 Radix Primitives와 shadcn/ui 저장소를 다시 확인했다(둘 다 MIT, 비보관, 각각 2026-10-14/15 갱신). React 19와 호환되는 접근성 컴포넌트를 제공하지만 단순 접기 UI에 새 패키지/스타일 체계를 더할 이익이 작아 보류한다. 새 패키지 설치·유료 서비스·외부 업무 전송은 없다.

최신 대화 하나와 제한된 텍스트 미리보기로 기본 높이를 제한하고, 사용자 선택으로 전문·이력·원문을 연다. 중요한 실패/결정 수와 요청 실행 범위는 접지 않는다. 기존 원문/이력은 삭제하거나 요약으로 덮어쓰지 않는다. 원문 카드의 compact 모드는 프로젝트 상세에서만 사용해 홈/검색의 기존 표시 범위를 유지한다.

실행기 접속과 대상 앱 연동을 같은 상태로 취급하지 않는다. 서버가 검증한 임대 heartbeat/수집 성공에서 접속 시각을 기록하고, 오래된 접속은 온라인으로 표시하지 않는다. 서버가 제공하는 작업/분석 context에 관찰된 Jarvis 연결과 대상 저장소의 범위를 구분하며, 현재 2.0 실행기의 기존 JSON 입력 계약을 유지한다. AI 응답의 정확성을 강제로 보장하거나 사용자 기기의 다른 CLI를 검사했다고 주장하지 않는다.

## 2026-10-15 npm 설정 충돌 수정 (Issue #19)

기존 Node 24.19.0/npm 11.9.0 환경에서 사용자/전역 설정을 모두 `/dev/null`로 지정하면 `npm --version`도 `double-loading config`로 종료됨을 재현했다. 의존성이 없는 합성 package-lock의 실제 runner 실행도 실패했다. npm 설정의 두 경로를 요청별 private 폴더의 서로 다른 빈 파일로 분리한다. 설치 스크립트 비활성·사용자 인증 제외·잠금 파일·기존 병합 조건은 유지한다. 작은 버그 수정이므로 새 도구 비교/도입과 환경 설정 변경은 불필요하다.

알려진 npm 오류 종류/종료 코드만 공개하고 원본 로그는 전송하지 않는다. 모델 입력에 실제 준비 검사 결과를 포함해 모델의 로컬 검사 설명과 구분하도록 한다. 저장된 결과는 재실행하지 않고 버전 2.0.1 교체·재시작 후 새 요청으로 확인한다. 실제 npm(네트워크 의존성이 없는 합성 프로젝트), 설치 훅 비활성, 전달 재시도 시 중복 설치 없음, 설치 실패 시 병합 금지와 로그 미노출을 포함한 runner 17개 검증이 통과했다. 사용자 Mac/구독 실행을 대신 테스트하지 않았으며 CI·운영 배포 증거는 PR에 기록한다.

## 2026-10-15 서버 갱신과 브라우저 입력의 병합 (Issue #21)

원인: 영역 전체 revision 불일치를 내용 충돌로 취급하고 검토 중 어느 필드든 서버가 갱신되면 재확인을 요구했다. CLI의 주기적인 heartbeat/result와 저장이 겹치면 반복된다. 저장 성공 뒤 서버의 병합 내용이 화면에 반영되지 않는 경로도 수정했다.

기존 IndexedDB 원자적 트랜잭션/CAS를 유지하고 영역별 기준본을 추가해 3개 버전(기준·기기·서버)을 비교한다. npm `jsondiffpatch`의 공식 GitHub(MIT, 2026-05-14 갱신)와 `fast-json-patch`의 공식 GitHub(MIT, 2025-10-23 갱신)를 비교했다. 패치 생성은 가능하지만 기기 대기 세대·실행 임대·기존 검토 선택 보존 정책은 앱에서 구현해야 하므로 새 의존성을 추가하지 않았다. 기존 Node 24/Next 16.4/React 19.3 환경을 재사용하고 Next의 설치된 use-client 문서를 확인했다. 새 유료 서비스·외부 데이터 전송·인증/DB 정책 변경은 없다.

기준 없는 기존 대기는 자동으로 우선순위를 추정하지 않고 한 번 검토한다. 실행 상태는 필드를 섞지 않으며 이전 상태로 되돌리지 않는다. 최신 관찰값을 유지하고 새 요청 ID는 양쪽에서 보존한다. 검토 중 별도 변경은 재계산하고 겹친 새 편집은 재확인한다. 저장 경쟁은 제한된 재시도, 실패는 영구 로컬 대기, 응답 유실은 서버 동등성 확인을 따른다. 회귀 검증은 합성 브라우저 자료와 실제 disposable Supabase를 사용하고 상세 결과/운영 배포 증거는 PR에 기록한다.

## 2026-10-16 맥미니 실행·커밋에 대응하는 웹 화면 (Issue #23)

기존 Node 24.19.0, Next 16.4.0/React 19.3.0와 GitHub/Codex 실행기를 재사용한다. 설치된 Next client 문서를 확인했다. 공식 `vercel/vercel`(Apache-2.0, 2026-10-15 갱신)은 기존 웹 배포를 유지하는 데 적합하다. `tailscale/tailscale`(BSD-3-Clause, 2026-10-16 갱신)은 다른 기기에서 맥미니에 접근하는 후속 선택지지만 계정/접근 구성이 필요해 이번에 활성화하지 않는다. `Unitech/pm2`(GitHub API의 라이선스 식별은 NOASSERTION, 2026-09-04 갱신)는 추가 프로세스 관리 의존성 대비 이점이 작아 채택하지 않는다. macOS 내장 LaunchAgent/caffeinate로 사용자 로그인 후 재시작·절전 방지를 구현한다. 새 npm 패키지·유료 호스트·인증 정책 변경은 없다. Docker 호환 엔진은 사용자 Mac의 별도 전제이며 설치됐다고 추정하지 않는다.

실행기 2.1은 모델 없이 처리하는 preview 요청을 기능 선언한 실행기에만 배정한다. 기존 배포는 동일 SHA의 성공 기록이 있어야 연결하고, 임시 화면은 허용된 추적 파일만 복사해 공식 `node:24.19.0-bookworm-slim`에서 실행한다. npm 잠금 파일·설치 훅 제외, 비밀/자료/심볼릭 링크 제외, 빌드 네트워크 차단, 런타임 일반 사용자·읽기 전용 루트·무네트워크·자원 한도·2시간 수명을 적용한다. 이미지 다운로드와 공개 npm 의존성 설치에는 네트워크를 사용하며 사용자 인증 파일은 빌드 컨텍스트에 포함하지 않는다.

Docker internal 네트워크에서 호스트 포트 공개가 동작하지 않는 것을 실제 실행에서 확인했다. 네트워크 없는 컨테이너를 유지하고 맥미니 루프백 전달기가 고정 docker exec 표준 입출력으로 연결하도록 수정했다. 미리보기별 식별 응답과 HTML 서버 응답을 검증한다. 같은 프로젝트의 새 화면이 준비된 뒤 이전 컨테이너를 종료하며, 다른 프로젝트 3개가 이미 실행 중이면 추가 준비를 제한한다. 실행기 재시작은 루프백 포트를 끊을 수 있으므로 다시 준비한다.

실제 Linux Docker 28.4에서 합성 Node/SQLite 서버의 생성·쓰기·새로고침 유지, Chromium 화면/버튼, 호스트 마운트·인증·외부 네트워크 차단을 확인했다. 테스트는 CI에서도 반복한다. 승인된 대상 앱도 별도 임시 데이터와 모델 없는 모드로 화면/health 응답을 확인했으며 소스·실제 데이터는 수정하지 않았다. 실제 macOS launchd/구독 인증 검증을 대신한 것은 아니다. 실행기/설치기 계약, SHA·만료·기능 배정, 브라우저 및 disposable Supabase 회귀 수치는 연결 PR에 기록한다. 기존 검색 테스트의 날짜 고정 자료는 기준 시각을 명시해 실행 날짜에 따른 실패를 제거했다.

## 2026-10-16 Docker Desktop 실행 중 설치기 검색 실패

사용자의 Mac에서 Docker Desktop은 Engine running인데 설치기가 실행 필요로 표시했다. Docker 번들/사용자 CLI 폴더를 PATH에 추가한 읽기 검사에서는 서버 버전이 반환되어 명령 검색 경로 누락으로 확인됐다. 설치기 사전 검사와 LaunchAgent가 같은 PATH를 사용하고 기존 명령 경로 다음에 사용자 `.docker/bin`, 시스템/사용자 Applications의 Docker 번들, Homebrew·시스템 경로를 보완한다. CLI 실행 실패와 CLI는 있지만 엔진 접속 실패인 경우를 구분한다. Docker 컨텍스트·소켓·인증 설정은 바꾸지 않는다.

작은 설치 오류 수정으로 새 도구 비교·설치는 하지 않았다. 실제 임시 디렉터리에 합성 실행 파일을 만들고 기존 PATH에서는 실패, 보완한 사전 검사와 저장된 LaunchAgent PATH에서는 성공하는 것을 검증한다. 실패 로그의 인증값·주소는 출력하지 않고 알려진 상태만 표시한다. 실제 Mac 설치 결과는 사용자 확인을 따르며 클라우드 테스트로 대체하지 않는다.
