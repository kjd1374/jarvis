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

## 2026-10-16 웹 버튼에서 맥미니 미리보기 진입 실패 (Issue #27)

실제 맥미니 실행기 연결·화면 준비는 확인됐지만 자비스 링크로 열면 대상 앱이 `Sec-Fetch-Site: cross-site`를 거부했다. 기존 health 검사와 주소 직접 방문 테스트는 이 진입 경로를 검증하지 못했다. Chromium에서 별도 HTTPS 출처의 `target=_blank`, `noopener noreferrer` 링크를 실제 클릭해 수정 전 403을 재현했다.

실행기 2.1.1의 격리된 전달기는 Origin 없는 사용자 활성화(`Sec-Fetch-User: ?1`)의 최상위 문서 GET이 정확히 `/`를 열 때만 주소창 진입처럼 전달한다. API·다른 경로·쿼리·iframe·자동 이동·교차 출처 Origin·쓰기 요청의 보호 정보는 유지하며 대상 앱 소스는 수정하지 않는다. 새로운 도구·서비스 없이 작은 전달기 오류를 수정했다.

수정 후 실제 Docker/Chromium 링크 진입 200, SQLite 저장·새로고침, 교차 사이트 요청 거부와 기존 컨테이너 격리를 확인했다. 승인된 대상 앱도 임시 데이터·모델 없는 모드에서 같은 링크 진입, 화면 제목·버튼·health·새로고침·스크립트 오류 없음을 확인했다. 28개 자동화/실행기 검사와 lint가 통과했다. 실제 Mac에는 설치기를 다시 실행하고 새 화면 준비를 요청해야 수정된 컨테이너가 적용된다.

## 2026-10-16 맥미니 실행기 교체·복구 확인 (Issue #28)

설치기 사전 검사는 통과했지만 자동 시작 재등록 실패가 보고됐다. 실제 Mac의 읽기 전용 `launchctl print`는 등록 존재와 `state = running`, PID, 아직 종료하지 않았음을 확인했다. 기존 설치기는 모든 bootstrap 실패에 로그인 세션 안내를 출력하고, bootout 완료와 복구 등록 성공을 확인하지 않아 정확한 실패 단계·현재 복구 상태를 알 수 없었다. 실제 bootstrap 오류 코드는 남기지 않았으므로 종료 경쟁이 원인이라고 단정하지 않는다.

Apple의 공식 [Creating Launch Daemons and Agents](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html)를 참고해 기존 사용자 LaunchAgent를 유지한다. GUI 도메인을 먼저 확인하고, 해당 실행기 등록의 제거를 기다린 뒤 설정을 교체한다. 등록이 없는 동안의 일시적인 bootstrap 5만 제한적으로 재시도하고 등록 존재를 재확인한다. 실패 시 부분 등록을 제거한 뒤 이전 설정·등록을 복원하며, 복원 실패를 성공으로 표시하지 않는다. 오류에는 단계와 숫자 상태만 넣고 명령 원문 로그는 출력하지 않는다.

새 도구나 시스템 권한을 추가하지 않았다. 실제 임시 파일과 합성 launchctl 상태 전이로 지연된 종료, 일시적/지속적 등록 실패, 세션 부재, 종료 실패, 부분 등록, 복원 실패와 거짓 성공 응답을 검증한다. macOS 자체를 실행한 테스트가 아니므로 실제 Mac의 결과는 별도 확인한다. 실행기 재시작 후 이전 미리보기 포트는 끊길 수 있으며 새 화면 준비로 새 링크를 사용한다.


## 2026-10-17 시트 작업 공간과 문서 구독 CLI (Issue #30)

- 비교: `googleapis/google-api-nodejs-client` (공식 Apache-2.0, 186.0.0 검토, 2026-10-14 유지보수), `TanStack/table` (MIT, 2026-10-12 유지보수), `dream-num/univer` (코어 Apache-2.0, 2026-10-16 유지보수). Google SDK는 서버 토큰 보관/갱신이 필요한 경우 유용하고, TanStack은 대규모 정렬/가상화, Univer는 전체 편집기가 필요할 때 유용하다. 현재 제한된 읽기 표에는 추가 의존성이 이점보다 크므로 세 패키지 모두 보류한다.
- 채택: 공식 브라우저 GIS token model + Google Picker + Sheets REST GET, 네이티브 HTML 표. Node 24.19 / Next 16.4 / React 19.3 기존 조합을 유지한다. 공식 hosted SDK는 버전 고정 npm 배포물이 아니며 실패/만료를 명시한다. `drive.file` 파일 선택 범위, OAuth 토큰 메모리 보관, 원본은 Google에서 편집. 전체 OAuth 동기화 서버·유료 모델 API·새 DB 마이그레이션을 추가하지 않는다.
- 저장한 값은 기존 개인 서버의 documents에 포함하며 범위·시간·불변 보관 ID를 붙인다. 문답 근거를 질문 시점에 고정하고 보관/조회 실패/다른 기기 갱신으로 바뀌지 않게 한다. 질문과 보관본 ID를 기준으로 3-way 병합, 실행 결과는 원자적으로 보존, 복원은 대기 요청을 중단한다.
- 문답 전용 `documentVersion:1` 작업은 기존 명시적 영역/프로젝트/기기 인증을 재사용한다. CLI 2.2.0, ChatGPT 로그인만 허용, 셸/웹/멀티에이전트/사용자 규칙 비활성화, 2분 모델 제한. 셀은 비신뢰 자료이고 원본 쓰기나 코드 작업 지시가 될 수 없다. 전송 실패 시 비공개 결과 캐시를 재사용한다.
- 외부 전송: 선택한 범위는 Google→브라우저→기존 개인 Jarvis 저장소, 사용자가 질문하면 해당 범위/질문/같은 보관 범위의 최근 대화가 Mac 구독 CLI→OpenAI로 전달된다. Google 자격 증명은 저장소/실행기에 보내지 않는다. 실제 Google 설정/사용자 구독 실사용은 최초 연결 뒤 별도로 확인한다.
- 검증 결과는 PR/Issue #30에 기록한다. 합성 브라우저·모델 계약과 일회용 실제 Supabase 저장 검증을 분리한다.

### 2026-10-17 시트 보기 사용성 (Issue #32)

탭 선택 후 별도 읽기 버튼이 필요했던 흐름에 선택 탭 자동 읽기를 추가한다. 같은 브라우저의 유효한 Google 세션에서 처음 보는 탭만 기본 A1:T200을 읽고, 보관된 탭은 즉시 표시한다. 범위 변경/최신 값은 명시적 다시 불러오기다. 자동 인증 팝업과 실패 재시도 반복은 없으며 읽기 실패는 기존 보관본을 유지한다. 늦은 응답은 원래 탭에만 보관하고 현재 선택의 알림을 덮지 않는다. 계정/영역/프로젝트 전환과 보관은 기존 비동기 저장 검사를 유지한다.

표 크기 구현 후보를 공식 저장소에서 확인했다: [TanStack Table](https://github.com/TanStack/table)의 React 패키지 9.3.1(MIT, React >=18), [AG Grid Community](https://github.com/ag-grid/ag-grid) release-36.2.0(Community MIT; 저장소 패키지 36.2.0-beta.20261016.1611, Enterprise는 별도 상용 조건). 두 프로젝트 모두 최근 유지보수되고 있으나 현재 최대 10,000셀 표시값 표에는 전체 표 모델/그리드 도입 비용이 더 크다. 기존 HTML 표·고정 colgroup·Pointer Events·React 19.3 useSyncExternalStore를 선택해 추가 패키지/비용/제3자 전송 없이 너비/높이 조절을 구현한다. 설치된 Next 16.4 Client Component 지침을 확인했다.

크기는 원본 행/열 번호 기준이며 계정·영역·문서·탭별 브라우저 보기 설정으로만 저장한다. 크기 변경은 Google 원본, 서버 문서, AI 근거/스냅샷을 바꾸지 않는다. 포인터/터치/방향키, 두 번 클릭/초기화, 크기 범위 제한 및 손상된 설정 복구를 제공한다. 우측 문답은 컴포넌트를 유지한 채 접어 작성 중인 질문과 대화를 보존하고 넓어진 표를 제공한다. 접힘 상태도 브라우저 계정/영역별로 기억한다. 기존 브라우저 기록과 백업 포맷은 변경하지 않는다.

### 2026-10-17 Google 파일 선택창 표시 수정 (Issue #34)

공식 [DocsView.setMode](https://developers.google.com/workspace/drive/picker/reference/picker.docsview.setmode)는 `drive.file`처럼 썸네일 권한이 없는 범위에 LIST 모드를 권장한다. 기본 썸네일/영어 설정을 LIST/ko와 연결 목적 제목으로 바꾼다. [setSize](https://developers.google.com/workspace/drive/picker/reference/picker.pickerbuilder.setsize)의 566×350–1051×650 범위 안에서 큰 화면은 최대 900×560, 작은 화면은 SDK 기본 처리를 유지한다. 폐기된 setLabel이나 Google iframe 내부 CSS 변경은 사용하지 않는다.

기존 SDK 표시 옵션의 작은 수정이므로 새 라이브러리 비교/도입은 생략한다. Next 16.4 Client Component 지침을 확인했으며 새 비용·인증 범위·외부 전송·저장 형식 변경은 없다. 합성 Picker 계약을 갱신하고 기존 선택/읽기·탭 이동·보기 설정·문답 회귀를 실행한다. 실제 비공개 Google 목록 렌더링과 합성 검증은 구분한다.

### 2026-10-17 시트 목록의 세부 탭 이동 (Issue #36)

파일 아래에 모든 탭을 펼치던 목록을 파일 단위로 줄이고 기존 탭 전환을 표 상단의 네이티브 select로 옮긴다. 작은 UI 배치 변경으로 새 라이브러리 비교/도입은 생략하며 Next 16.4 Client Component 지침과 기존 선택/비동기 읽기 처리를 재사용한다. 키보드·모바일 선택은 브라우저 기본 컨트롤을 사용한다. 탭이 하나인 경우 이름만 표시하고, 여러 탭은 메뉴를 열었을 때 목록을 보여준다. 원본·저장 구조·인증·실행기는 바꾸지 않는다.

### 2026-10-17 전체 탭 표시와 제거 (Issue #38)

큰 표 표시 후보로 공식 [TanStack Virtual](https://github.com/TanStack/virtual)의 React 패키지 3.14.21(MIT, 최근 유지보수), [react-window](https://github.com/bvaughn/react-window) 2.3.4(MIT, React 18/19 호환, 2026-10-10 릴리스)를 확인했다. 연속 스크롤 가상화에는 유용하지만 현재 읽기 표와 CLI 구간 한도를 함께 유지하려면 구간 이동이 더 작고 명확한 변경이다. 기존 HTML 표/네이티브 선택 메뉴를 채택하고 새 의존성·비용·전송 대상은 추가하지 않는다. Next 16.4 Client Component 지침을 유지한다.

공식 Sheets values.get에 인용한 탭 이름만 전달해 전체 표시값을 한 번에 읽는다. 응답 스트림 8 MB, 값 150만 자·50만 셀·10만 행·18,278열 한도를 먼저 검사하고 200행/50열 이하, 10,000셀/40,000자 이하의 불변 구간으로 분할한다. 큰 셀 집합은 행/열 방향으로 재분할한다. 탭에 전체 구간 ID와 행·열 수/시각을 원자적으로 연결한다. 구간 수/기존 문서 보관 200개·시트 전체 JSON 200만 자 한도나 해당 영역의 서버 전송 예산 3.9 MB를 넘으면 새 읽기 전체를 저장하지 않는다. 이전 질문이 참조하는 보관본은 삭제하지 않으며 같은 값은 재사용한다. 전체 읽기는 Google 표시값 기준이며 수식/서식·실시간 동기화가 아니다.

기존 실행기 2.2.0의 문답 입력은 현재 표시 구간으로 유지한다. 질문 시각과 행 인용은 해당 구간에 고정한다. 전체 읽기 구간 모두 자료 검색/보관/백업에 포함한다. 동시 전체 읽기의 구간 ID/크기/시각은 하나의 묶음으로 충돌 검토하며 서로 다른 읽기를 섞지 않는다.

제거는 확인 화면에서 자비스 보관 내용·문답·첨부 연결 제거와 Google 원본 보존을 설명한다. 제거한 시트는 동시 원격 저장/heartbeat보다 제거 의도를 우선해 복원되지 않게 하고, 관련 대화의 글은 남긴 채 첨부 ID를 해제한다. 다른 자료·영역은 보존하며 없어진 문서의 문답 결과는 기존 stale_job 검증으로 거절한다. 과거 백업을 명시적으로 가져오는 복원과 자동 재등장은 구분한다.

### 2026-10-17 무채색 테마 (Issue #40)

공식 [Radix Colors Gray](https://github.com/radix-ui/colors/blob/dbdb85470547c7d34b9001f48fddb08ded335979/src/dark.ts)(패키지 3.0.0, MIT), [shadcn Neutral](https://github.com/shadcn-ui/ui/blob/d2fba50ee5b9113008b5bb908563527b7efd2f27/apps/v4/registry/themes.ts)(2026-10-17 main, MIT), [Primer primitives](https://github.com/primer/primitives/blob/66e78d332cc536e471bcaeb3f8ad08dc16cfbb8a/src/tokens/base/color/dark/dark.json5)(11.10.0, MIT)을 비교했다. Radix의 무채색 단계와 shadcn의 역할별 색상 구분을 참고한다. Primer는 상태/의미별 토큰이 풍부하지만 기본 dark의 푸른 기와 전체 디자인 시스템 도입은 이번 요청에 맞지 않아 적용하지 않는다. Radix는 마지막 저장소 갱신이 2025-12, 나머지는 2026-10이며 실행 의존성이 아닌 정적 배색 참고로만 사용한다.

기존 CSS Modules와 전역 CSS 변수를 유지하고 Next 16.4 CSS 지침의 전역/모듈 분리를 따른다. 화면마다 지정하던 색상은 배경·표면·본문·보조·입력 경계·선택·성공/대기/오류 변수로 옮긴다. 배경 #111111, 패널 #191919, 높인 표면 #222222, 본문 #eeeeee, 보조 #b4b4b4, 버튼 #2563eb를 사용한다. 주요 기본 조합의 대비는 본문/배경 16.28:1, 보조/높인 표면 7.67:1, 버튼 흰 글자 5.17:1, 입력 경계/높인 표면 3.36:1이다. 선택 상태는 색 외에 선·테두리와 기존 aria 상태를 유지한다. 비활성 버튼은 전체 투명도로 흐리게 하는 대신 중립 표면/글자를 사용한다.

새 라이브러리·폰트·외부 전송·비용·인증·저장 형식 변경은 없다. 테마 토글/설정 저장은 추가하지 않으며 사용자 요청에 맞춰 현재 기본 색상을 바꾼다. 기존 브라우저 회귀와 실제 렌더링의 대비/키보드 포커스·좁은 화면을 확인한다. 대비 수치와 합성 화면 검토를 완전한 접근성 인증이나 실제 눈 피로 개선의 측정으로 표현하지 않는다.

### 2026-10-18 인증된 원격 미리보기 (Issue #42)

공식 [Tailscale](https://github.com/tailscale/tailscale)(BSD-3-Clause, 2026-10-17 갱신), [Cloudflare cloudflared](https://github.com/cloudflare/cloudflared)(Apache-2.0, 2026.10.1/2026-10-15 릴리스), 기존 [Supabase JS](https://github.com/supabase/supabase-js)(MIT, 설치 2.117.3)를 비교했다. Tailscale은 사설 접속에 적합하지만 각 PC의 VPN/계정 설정이 필요하다. Supabase 요청·응답 중계는 임시 HTTP 본문 저장, 트래픽·조회 비용, 출처 분리와 자산 경로 처리까지 새로 구현해야 하므로 채택하지 않는다. Cloudflare의 계정 없는 임시 터널을 기존 승인 게이트웨이 뒤에서 사용한다. 유료 플랜이나 새 사용자 로그인을 추가하지 않으며 HTTP 임시 화면으로 한정한다. 무료 연결의 SLA 부재, 200 동시 요청 한도와 SSE 미지원은 운영 서비스의 보장으로 표현하지 않는다. 임시 앱 코드/화면 트래픽은 Cloudflare를 통과한다.

Mac 설치기는 공식 GitHub 2026.10.1 arm64/amd64 압축파일을 릴리스 SHA-256과 비교한 뒤 고정 파일만 추출한다. 격리된 HOME, 자동 업데이트 금지, 루프백 게이트웨이/메트릭 포트를 사용하고 사용자 Cloudflare 인증이나 앱 운영 비밀을 읽지 않는다. Node 24 내장 HTTP/crypto와 기존 Next 16.4 Route Handlers를 사용하며 패키지 의존성을 추가하지 않는다. 설치된 Route Handler/Proxy 지침을 읽었다.

Ed25519 서명 개인키는 서버 환경에만 둔다. 승인된 기기에서 현재 프로젝트·저장소·커밋·미리보기 UUID를 검증하고 짧은 1회용 입장권을 폼 POST로 전달한다. 미리보기마다 별도 HTTPS 출처를 사용한다. 비밀 쿠키는 호스트 전용·Secure·HttpOnly로 보관하고 실제 앱에는 제거해 전달한다. 승인 취소는 기존 RLS 소유자 확인을 재사용하는 boolean 전용 RPC로 검증하며 기기 행/코드 공개는 없다. 본문 크기·동시 요청·세션 수·시간을 제한하고 외부 출처의 API 쓰기·프레임·서비스 워커를 거절한다. URL만으로는 앱에 접근하지 못하며 백업/삭제/저장소 변경으로 범위가 사라지면 차단한다.

Mac `update`는 실제 등록된 설정을 읽고 새 런타임/연결 프로그램 검증을 마친 뒤 기존의 launchd 교체·복구 절차를 사용한다. 원격 연결은 사용자 요청 시에만 시작하며 실패 시 이전 프로젝트 화면을 먼저 제거하지 않는다. 웹 배포만으로 실제 Mac 업데이트를 완료했다고 보고하지 않는다.


## 2026-10-18 Remote project checks and revision continuity (Issue #44)

Diagnosis: model replies could describe local terminal steps as the user's next action; follow-up jobs always checked out the default branch even when earlier changes remained in an unmerged PR. A ready screen only established HTTP readiness, not passing tests or working external integrations.

Compared official `nodejs/node` (Node 24.19.0, primary MIT license plus bundled notices; maintained 2026-10-18), `microsoft/playwright` (installed 1.64.0, Apache-2.0; maintained 2026-10-17) and `testcontainers/testcontainers-node` (MIT; repository evaluated, maintained 2026-10-14). Reuse Node's built-in test runner or the repository's declared test/lint/typecheck/check scripts inside the existing local Docker boundary. Keep Playwright for Jarvis browser regression; do not install browsers or pretend arbitrary target repositories have browser tests. Defer the additional Testcontainers dependency: existing Docker process control already supplies isolation and cleanup. No new paid service or credentials. Source copies stay on the execution server; only the public Node image and integrity-checked public npm dependencies are downloaded. Test summaries stay in the existing private Jarvis records, not public PR bodies.

Runner 2.4.0 advertises `remoteWorkVersion: 1`. Test-only jobs execute no model and publish no code. Both test-only requests and change requests collect actual command exit status in sanitized disposable non-root containers with no network, host mounts, provider credentials or install/pretest hooks. Outputs are bounded/redacted; missing setup, zero tests and unavailable Docker remain not-run. Each command is bounded to five minutes and containers/images are cleaned after success, failure or cancellation. This is Node automation, not real external AI, microphone, native-app or production-service validation. Existing GitHub CI remains the merge gate; tests do not replace branch protections or enable absent workflows.

A browser selects the latest recorded unmerged change by default, or explicitly selects the default branch. Source references are confined to the same project/service/repository and gated from old runners. The runner revalidates the exact PR head, branch, base branch, repository and open/merged state. Preview/test/questions use that revision; further edits reuse the original PR without force push. Changed or closed source PRs stop with a useful error; already merged selections use the current default branch. Earlier model replies are accompanied by observed outcome, checks and revision evidence. The model's top-level workflow instructions keep routine execution on the server and direct the user to Jarvis actions.

Web publishing does not replace a runner already installed on a user's Mac. Existing installations need the scope-preserving installer update once for 2.4.0. After setup, routine code/test/screen requests originate in the browser. Real user Mac/Cloudflare/provider readiness remains distinct from synthetic local verification.

Validation: lint/typecheck/production build passed; automation 49, domain 44, desktop/mobile/storage 102 and the real HTTPS two-browser preview test passed. Actual Docker exercised successful and failing project commands, disabled pretest hooks, absent host credentials/network and unchanged checkout. Local Supabase exercised source selection, capability gating, failed-check persistence and device fencing alongside existing private storage regressions. An initial container supervisor file-permission failure was corrected and the actual Docker test rerun successfully. No production database, user project, provider/model or business-service calls were used for tests. User Mac installation, live Cloudflare connectivity and real target-app AI behavior remain unverified.

## 2026-10-18 Silent Mac update and misleading queue status (Issue #46)

Small bug repair; no new package comparison or dependency is needed. Node 24 resolves ESM module URLs through symlinks while retaining the invoked argv path. Both executable guards now use built-in filesystem realpath, including the macOS `/tmp` → `/private/tmp` case, and stay inert on import. A subprocess regression reproduced the old empty-success exit before the fix and checks direct, directory-symlink, file-symlink and import-only execution. Runner runtime is 2.4.1; the signed-in CLI/provider and scope-preserving installer workflow are unchanged.

The server previously fabricated runner version 2.0.0 on contact. Claim responses now persist one version/capability observation, within the requested space/project scope, and immediately update changed capabilities without waiting for the heartbeat throttle. Missing versions remain unknown; work heartbeats do not overwrite the observation. Cloud reconciliation treats the observation atomically. Existing 2.4.0 capabilities remain sufficient to claim work. The installed Next 16.4 Route Handler guide was consulted. No migrations, access changes, paid services or production-data tests are required.

The UI distinguishes queued from running previews/tests and explains connected-but-unsupported requests, disabled previews, unknown capabilities and absent recent contact. The setup page distinguishes file download, LaunchAgent registration and actual runner contact. Saved requests are preserved rather than cancelled or recreated. User Mac installation and real target-app/provider readiness require their own observed results.

## 2026-10-18 Remote preview startup evidence (Issue #48)

The failed preview path discarded all exception details and labelled failed remote attempts as legacy Mac addresses. Installation/contact therefore could not explain whether a failure occurred during image build, app startup, server configuration, provider provisioning, edge registration or public HTTP readiness. This small repair reuses Node 24, Next 16.4 and pinned official cloudflared 2026.10.1; no new package or access policy is introduced. Realpath entry checks also tolerate imports from stdin.

Tunnel hostname allocation precedes a usable edge connection. Startup now waits for the provider's registered-connection event, allows automatic QUIC/HTTP2 fallback, and bounds registration to 90 seconds. Public readiness waits five seconds before its first DNS lookup, then gets a separate 90-second deadline instead of twelve fast failed requests. A transient provisioning failure has one bounded retry; cancellation and exited processes stop startup. Errors retain allowlisted stages, symbolic codes and numeric HTTP/exit statuses, never raw provider output or secrets. Failed previews have no link and no fabricated legacy-address/update instruction. Older generic failures remain historical records with unavailable detail.

Ordinary CI remains synthetic with mocked external transports. An explicit label or workflow dispatch runs a separate live-provider check on Linux and macOS, using only an ephemeral synthetic HTTP app, generated test keys and the hash-verified official binary. It checks real HTTPS browser entry, writes/reload, copied-link denial and revoked-viewer denial. No production API/database, user repository or model is used by this check. The original Linux live-provider path passed; that does not identify the specific network failure on a user's Mac. User-machine connectivity remains separately observed, not inferred from CI.

Live macOS diagnosis reproduced three failures where edge registration succeeded but immediate hostname lookups returned NXDOMAIN for the whole 60-second probe window; Linux resolved shortly afterward. Repeating the check with a five-second publication delay passed on both platforms, including actual browser entry, write/reload and revocation. The runtime now delays the first lookup and leaves time for slower negative-cache expiry. An experimental same-resolver DNS retry did not resolve the reproduction and was removed. TLS validation and the exact gateway-identity check remain mandatory. These observations explain the reproduced timing defect, not the precise historical user-machine failure, whose old record omitted details.

## 2026-10-18 Standalone Node previews (Issue #50)

A project without package.json was classified as static whenever it had public/index.html, even with a root Node server. The page shell therefore loaded while its API calls returned 404. Runtime 2.4.3 recognizes server.js/server.mjs/server.cjs before the static fallback and runs Node directly. Explicit npm scripts keep their existing priority and dependency-lock validation. This is a small compatibility repair using Node 24 built-ins and existing Docker/Playwright; no new package, provider or access scope. The installed Next 16.4 client-component guide was consulted for the setup text.

Standalone apps may initialize config or records relative to their own source directory. Only their already-sanitized source is copied inside the container's existing 256 MB tmpfs and run as the non-root node user. The image stays read-only; no host bind mounts, credentials, existing data, external network or source changes are introduced. Changes survive reload only within that temporary preview. Static and npm previews retain their previous execution paths.

The regression first reproduced the incorrect static classification. Actual Docker/browser checks cover API-backed initial rendering, app-local config creation, write/reload, private-data exclusion, unchanged source and container isolation, alongside the existing npm/SQLite flow. Screen/API readiness does not establish external model availability; local model services and provider credentials remain absent from isolated previews.

## 2026-10-18 Preview reuse and complete-path verification (Issue #52)

An audit found that retries could reuse a container created by an older preview runtime as long as the request and source commit matched. The regression reproduced this reuse before the fix. Runtime 2.5.0 labels containers with a hash of the installed preview module and only reuses an exact runtime match. Missing/changed identities rebuild only containers already fenced by the request's ownership label. Compatible containers continue to reuse; unrelated containers and source records are preserved. This small repair reuses built-in Node hashing and the existing Docker boundary without dependencies, services or access expansion.

The Docker regression now continues through the authenticated HTTPS gateway in an actual browser, including API-backed initialization, write/reload, copied-link denial and revoked-viewer denial. It fails on unexpected HTTP or browser errors. The same bounded local-only TLS fixture is shared with the existing two-browser test; production TLS verification remains unchanged. Ordinary CI uses only synthetic source/data. Separate live-provider checks cover Linux/macOS with a synthetic app. These checks establish their tested behavior, not a blanket guarantee for a user's machine or a connected model. The ready-screen message distinguishes screen-only execution from an explicitly selected subscription CLI.


### Subscription CLI preview connection (explicit user choice, Issue #52)

The user selected the existing subscription CLI for real translation. Compared official openai/codex (Apache-2.0, maintained 2026-10-18; installed CLI help 0.159.2), BerriAI/litellm (MIT outside separately licensed enterprise code, maintained 2026-10-18), and router-for-me/CLIProxyAPI (MIT, maintained 2026-10-18). Reuse official Codex exec with Node built-ins. LiteLLM adds a provider gateway/API configuration, while CLIProxyAPI adds separate credential/proxy handling; neither is needed for the existing signed-in local CLI. No package or API-key billing fallback is introduced.

CLI inference is explicit per preview request and gated by previewCliVersion 1. Old runners cannot consume such requests. A fresh CLI-only process uses ChatGPT login, ignores user config/rules, disables shell/execution/agents/web tools, runs read-only in an empty private temporary directory and returns only schema-validated text. API-key/workload logins are rejected. Input/output/time/concurrency/count are bounded; prompts and raw CLI diagnostics are not logged. Per-call temporary output is removed.

The app container stays offline and receives no CLI login files, host mounts or provider credentials. A loopback OpenAI-compatible text endpoint queues requests; the trusted host exchanges bounded messages via the existing docker-exec bridge and fixed private control routes, which are blocked publicly. Initial support is for standalone Node apps using a config.example.json profiles template. Only the disposable config is replaced with the CLI profile; source code, existing settings/records and the repository stay untouched. SSE compatibility delivers a buffered completion. The generated profile also routes profile-based correction through the same CLI.

Preparation runs a real Korean-to-Vietnamese greeting probe through the container queue and host CLI. Failure produces an AI-stage result without a ready link; success stores the bounded sample and verification time. After preparation, inference requires an active approved preview session and is checked before/after completion. Expiry/closure abort work; browser cancellation propagates to the app and inference signal. At most twenty queued calls per preview are allowed. CLI controls avoid pooled bridge sockets, and old workers are retired before reuse to prevent retry races.

Ordinary tests use synthetic source and a substituted model transport, never platform credentials or a paid/live model. Separate scoped local validation may execute authorized app source with no original data and a mocked model; it is not reported as real user-subscription validation. The actual subscription probe runs only on the user's installed Mac after they explicitly request a CLI preview.

## 2026-10-18 Window-sized workspace layout (Issue #54)

The shell's 1,570px content cap produced large unused gutters on wide displays, and the sheet work area stopped growing at 1,000px height. Remove those two caps, retain 32px desktop side padding and the existing 24px/tablet and 16px/mobile gutters, and use 80dvh for the desktop sheet area. Footer alignment follows the same available width. The existing compact and stacked layouts, table scrolling, saved cell dimensions and question-panel collapse remain in place.

This is a small CSS layout repair: keep the installed Next 16.4 CSS Modules approach without adding a library, dependency, storage format or service. The installed CSS guide was consulted. Local lint/typecheck/build and all 94 browser checks passed. Direct measurements at 1440–3840px desktop widths confirm expansion; at 3840×2160 the sheet area measures 3544×1728 with 32px side gutters. At widths 320 and 760, 16px gutters remain without page overflow. All validation uses disposable browser profiles and synthetic data.

## 2026-10-18 Automatic runner project discovery (Issue #56)

Root cause: installation copied the then-current project IDs into a fixed local list. A server-side scope correction reuses the existing authenticated claim/CAS queue instead of introducing another scheduler, service or package. Supported Codex work callers default to current projects in the requested space; legacy IDs become discovery hints, so removed IDs and more than twenty current projects no longer prevent discovery. Explicit `projectScope: selected` API callers and inspection-only clients retain the selected-project contract. Owner/device authorization, requested space, per-job scope/lease and capability gates remain authoritative.

The deployed 2.5.0 runner already sends the required protocol and accepts scoped returned jobs, so public runtime/installer files remain unchanged. New configuration downloads use `[null]` as a compatible placeholder; the server resolves current project IDs. A selected project in the UI does not narrow the downloaded area configuration. Valid work/inspection heartbeats refresh discovered presence. Document heartbeats use a matching observed project service; without one, presence waits for the next claim rather than borrowing another project's capabilities. Legacy observed work connections are upgraded on valid activity; explicitly selected observations do not propagate. No production schema or authentication policy change is required. Next 16.4 Route Handler and Client Component guides were consulted.

All 51 synthetic domain checks and the actual disposable Auth/RLS/HTTP suite passed locally. Coverage includes new/deleted and 25+ projects, retained selected scope, the unchanged 2.5.0 request contract, concurrent claims, rejected/stale device heartbeats and all three queues. Browser checks retain downloadable configuration and saved/reloaded statuses. Real-user readiness is established separately by read-only observations after deployment; no model or production test records are used for CI.


## 2026-10-19 — Preview app compatibility and source-module preservation (Issue #58)

The optional app-inference adapter rejects unsupported package/configuration shapes before invoking Codex. The UI previously described this like a login/quota failure, even while the Jarvis runner was online. Stored diagnostic codes now select the accurate explanation without rewriting historical records. An explicit screen-only retry preserves the selected revision and uses no inference opt-in; request labels report the selected CLI mode without claiming that a call occurred.

Both the work checkout sanitizer and preview copier previously excluded every `data` directory, including imported application modules under `src/data`. Runtime 2.5.1 retains only JS/TS module extensions in that source location. Other data locations, JSON/CSV/database files, sensitive names, customer/upload folders and traversal paths remain excluded. A real selected-app check additionally reproduced Vite failing with EROFS when bundling its configuration under `node_modules/.vite-temp`. The official Vite configuration documentation confirms this cache path. Vite previews receive only a 16 MiB, non-executable tmpfs at that path, owned by the unprivileged Node user; application files stay read-only, the runtime stays offline, and the total container memory limit is unchanged. A synthetic Docker executable exercises the same startup write and verifies writes elsewhere still fail. No target-app repository, authentication boundary, inference adapter or dependency is added. This is a small repair using the existing Node/Docker/React paths; external framework comparison is unnecessary. The installed Next 16.4 Client Component guide was consulted.

The new source-filter check and historical-result desktop/mobile workflow reproduced the failures before the fix. Synthetic regression covers both sanitizers, rejection before build/inference, explicit model-free retry with source/history/reload preserved, and a real Docker app importing its retained source module while stored JSON remains absent. Selected private-source validation stays local and separate from synthetic CI; screen rendering is not evidence of a real subscription response. Final CI/deployment observations are recorded in the linked PR.


## 2026-10-19 — Connected project lifecycle release check (Issue #60)

The prior release checks exercised browser registration, server persistence, runner execution and Docker rendering separately. Some server tests injected a completed preview result, leaving no single check that a browser-created project reached a real running app. The required local Auth/DB suite now runs browser project/repository registration, discovery by an already paired runner with stale configured IDs, an actual Git checkout, the Codex argument/output contract with a synthetic answer, a resumed runner client, real Docker execution, the actual tunnel subprocess protocol, server-persisted results, the real preview-open signer, authenticated HTTPS and temporary app write/reload. It also rejects copied URLs, a revoked viewer, provider outage and another space. Result arrival is observed through normal browser polling before reload recovery. No ready result is injected for this flow.

GitHub metadata, model output and the external tunnel network use synthetic fixtures. A loopback-only TLS/CONNECT fixture supplies the actual remote HTTP contract; its CA is trusted only by the disposable test server. Unexpected outbound requests fail closed. Production identities, private source and paid model calls are excluded. Existing separate checks remain useful for selected PRs, cancellation, retry, capability/version gates and other execution recipes. A real static Docker case now verifies module loading and browser persistence. The existing Node/Playwright/Supabase/Docker stack supplies the missing integration test without new dependencies or authentication policy changes. The external Linux provider check passed, but macOS reproduced ENOTFOUND from system getaddrinfo while direct DNS/DoH returned published addresses. Runtime 2.5.2 queries configured DNS directly for the narrowly scoped macOS HTTPS health probe, preserving hostname/SNI, certificate verification, bounded response size and no redirects. It avoids priming the OS negative cache. Official Node DNS documentation distinguishes lookup/getaddrinfo from resolve queries. A real TLS regression verifies direct resolution and rejects an untrusted certificate; both external platform checks must pass for the final release.

The audit reproduced a separate UI defect: a project without a GitHub repository reported CLI connection waiting while requests were disabled. Desktop/mobile regression failed before the repair. It now explains the missing repository and opens the existing scoped registration form directly. Existing-repository registration remains distinct from creating a GitHub repository, which is not implemented. The supported workflow, required checks and physical-device/live-model boundaries are recorded in PROJECT-LIFECYCLE.md. Exact CI and deployment outcomes belong to the PR work record.

## 2026-10-19 Issue #62 — 프로젝트 자동 준비

공식 `openai/codex`(Apache-2.0), `vercel/vercel`(Apache-2.0), `supabase/cli`(API 메타데이터/루트 LICENSE로 라이선스 확정 못함; 코드/의존성 채택 안 함)를 비교했다. 세 저장소 모두 최근 갱신·비아카이브 상태를 확인했다. 기존 Codex exec와 gh 로그인·작업 lease를 확장하고 새로운 에이전트 프레임워크/App Server 의존성은 추가하지 않는다. Vercel CLI 63.1.2/Supabase CLI 2.120.0의 추가 설치나 사용자 인증 파일 추출 대신 공식 REST 계약을 사용한다. 현재 공식 Supabase generated OpenAPI의 `organization_slug`, 조직 상세 `plan`, 프로젝트 상태, api-keys reveal, query 계약 및 Vercel 공식 프로젝트/팀 조회 코드를 확인했다. Supabase 생성 `plan` 인자는 무시되므로 조직 무료 상태 확인으로 대체했다.

신규 앱은 기본 Node 24·무의존성 starter로 시작한다. 실제 격리 테스트에서만 GitHub 커밋 상태를 생성해 추가 workflow 토큰 권한 없이 기존 보호/외부 검사와 함께 병합을 판정한다. 클라우드 계정이 없으면 맥미니로 진행한다. 관리 토큰은 기존 서버 키를 도메인 분리해 AES-GCM으로 보관하며 소유자·영역·공급자를 바인딩한다. 백업·모델·Git에는 넣지 않는다. 새로운 운영 DB 마이그레이션/유료 계정/실제 외부 테스트 자원 생성은 없다. 신규 관리 앱의 SQLite 데이터만 프로젝트 volume에 유지한다.

등록부터 두 번의 코드 변경·실제 Docker 검사·서명된 HTTPS·저장값 유지까지 연결된 로컬 테스트를 추가했다. 자동 업데이트는 검증된 별도 런타임, IPC 작업 경계, 활성 화면 대기, 실제 시작 확인과 이전 버전 복구를 사용한다. 실제 Mac 및 구독 응답·신규 클라우드 계정 자원 성공은 합성 검사와 분리한다. 정확한 최종 CI와 배포 커밋은 PR에 기록한다.

최종 외부 공급자 검사에서 Linux/macOS 모두 edge 연결 후 90초 동안 DNS 미게시를 재현했다. 진단은 터널 종료 후가 아닌 활성 연결 중에도 기록하도록 고쳤다. 외부 화면의 DNS/health 준비 한도는 180초로 늘리되 정확한 gateway 응답과 TLS 검증을 계속 요구하며, 영구 DNS 실패·취소·다른 gateway는 성공 처리하지 않는다. 125초 DNS 지연 회복과 180초 한도 종료를 회귀 검사한다. 이 변경만으로 외부 공급자의 장애가 해결됐다고 판단하지 않으며 실제 양 플랫폼 검사 결과를 별도로 기록한다.

후속 검사에서 동일한 주소 파싱과 공식 2026.10.1 바이너리로 Linux/macOS 실제 접속·저장·재접속·기기 취소가 모두 통과했다. 실패 시에는 권한 DNS와 별도 재귀 DNS도 함께 진단한다. DNS 확인이 끝내 실패한 개별 주소는 이전 터널과 gateway를 닫은 뒤 새 주소·새 gateway ID로 한 번만 다시 준비한다. 취소·만료 임박·TLS/identity 실패는 재발급하지 않는다. 두 번째도 실패하면 링크를 제공하지 않으며, 회복·영구 실패·취소·인증서 오류·기존 연결 정리를 회귀 검사한다. 실제 외부 공급자의 무중단을 보장하는 기능으로 표현하지 않는다.

## 2026-10-19 다중 기기 저장 충돌 복구 (Issue #64)

프로젝트/대화 선택이 양쪽 기기에서 달라지는 경우와, 최초 작업 저장 확인이 유실된 사이 실행기가 같은 요청을 가져가는 경우에 불필요한 내용 충돌이 재현됐다. 기존 기준본 기반 병합을 유지하되 선택 충돌은 현재 기기의 선택을 보존하고, 동일 ID·요청·실행 범위의 최초 대기 요청만 서버의 원자적 실행 기록으로 받아들인다. 연결된 할 일의 최초 진행 전환도 함께 보존한다. 취소·재시도·변경된 요청은 이 예외에 포함하지 않는다. 새 동기화 라이브러리는 도입하지 않았다.

검토 화면에 최신 서버 기록과 다시 비교하는 동작과 충돌 종류를 표시한다. 이 동작은 저장 대기를 삭제하거나 충돌 우선순위를 임의로 선택하지 않는다. 기준본 없는 이전 저장 대기와 실제 내용 충돌은 검토를 유지한다. 사용자 휴대폰의 IndexedDB는 원격에서 읽거나 변경하지 않았으며, 특정 기기의 충돌 종류는 재비교 결과로 확인해야 한다.

검증: 두 원인에 대한 실패 재현 후 도메인 회귀 검사, 별도 브라우저 컨텍스트의 동시 선택/저장, 응답 유실 뒤 이미 실행 중인 요청의 중복 방지, 실제 충돌의 검토 유지, 재비교 후 대기 입력 보존을 검사한다. 맥미니 실행기 업데이트 없이 웹 배포로 적용한다.

## 2026-10-19 최근 확인 코드의 화면·후속 요청 선택 (Issue #66)

- 원인: 화면 준비와 AI 요청란이 매번 `latest`로 초기화되고 마지막 `change/pr_open` 기록만 선택했다. 그 뒤 기본 브랜치에서 새 화면 준비가 성공해도 과거 PR이 최신 결과를 가리고 다음 요청의 source가 됐다. 저장된 PR 결과는 GitHub의 현재 상태가 아니다.
- 수정: 같은 프로젝트·서비스·저장소에서 최근 성공한 화면 준비/자동 검사 기준으로 기본 선택을 계산한다. 더 최근 PR 수정이나 사용자의 명시적 선택은 유지하며 실패한 준비를 성공 근거로 삼지 않는다. 기본 브랜치 화면 뒤의 후속 수정은 과거 PR source/followLatest를 다시 붙이지 않는다. PR 상태 오류에는 기본 브랜치로 새 화면을 준비하는 직접 동작을 제공한다. 과거 작업 결과와 실패 기록은 수정하지 않는다.
- 검증: 수정 전 모바일 브라우저에서 `main` 대신 `latest`가 선택되는 회귀를 재현했다. 기본 브랜치 최신 화면·열기 링크, 반복 새로고침, 후속 요청 source, 명시적 PR 선택, 오류 복구와 구독 CLI 보존을 데스크톱/모바일에서 검사한다. 범위 격리·실패 결과·이후 PR 수정은 도메인 검사로 확인한다. 실제 기기의 브라우저 조작이나 PR 병합 상태의 자동 동기화를 대신 검증한 것은 아니다.
- 기존 React/도메인 도구만 사용한 버그 수정으로 외부 후보 비교는 생략했다. 실행기·기기 승인·운영 데이터/스키마 변경은 없다.

## 2026-10-19 설치된 로컬 LLM 통역 (Issue #68)

- 사용자가 구독 CLI 지연 때문에 맥미니에 설치된 LLM으로 통역 전환을 요청했다. 기존 Ollama의 고정 loopback API와 TranslateGemma를 재사용한다. 기존 CLI 경로는 비교·선택용으로 유지하며 MLX 신규 런타임/모델 다운로드는 비용·설치 부담 때문에 보류했다. 새 패키지를 도입하지 않는다.
- 실행기 2.7.0의 명시적 `previewLocalVersion` 역량으로 로컬 요청을 배정한다. 미리보기 앱/브라우저는 호스트 주소·모델·관리 API를 선택할 수 없으며 기존 인증된 큐·취소·권한 재검증을 거친다. Ollama는 호스트 127.0.0.1:11434의 모델 목록과 텍스트 추론만 사용한다. 컨테이너 네트워크 차단·비밀 제외·외부 포트 비공개를 유지한다.
- 설치된 `translategemma:4b`와 실제 번역 샘플을 확인한 뒤에만 로컬 준비 완료를 기록한다. 구독 CLI/유료 API/다른 모델로 자동 대체하지 않는다. 로컬 경로는 동시 추론 1개, 미리보기당 200개 요청으로 제한하며 구독 경로의 기존 20개 한도는 유지한다. 고정 모델 완료 응답을 큐로 전달하므로 토큰 단위 실시간 중계는 이번 변경에 포함하지 않는다.
- 실제 맥의 설치 기록은 과거 기록이며 현재 모델 재확인은 실행기의 준비 결과가 필요하다. 기존 2.6.0 자동 업데이트는 활성 미리보기 종료와 점검 간격의 영향을 받으므로 웹 배포만으로 맥 적용 완료라 하지 않는다. 합성 모델 검사·Docker 연결 검사를 실제 모델 성능 측정과 구분한다.
# 2026-10-20 프로젝트 단계·저장소 없는 기획

공식 `openai/codex`(Apache-2.0), `statelyai/xstate`(MIT), `react-hook-form/react-hook-form`(MIT)의 유지보수·라이선스를 확인했다. 기존 Codex completion 계약과 React 폼을 재사용한다. 세 단계와 소수의 임대 상태를 위해 XState·폼 프레임워크 의존성을 추가할 이득이 작아 두 라이브러리는 보류한다. 새 외부 데이터 전송·유료 API·클라우드 자원을 도입하지 않는다. 설치된 Next 16.4 Route Handler/Client Component 문서를 확인했다.

단계는 선택 필드로 추가해 기존 저장본을 변경하지 않고 개발로 해석한다. 기획 문서와 기획 전용 요청을 같은 프로젝트에 보관하며 GitHub 의존성을 제거한다. 문서 버전이 달라진 AI 응답은 제안으로 남겨 직접 편집을 보존한다. 임대·취소·재전송·백업 복원과 다중 기기 병합은 기존 인증·CAS 저장을 따른다. 개발 전환 때 정확한 기획 문서/버전을 전달하고 새 자동 준비는 맥미니를 선택한다. 로컬 직접 실행과 운영 전환은 이번 1단계 범위에 넣지 않는다. 실제 Mac 적용·구독 응답은 CI 합성 결과와 구분한다. 상세 검증은 연결된 PR과 PROJECT-STAGES.md에 기록한다.


## 2026-10-20 개발 작업 공간과 로컬 실행 (Issue #72)

공식 GitHub 후보를 비교했다. `apple/container`(검토 릴리스 1.6.0, Apache-2.0, 2026-10-19 갱신)는 macOS/Linux VM 격리에 유용하지만 Apple silicon·OS 조건과 이미지 준비가 추가되어 이번 직접 프로세스 요구에는 도입하지 않는다. `Unitech/pm2`(검토 릴리스 v7.0.4, AGPL-3.0, 2026-10-19 갱신)는 프로세스 관리에는 적합하지만 파일/네트워크 격리·Jarvis 기기/임대 범위를 제공하지 않고 별도 데몬과 라이선스 검토가 필요해 보류한다. 기존 `cloudflare/cloudflared`(Apache-2.0, 검토 시 2026-10-19 갱신)는 설치된 고정 2026.10.1 바이너리와 해시 검증·사설 티켓 게이트를 재사용한다. 신규 계정·유료 서비스·패키지는 추가하지 않는다. 이미지/앱은 승인된 Jarvis 기기와 기존 사설 저장소·Cloudflare 전송 경로를 이용하고, 수정용 사진은 요청에 선택한 구독 CLI에 전달한다. GitHub에는 올리지 않는다.

실행기 2.9.0: macOS Seatbelt(`sandbox-exec`)로 정제한 프로젝트 사본·별도 HOME/tmp·프로젝트 DATA_DIR·고정 loopback 포트만 허용한다. 호스트 자격증명과 다른 프로젝트, 인터넷·Ollama 관리 포트는 허용하지 않는다. OS 격리가 실패하면 호스트 무격리 실행으로 전환하지 않는다. 다른 OS의 기존 Docker 격리 경로는 유지하며 결과에 실행 방식을 기록한다. Docker는 Mac 설치 필수 조건에서 제외한다. 기존 Docker 영속 데이터가 있는 프로젝트는 한 번만 정지·읽기 전용 원본 복사로 이관하고 원본 볼륨은 유지한다. 이관을 확인하지 못하면 새 빈 데이터로 시작하지 않는다.

프로젝트/저장소·코드 SHA·AI 설정이 같고 응답이 정상인 서버는 재사용한다. 잠금 파일과 Node/아키텍처별 프로젝트 전용 의존성 캐시를 재사용하며 시작할 때만 빌드한다. 서버는 최대 3개·2시간이며 실행기가 끝나면 종료된다. 새 요청에는 새 범위의 서명 게이트를 발급해 과거 작업 티켓이 새 작업을 열 수 없도록 한다. 새 탭으로 다시 열기는 기존 결과를 사용하므로 새 작업/CLI 호출이 없다. 재시작·종료·로그는 프로젝트 요청과 같은 승인 기기·임대·취소 규칙을 따른다. 테스트는 앱과 별도 정제 사본에서 macOS 격리 실행하며 실제 종료 코드와 실행 로그를 보고한다.

데스크톱은 화면·개발 대화를 나란히, 좁은 화면은 화면/대화/검사 탭과 함께 보기를 제공한다. iframe은 서명한 일회용 티켓·Partitioned 쿠키·Jarvis origin만 허용하는 CSP를 사용한다. 브라우저의 타사 저장 제한 시 새 탭 경로를 유지한다. 마이크/카메라는 앱 권한으로 요청한다. WebSocket도 동일 기기 인증·Origin·내부 경로 차단·폐기 검사 뒤 중계한다. HTTP 응답은 스트림을 그대로 전달한다. 실제 사용자 마이크 권한이나 외부 통신 품질을 합성 CI로 확인했다고 주장하지 않는다.

사진은 최대 3장, 각 1600px/1MB JPEG로 다시 인코딩해 메타데이터를 제거한다. 기존 IndexedDB·사설 버킷에 원자 저장하고 요청에 ID/hash를 고정한다. 임대를 소유한 실행기만 현재 요청의 원본을 받아 크기/hash를 다시 확인하고 `codex exec --image`로 전달한다. 이미지가 전송 중이면 대기하고 다른 원본으로 대체하지 않는다. CLI 종료 뒤 임시 사본은 삭제한다. 구버전은 사진/서버 제어 요청을 가져가지 않는다. 운영 클라우드 신규 생성은 후속 3단계다.

macOS 테스트가 `listen(0)`으로 임시 HTTP 서버를 실행할 때도 다른 호스트 서비스/Ollama에 접근해서는 안 된다. 테스트별 사전에 확보한 16개 loopback 포트만 Seatbelt에 허용하고 Node preload가 임시 포트를 이 풀에 배정한다. 테스트 프로세스 간 포트 임대는 전용 임시 폴더의 원자 mkdir로 구분한다. 전체 loopback/인터넷 허용으로 완화하지 않는다. 다른 고정 포트를 요구하는 검사는 실패 로그로 표시한다. 새 Mac 프로젝트 준비에서도 Docker 필수 검사와 불필요한 운영 클라우드 계정 조회를 제거한다.

기존 Docker 데이터의 첫 이관에서만 고정 공식 Node 이미지가 없으면 받아 읽기 전용 원본 볼륨을 복사한다. BuildKit의 FROM 캐시는 실행 가능한 이미지 태그와 다르므로 태그의 존재를 별도로 확인한다. 복사 컨테이너는 네트워크·루트 쓰기를 차단하고 두 프로젝트 데이터 경로만 마운트한다. 비공개 파일 읽기와 호스트 사용자 소유권 복원에 필요한 DAC_OVERRIDE/CHOWN만 추가하며, 원본 볼륨은 덮어쓰지 않는다. 신규 Mac 프로젝트와 이관 이후의 서버/검사는 Docker가 필요 없다.

Cloudflare의 현행 공식 문서 `cloudflare/cloudflare-docs/production/src/content/docs/tunnel/get-started/quick-tunnels/index.mdx`는 Quick Tunnel의 SSE 미지원을 명시한다. 따라서 원격 HTML에 선행 로드한 전송 어댑터가 동일 origin의 fetch/EventSource만 처리하고, 맥의 실제 SSE 응답을 최대 4개·32 MB 스트림으로 유지해 승인 세션에 묶인 짧은 JSON 조회로 전달한다. 읽지 않으면 backpressure로 멈추고, 취소/30초 미조회/승인 폐기/만료 시 원본 요청도 종료한다. 인증 쿠키는 앱이나 JSON에 노출하지 않는다. 다른 origin의 요청은 바꾸지 않는다. 원시 SSE를 임시 주소에서 지원한다고 주장하거나 새 클라우드 계정 설정을 요구하지 않는다.

검증 경계: macOS 14 실제 Seatbelt 프로세스로 서버 재사용·버전 교체·데이터·종료/재시작·다른 프로젝트/임의 포트 차단, 별도 HTTP 테스트, 의존성 캐시와 합성 AI 연결을 검사했다. 로컬 실제 사설 Supabase와 브라우저에서 사진 저장→임대 원본 확인→실제 CLI 이미지 인자→사본 삭제→재열기를 확인했다. Cloudflare 실제 임시 터널도 macOS/Linux 양쪽에서 스트림 첫 청크/후속 청크·WebSocket 왕복·서명 입장·복사 링크 거부·승인 폐기를 통과했다. 외부로 내보낸 앱/키/내용은 합성 자료이며 운영 사용자 데이터와 유료 모델은 쓰지 않았다. 실제 사용자 Mac의 2.9.0 적용과 휴대폰 마이크 권한/앱 기능은 이 검사 결과와 별도다.

사진 비공개 경계는 모델 지시 외에도 게시 직전 검사로 보강한다. 변경 파일의 원본 바이트와 인라인 base64가 첨부 사진 hash와 같으면 commit/push 전에 중단한다. 이미지는 비공개 원본과 CLI 임시 입력으로 보관하며, 코드 사본에 복사한 합성 모델을 사용해 실제 Git 게시가 차단되는 것을 검사한다.

명시적으로 개발 단계인 프로젝트는 기존 GitHub를 연결한 경우도 로컬 실행·프로젝트 DATA_DIR을 기본으로 사용한다. 과거 Vercel 배포가 관측되어도 개발 서버 대신 운영 화면을 고르지 않는다. 이 실행/검사/수정 요청은 2.9.0 역량이 있는 실행기를 기다린다. 단계가 없는 이전 레코드의 배포 바로가기와 이미 연결된 운영 자원은 유지한다.

서버 재사용은 SHA·AI뿐 아니라 영속 데이터 사용 설정도 같을 때만 허용한다. 임시 실행은 프로젝트 영속 데이터 폴더를 읽도록 허용하지 않는다. 영속 데이터에 쓰는 두 앱 버전이 동시에 실행되지 않도록 의존성/빌드를 먼저 준비한 뒤 이전 서버를 종료하고 새 서버를 시작한다. 빌드 실패 시에는 이전 서버를 유지하며 데이터 폴더는 어떤 종료 경로에서도 지우지 않는다.

WebKit 브라우저 회귀에서 Blob 원본을 IndexedDB에 직접 쓰면 오류 뒤 저장 트랜잭션 완료가 오지 않는 현상을 실제로 재현했다. 파일 바이트 변환을 트랜잭션 전에 마치고 기존 v1 files 저장소에 ArrayBuffer/type/size를 원자 저장한다. 기존 Blob은 그대로 읽고 새 바이트도 Blob으로 복원한다. DB 초기화나 스키마 이관은 없으며 기존 백업·동시 저장·롤백 검사를 유지한다. 사진 첨부→저장→새로고침 회귀를 WebKit 휴대폰 프로젝트로 CI에 추가했다.

## 2026-10-20 맥미니 없는 운영 전환 (Issue #74)

공식 GitHub의 `actions/runner`(MIT), `vercel/workflow`(Apache-2.0), `temporalio/sdk-typescript`(MIT)의 라이선스·현행 유지보수를 확인했다. 이미 사용하는 GitHub Actions/표준 Ubuntu/Node 24를 채택해 장기 연결과 새 유료 서비스를 추가하지 않는다. Vercel Workflow SDK는 추가 플랫폼 설정·의존성과 인증 연결, Temporal은 별도 워커/운영 계층이 필요해 이번 범위에서 보류한다. 앱 코드를 실행하는 CI와 승인된 제공자 API를 호출하는 배포 워커를 구분한다. 워커는 관리 토큰 없이 암호화된 단기 단일 작업 grant로 서버의 현재 기기/영역/프로젝트/nonce/lease를 재확인한다.

설치된 Next 16.4 Route Handler 문서, GitHub 공식 REST OpenAPI의 workflow dispatch(ref/inputs/return_run_details, API 2022-11-28), Vercel 공식 `https://openapi.vercel.sh`의 v11 프로젝트와 v13 배포(gitSource SHA·Express enum·환경변수·alias)를 확인했다. 새 npm 의존성·호스팅 계정·과금 전환 없이 기존 사설 저장소와 provider vault를 확장했다. GitHub 인증은 앱에서 영역별로 한 번 연결하며 클라우드 개발 환경의 인증을 서비스로 복사하지 않는다.

고정 SHA와 GitHub 검사, 무료 계정의 실제 accountId/조직/저장소 바인딩을 확인한다. 기존 운영 환경을 자동 발견하되 DB 정체가 불명확하면 새 빈 DB로 바꾸지 않는다. 새 DB에 한해서 불변 마이그레이션을 트랜잭션/잠금/hash 이력으로 적용하고 기존 DB 자료와 스키마는 보존한다. 관리 키는 코드/워크플로/브라우저에 주입하지 않는다. 생성 의도를 먼저 저장하고 응답이 불명확하면 정체 조회 후 복구하며 중복 생성으로 덮지 않는다. 일반 클라이언트 저장은 배포 상태를 작성할 수 없다. 전체 계약과 검증 경계는 PROJECT-OPERATIONS.md를 따른다.

공개 Actions 입력은 계정 권한으로 취급하지 않는다. GitHub 공식 OIDC discovery 문서에서 RS256, 고정 issuer/JWKS와 workflow_ref/ref/repository/run_id/aud/exp/nbf 계약을 확인하고, 워커 호출에 해당 main workflow 실행의 OIDC 서명을 추가 검증한다. grant는 이벤트 파일에서 읽어 Actions의 env 출력에 노출하지 않으며, 원본 기기 승인과 작업 nonce/임대도 계속 검사한다.

## 2026-10-20 macOS 격리 사전 검사와 기존 프로젝트 단계 (Issue #77)

실행 파일 설치 디렉터리만 허용한 정책은 Homebrew처럼 외부 디렉터리의 dylib를 사용하는 Node 배치에 불충분하다. Node 24 공식 diagnostic report의 sharedObjects를 사용해 신뢰한 실행기가 이미 로드한 Mach-O 파일의 실제 경로만 읽기 허용한다. 경로별 바이너리 헤더를 검사하고 상위 Homebrew/사용자 디렉터리 전체, 쓰기, 외부 네트워크 권한은 추가하지 않는다. 설치된 Node 외의 새 런타임/의존성은 설치하지 않는다. 사전 검사 실패의 종료 코드와 종료 신호를 연결 진단에 남기며 원래 출력은 프로젝트별 비공개 서버 로그에서 확인한다.

검증은 별도 dylib에 링크한 실제 macOS 실행 파일로 기존 정책의 로더 실패와 파일별 읽기 허용 후 성공을 재현하고, 같은 디렉터리의 원본 파일 접근 차단을 확인한다. 사용자 화면의 공통 실패 코드만으로 특정 원인을 확정하지 않으며 실제 서버 로그와 이 합성 검증을 구분한다. 기존 프로젝트는 표시상 기본 개발 단계와 내부의 미설정 값을 구분한다. 프로젝트 수정에서 개발 단계를 명시할 수 있고, 이 동작은 이름 초안·기록·연결을 보존하며 저장소 생성/AI 작업을 시작하지 않는다.
