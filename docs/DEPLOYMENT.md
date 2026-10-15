# 미리보기 배포와 진단

2026-10-15 이후의 기본 방침: 사용자는 앞으로 개발 작업을 GitHub를 통해 진행하기로 했다. 작업 브랜치/PR과 검증 기록을 남기고 GitHub에 기록된 소스 revision에 배포 결과를 연결한다. 아래 working-tree 배포는 이전 배포 문제를 해결한 경로이며, 이후 미커밋 작업을 GitHub 기록 없이 배포하는 기본 절차로 사용하지 않는다. 코드가 GitHub에 있는 것과 실제 배포에 반영된 것은 별도로 확인한다.

## 현재 개발 배포 방침

2026-10-15 사용자가 작업 브랜치 push/미리보기에 이어 main 병합과 프로덕션 배포도 명시적으로 승인했다. 개발 중인 합의된 코드 변경은 관련 검증 → GitHub PR → main 병합 → 기존 Vercel 자동 production 배포까지 이어서 처리한다. 이 일상적인 코드 게시 단계를 매번 재승인받지 않는다. 새로운 비용·권한 확대·DB 활성화/마이그레이션·원본 업무 데이터 수정은 별도 범위다.

- 작업 PR의 최신 SHA와 CI 결과를 확인한 뒤 해당 revision만 병합한다. main merge commit과 Vercel production 소스 SHA가 같은지 확인한다.
- 자동으로 시작한 배포를 조회한다. READY 전에는 완료라고 보고하지 않으며 동일 소스의 수동 빌드를 중복 생성하지 않는다.
- 정식 주소는 https://jarvis-zeta-three-77.vercel.app 이다. 프로젝트의 production target 및 이 주소의 대상 deployment ID를 확인한다. preview는 기존 https://jarvis-preview-ai-report.vercel.app 을 유지한다.
- 현재 운영 저장은 비활성이고 기본 저장은 주소별 IndexedDB다. 같은 정식 주소의 기존 자료는 보존한다. 미리보기에서 만든 자료는 정식 주소로 자동 복사되지 않으므로 설정에서 백업→미리보기→병합으로 이관한다. 기존 자료를 삭제하거나 덮어쓰지 않는다.
- 기존 Vercel 보호와 운영 환경 변수·인증·DB를 변경하지 않는다. 보호 때문에 원격 화면/health 확인이 로그인으로 이동하면 앱 성공으로 오인하지 않고 한계를 기록한다.
- 실제 merge SHA·Vercel deployment ID·READY·CI·주소 확인 결과는 [PR #2](https://github.com/kjd1374/jarvis/pull/2)와 [Issue #1](https://github.com/kjd1374/jarvis/issues/1)에서 확인한다. 아래 ID들은 이전 배포의 이력이다.

## 2026-10-14 진단

Vercel 배포 이력은 모두 READY였고 최신 실패 기록은 없었다. 고정 미리보기는 이전 프로젝트 상세 버전(dpl_419SEhwyPWE4NEGCw3kfqBZQ7DWE)을 가리켰다. 최신 통합 업무실 변경은 로컬 미커밋 상태이고 origin/main도 caeb78a였다. 이전 작업의 배포 보류와 Git 소스 전용 헬퍼의 커밋·push 요구 때문에 최신 코드가 배포 대상에 포함되지 않았다.

클라우드 토큰은 이미 주입되어 있고 Vercel 프로젝트 읽기 요청이 성공했다. 새 토큰이나 권한 확대가 필요하지 않았다. Node 24의 공식 `--use-env-proxy` 옵션과 Vercel REST API를 사용해 기존 바인딩을 재사용한다. 실제 앱 빌드 오류와 배포되지 않은 상태를 구분한다.

## 이전 working-tree 미리보기 배포 경로

```sh
# 클라우드 환경에서 필요한 경우 먼저:
source /workspace/.setup/jarvis-env.sh
npm run test:deploy
npm run deploy:preview:plan    # 로컬 파일/크기/해시 확인, 네트워크 요청이나 배포 없음
npm run deploy:preview         # check → 현재 소스 업로드 → READY 확인 → 고정 미리보기 연결
# 대기 제한/연결 중단 뒤에는 새 빌드를 만들지 않고 이어서 확인:
npm run deploy:preview:resume
```

`VERCEL_TOKEN`은 환경의 보안 입력과 기존 `.vercel/project.json` 연결을 사용한다. 토큰 값은 명령줄 인수·파일·로그·채팅에 적지 않는다. CLI 로그인이나 Git push 없이 현재 작업 소스를 배포한다. 일반 로컬 PC에서도 같은 환경 변수와 기존 프로젝트 연결이 필요하다.

- 대상은 기존 kjd1374/jarvis 프로젝트와 `jarvis-preview-ai-report.vercel.app`이다. production 인수는 지원하지 않는다. 프로덕션 배포는 별도 승인 범위다.
- Next 공식 설정·기존 Vercel 프로젝트 설정을 그대로 사용한다. 환경 변수·인증 보호·DB 마이그레이션을 변경하지 않는다.
- 업로드 허용 목록은 src/public과 package.json·lockfile·Next/TS/ESLint/Node 버전 설정이다. 미커밋 소스도 포함한다. `.env*`, `.git`, `.vercel`, 업로드 파일, 대화·백업·프로필·테스트 산출물은 업로드하지 않는다. 심볼릭 링크나 비밀키로 의심되는 소스가 있으면 중단한다.
- 원본 파일과 경로의 SHA-256을 Vercel metadata에 기록하고 빌드 결과에서 비교한다. 실행 상태는 Git에서 제외된 `.vercel/jarvis-preview.json`에 저장한다. 자격 증명이나 파일 본문은 저장하지 않는다.
- 실패·대기 중에는 고정 주소를 바꾸지 않는다. 같은 프로젝트의 preview임을 검증하고 READY일 때만 연결한다. 빌드 중 다른 작업이 주소를 바꿨으면 그 변경을 덮어쓰지 않는다.
- Vercel 로그인 보호는 유지한다. 주소가 동일하므로 기존 IndexedDB 저장 공간도 동일하다. 파일 업로드 방식의 배포는 GitHub 코드 동기화를 대신하지 않는다.

## 로그와 재시도

명령 출력의 deploymentId로 Vercel의 해당 배포 Build Logs를 확인한다. `.vercel/jarvis-preview.json`에는 마지막 시도 ID·상태·소스 해시·이전 연결 대상이 있다. 배포 중단 뒤에는 resume으로 조회·주소 연결만 이어서 수행한다. 빌드 실패 원인을 고친 경우에만 새 preview를 만든다. 토큰/환경 변수 전체나 원본 배포 요청 본문을 로그로 덤프하지 않는다.

단위 검증 `npm run test:deploy`는 실제 배포 요청 없이 합성 파일을 사용해 미커밋 소스 포함·개인 자료 제외·심볼릭 링크/비밀키 거부·프로덕션/다른 프로젝트 주소 연결 거부를 확인한다. Vercel 공식 [Create Deployment](https://vercel.com/docs/rest-api/reference/endpoints/deployments/create-a-new-deployment), [Assign Alias](https://vercel.com/docs/rest-api/reference/endpoints/aliases/assign-an-alias)와 https://openapi.vercel.sh/ 계약을 확인했다. 새 SDK나 의존성을 설치하지 않았다.

## 실제 배포 검증

- 2026-10-14 `npm run test:deploy` 합성 검증 **4/4 통과**, `npm run check` lint·타입·Next 16.4.0 빌드 통과.
- 새 preview: `dpl_83Lty7xUrxVhcvc1Meivtg1YqccT`, Vercel **READY**. 현재 통합 업무실의 소스 65개 파일을 업로드했다.
- 고정 주소: https://jarvis-preview-ai-report.vercel.app
- 배포 소스 SHA-256: `f308956ea92183416d6b8bafa2abb4d3864f5e0e4e755ab353c96a77424dc624`. Vercel 배포 metadata와 로컬 업로드 해시를 대조한다.
- 프로덕션·GitHub main·Supabase DB/인증·운영 환경 변수는 변경하지 않았다. 고정 주소의 Vercel 로그인 보호를 유지한다.

검증 결과: 고정 주소의 deploymentId와 새 배포 ID가 일치하고, 배포 metadata의 소스 해시도 일치했다. 기존 production ID `dpl_Cw56Za6YTJhjYC11c3A2Ym7ju4z6`는 그대로다. 보호 설정은 유지되고 서버 저장 활성화 플래그도 추가하지 않았다. resume 명령을 재실행해 같은 배포를 조회·검증했으며 중복 빌드를 만들지 않았다.

비로그인 상태에서 고정 주소의 `/api/health` 요청은 Vercel 로그인으로 이동했다(최종 호스트 vercel.com). 이 200은 앱의 health 응답이 아니다. 실제 보호된 원격 화면의 기능 조작은 로그인 세션이 없어 미검증이며, Vercel의 원격 READY/소스/주소 확인과 로컬 기능 검증을 구분한다. 보호를 해제하거나 새 우회 키를 만들지 않았다.
