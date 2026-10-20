import { test, expect, openDetails, seed, state, ready } from "../support/fixtures";
import { analyzed, collected, analysisRaw, automationWorkspace } from "../support/automation";
import { applyAnalysis } from "../../src/lib/automation/state";
import { parseAnalysis } from "../../src/lib/automation/facts";
test.setTimeout(60_000);
test("저장소 없는 프로젝트는 CLI 대기 대신 등록할 항목을 안내하고 같은 프로젝트에 연결한다", async ({ page }) => {
  const data = automationWorkspace(new Date().toISOString()); data.services = [];
  await seed(page, data); await page.goto("/projects/auto-project"); await ready(page);
  const agent = page.getByRole("region", { name: "프로젝트 AI 작업실", exact: true });
  const screen = page.getByRole("region", { name: "수정된 화면 확인", exact: true });
  await expect(agent.getByRole("status").first()).toHaveText("GitHub 저장소 등록 필요");
  await expect(agent.getByRole("link", { name: "CLI 연결 안내 →", exact: true })).toHaveCount(0);
  await expect(screen).toContainText("GitHub 저장소를 먼저 등록해주세요");
  await expect(screen.getByRole("button", { name: "화면 준비", exact: true })).toBeDisabled();
  await agent.getByRole("button", { name: "GitHub 저장소 등록", exact: true }).click();
  const form = page.getByRole("dialog", { name: "서비스 등록", exact: true });
  await form.getByLabel("서비스 웹 주소", { exact: true }).fill("https://github.com/example/synthetic-new");
  await form.getByRole("button", { name: "서비스 저장", exact: true }).click();
  await expect(form).not.toBeVisible();
  expect((await state(page))!.services[0]).toMatchObject({ projectId: "auto-project", space: "company", webUrl: "https://github.com/example/synthetic-new" });
  await expect(agent.getByRole("status").first()).toHaveText("CLI 연결 대기");
  await page.reload(); await ready(page); await expect(screen.getByRole("button", { name: "화면 준비", exact: true })).toBeEnabled();
});
test("앱의 구독 CLI 미지원은 접속 실패와 구분하고 같은 수정본을 AI 없이 다시 준비한다", async ({ page }) => {
  const { enqueueWork, claimProjectWork, reportProjectWork } = await import("../../src/lib/automation/work");
  const { observeWorkRunner } = await import("../../src/lib/automation/runner-status");
  const stamp = new Date().toISOString(), scope = { space: "company" as const, projectIds: ["auto-project"], deviceId: "runner", remoteWork: true, previews: true, previewCli: true };
  const change = claimProjectWork(enqueueWork(automationWorkspace(stamp), "company", "auto-project", "auto-service", "합성 수정", "change", "pr", stamp), scope, stamp), source = change.job!;
  let data = reportProjectWork(change.data, "company", { projectId: source.projectId, jobId: source.id, leaseToken: source.leaseToken, phase: "result", result: {
    reply: "합성 수정본", summary: "수정", currentStatus: "", nextAction: "", changes: ["src/app.tsx"], checks: [], followUps: [], outcome: "pr_open", branch: `jarvis/work-${source.id}`, baseSha: "a".repeat(40), headSha: "b".repeat(40), prUrl: "https://github.com/example/synthetic/pull/1", deployment: { state: "not_configured", url: null, sha: null },
  } }, "runner", stamp);
  const preview = claimProjectWork(enqueueWork(data, "company", "auto-project", "auto-service", "화면 준비", "preview", "pr", stamp, undefined, source.id, "codex"), scope, stamp), job = preview.job!;
  data = reportProjectWork(preview.data, "company", { projectId: job.projectId, jobId: job.id, leaseToken: job.leaseToken, phase: "result", result: {
    reply: "기존의 일반 오류 안내", summary: "미리보기 실패", currentStatus: "", nextAction: "", changes: [], checks: [], followUps: [], outcome: "blocked", branch: null, baseSha: "b".repeat(40), headSha: null, prUrl: null, deployment: { state: "not_configured", url: null, sha: null },
    preview: { state: "failed", kind: "remote", url: null, sha: "b".repeat(40), checkedAt: stamp, expiresAt: null, message: "구독 CLI의 실제 응답을 확인하지 못했습니다. 로그인·사용 한도·응답 상태를 확인해주세요.", diagnostic: { stage: "ai", code: "preview_cli_config_unavailable" } },
  } }, "runner", stamp);
  data = observeWorkRunner(data, scope, { runnerVersion: "2.5.0", remoteWorkVersion: 1, previewVersion: 1, previewCliVersion: 1 }, stamp);
  await seed(page, data); await page.goto("/projects/auto-project"); await ready(page);
  const screen = page.getByRole("region", { name: "수정된 화면 확인", exact: true }), agent = page.getByRole("region", { name: "프로젝트 AI 작업실", exact: true });
  await expect(agent.getByRole("status").first()).toHaveText("Jarvis CLI 연결됨");
  await expect(screen).toContainText("이 앱은 구독 CLI 미리보기 연결을 지원하지 않습니다");
  await expect(screen).not.toContainText("로그인·사용 한도·응답 상태");
  await expect(agent).toContainText("화면 준비 · 구독 CLI 선택");
  await screen.getByRole("button", { name: "AI 연결 없이 화면 준비", exact: true }).click();
  const saved = (await state(page))!, next = saved.projects[0].automation!.turns.at(-1)!;
  expect(next).toMatchObject({ mode: "preview", sourceTurnId: source.id, status: "queued" });
  expect(next.previewAI).toBeUndefined(); expect(saved.projects[0].automation!.turns.find(t => t.id === job.id)!.result!.preview!.diagnostic!.code).toBe("preview_cli_config_unavailable");
  await expect(screen.getByLabel("미리보기 AI")).toHaveValue("none");
  await page.reload(); await ready(page); await expect(screen.getByLabel("미리보기 AI")).toHaveValue("none");
});
test("구독 CLI 미리보기 선택과 요청을 보존하고 구버전에는 구체적인 대기 이유를 표시한다", async ({ page }) => {
  const { observeWorkRunner } = await import("../../src/lib/automation/runner-status");
  const stamp = new Date().toISOString();
  await seed(page, observeWorkRunner(automationWorkspace(stamp), { space: "company", projectIds: ["auto-project"] }, { runnerVersion: "2.4.3", remoteWorkVersion: 1, previewVersion: 1 }, stamp));
  await page.goto("/projects/auto-project"); await ready(page);
  const screen = page.getByRole("region", { name: "수정된 화면 확인", exact: true });
  await screen.getByLabel("미리보기 AI", { exact: true }).selectOption("codex");
  await expect(screen).toContainText("구독 사용량");
  await expect(screen).not.toContainText("AI 사용량은 소모하지 않습니다");
  await screen.getByRole("button", { name: "화면 준비", exact: true }).click();
  expect((await state(page))!.projects[0].automation!.turns.at(-1)).toMatchObject({ mode: "preview", previewAI: "codex", status: "queued" });
  await expect(screen).toContainText("2.5.0");
  await page.reload(); await ready(page);
  await expect(screen.getByLabel("미리보기 AI", { exact: true })).toHaveValue("codex");
});
test("실패한 원격 준비에 구버전 주소 안내를 붙이지 않고 단계별 진단을 보여준다", async ({ page }) => {
  const { enqueueWork, claimProjectWork, reportProjectWork } = await import("../../src/lib/automation/work");
  const stamp = new Date().toISOString();
  const initial = enqueueWork(automationWorkspace(stamp), "company", "auto-project", "auto-service", "합성 화면 준비", "preview", "pr", stamp);
  const claim = claimProjectWork(initial, { space: "company", projectIds: ["auto-project"], deviceId: "runner", previews: true }, stamp), job = claim.job!;
  const preview = { state: "failed", kind: "mac", url: null, sha: "a".repeat(40), checkedAt: stamp, expiresAt: null, message: "원격 미리보기 연결에 실패했습니다. 맥미니 실행기 업데이트·Docker·인터넷 연결을 확인해주세요." };
  const data = reportProjectWork(claim.data, "company", { projectId: job.projectId, jobId: job.id, leaseToken: job.leaseToken, phase: "result", result: {
    reply: preview.message, summary: "화면 준비 필요", currentStatus: "", nextAction: "", changes: [], checks: [], followUps: [], outcome: "blocked", branch: null, baseSha: preview.sha, headSha: null, prUrl: null,
    deployment: { state: "not_configured", url: null, sha: null }, preview,
  } }, "runner", stamp);
  await seed(page, data); await page.goto("/projects/auto-project"); await ready(page);
  const screen = page.getByRole("region", { name: "수정된 화면 확인", exact: true });
  await expect(screen).toContainText("상세 원인은 저장되지 않았습니다");
  await expect(screen).not.toContainText("이전 실행기가 만든 주소");
  await expect(page.getByRole("region", { name: "프로젝트 AI 작업실", exact: true })).not.toContainText("업데이트·Docker");
  data.projects[0].automation!.turns[0].result!.preview = { ...data.projects[0].automation!.turns[0].result!.preview!, kind: "remote", message: "외부 주소의 응답을 확인하지 못했습니다.", diagnostic: { stage: "health", code: "remote_health_http", statusCode: 530 } };
  await seed(page, data); await page.goto("/projects/auto-project"); await ready(page);
  await screen.getByText("연결 진단", { exact: true }).click();
  await expect(screen).toContainText("외부 주소 응답 · remote_health_http · HTTP 530");
  await expect(screen.getByRole("link", { name: "이 PC에서 화면 열기" })).toHaveCount(0);
});
test("접속 중인 구버전의 대기 이유와 업데이트 후 실제 버전을 표시한다", async ({ page }, info) => {
  const { enqueueWork } = await import("../../src/lib/automation/work");
  const { observeWorkRunner } = await import("../../src/lib/automation/runner-status");
  const stamp = new Date().toISOString(), scope = { space: "company" as const, projectIds: ["auto-project"] };
  const queued = enqueueWork(automationWorkspace(stamp), "company", "auto-project", "auto-service", "합성 자동 테스트", "test", "pr", stamp);
  const old = observeWorkRunner(queued, scope, { previewVersion: 1 }, stamp);
  await seed(page, old); await page.goto("/projects/auto-project"); await ready(page);
  const agent = page.getByRole("region", { name: "프로젝트 AI 작업실", exact: true });
  const screen = page.getByRole("region", { name: "수정된 화면 확인", exact: true });
  await expect(agent).toContainText("CLI 연결됨 · 새 기능 업데이트 필요");
  await expect(agent).toContainText("버전 미확인");
  await expect(agent).toContainText("업데이트해야 이 요청을 시작할 수 있습니다");
  await expect(screen).toContainText("업데이트해야 이 요청을 시작할 수 있습니다");
  await expect(agent).not.toContainText("CLI가 연결되면 자동으로 시작합니다");
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("runner-update-needed.png"), fullPage: true });
  const updated = observeWorkRunner(old, scope, { runnerVersion: "2.4.1", remoteWorkVersion: 1, previewVersion: 1 }, stamp);
  await seed(page, updated); await page.goto("/projects/auto-project"); await ready(page);
  await expect(agent).toContainText("버전 2.4.1");
  await expect(agent).not.toContainText("업데이트 필요");
  await expect(agent).toContainText("요청이 실행 대기 중입니다");
  expect((await state(page))!.projects[0].automation!.turns[0]).toMatchObject({ status: "queued", attempt: 0 });
});
test("프로젝트를 선택해도 비밀값 없는 영역 자동 연결 설정을 받는다", async ({ page }) => {
  await seed(page, automationWorkspace(new Date().toISOString()));
  await page.goto("/projects/auto-project"); await ready(page);
  await openDetails(page, "프로젝트 정보·연결");
  await openDetails(page, "GitHub 점검·분석 상세");
  const monitor = page.getByRole("region", { name: "합성 GitHub GitHub 점검" });
  await expect(monitor).toContainText("점검 요청 저장됨");
  await expect(monitor.getByRole("button", { name: "점검 대기·진행 중" })).toBeDisabled();
  expect((await state(page))!.services[0].lastSuccessAt).toBeNull();
  await page.reload(); await ready(page); await openDetails(page, "프로젝트 정보·연결"); await openDetails(page, "GitHub 점검·분석 상세"); await expect(monitor).toContainText("AI 분석 결과 없음");
  await monitor.getByRole("link", { name: "구독 CLI 실행기 연결" }).click();
  const setup = page.getByRole("region", { name: "구독 CLI 실행기", exact: true });
  await expect(setup).toContainText("ChatGPT 구독");
  const downloaded = page.waitForEvent("download");
  await expect(setup).toContainText("앞으로 등록할 프로젝트를 자동으로 연결");
  await setup.getByRole("button", { name: "영역 자동 연결 설정 받기" }).click();
  const download = await downloaded; const stream = await download.createReadStream(); const chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const config = JSON.parse(Buffer.concat(chunks).toString());
  expect(config).toEqual({ origin: "http://127.0.0.1:4317", provider: "codex", scopes: [{ space: "company", projectIds: [null] }] });
});
test("사실·AI 판단과 제안 채택을 구분하고 새로고침 뒤 중복 없이 보존한다", async ({ page }, info) => {
  await seed(page, analyzed(new Date().toISOString()));
  await page.goto("/projects/auto-project"); await ready(page);
  await openDetails(page, "프로젝트 정보·연결");
  await openDetails(page, "GitHub 점검·분석 상세");
  const monitor = page.getByRole("region", { name: "합성 GitHub GitHub 점검" });
  await expect(monitor).toContainText("AI의 판단 · Codex CLI");
  await expect(monitor).toContainText("파일 구조 1개");
  await expect(page.getByText("GitHub 마지막 정상 조회:", { exact: false })).toBeVisible();
  await monitor.getByText("분석 근거와 확인 범위", { exact: true }).click();
  await expect(monitor.getByRole("link", { name: "README.md" })).toHaveAttribute("href", /github.com\/example\/synthetic\/blob/);
  await monitor.getByRole("button", { name: "할 일로 채택", exact: true }).click();
  await expect(monitor.getByRole("button", { name: "할 일로 채택", exact: true })).toHaveCount(0);
  await page.reload(); await ready(page);
  expect((await state(page))!.tasks.filter(t => t.sourceSuggestionId)).toHaveLength(1);
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("github-cli-review.png"), fullPage: true });
});
test("완료 후보는 근거 직접 확인 후 기록하고 수집 실패 시 과거 분석을 유지한다", async ({ page }) => {
  const stamp = new Date().toISOString(), data = collected(stamp);
  data.tasks.push({ id: "existing-task", space: "company", projectId: "auto-project", title: "합성 기존 업무", status: "todo", dueDate: "", createdAt: stamp });
  const raw = analysisRaw(data.sourceRecords[0].id); raw.suggestions[0] = { ...raw.suggestions[0], kind: "completion", taskId: "existing-task" };
  data.services[0] = applyAnalysis(data.services[0], parseAnalysis(data, data.services[0], raw, stamp));
  await seed(page, data); await page.goto("/projects/auto-project"); await ready(page);
  await openDetails(page, "프로젝트 정보·연결");
  await openDetails(page, "GitHub 점검·분석 상세");
  const monitor = page.getByRole("region", { name: "합성 GitHub GitHub 점검" });
  const complete = monitor.getByRole("button", { name: "확인한 업무 완료로 기록" });
  await expect(complete).toBeDisabled();
  await monitor.getByLabel("완료 조건과 근거를 직접 확인했습니다.").check(); await complete.click();
  await expect.poll(async () => (await state(page))!.tasks[0].status).toBe("done");
  const failed = analyzed(stamp); failed.services[0].monitoring!.error = "github_unavailable";
  failed.services[0].monitoring!.job = { ...failed.services[0].monitoring!.job!, status: "failed", error: "github_unavailable" };
  await seed(page, failed); await page.goto("/projects/auto-project"); await ready(page);
  await openDetails(page, "프로젝트 정보·연결");
  await openDetails(page, "GitHub 점검·분석 상세");
  await expect(monitor).toContainText("마지막 정상 자료는 유지");
  await expect(monitor).toContainText("합성 저장소 분석 결과");
  await expect(monitor.getByRole("button", { name: "할 일로 채택" })).toBeDisabled();
});
test("연결된 실행기의 서버 분석을 열린 화면에서 자동 갱신한다", async ({ page }) => {
  const stamp = new Date().toISOString();
  const remote = { company: { data: automationWorkspace(stamp), revision: 1 }, personal: { data: { ...automationWorkspace(stamp), services: [], projects: [], activeProjects: { company: null, personal: null } }, revision: 0 } };
  await page.clock.install();
  await page.route("**/api/account", route => route.fulfill({ json: { enabled: true, configured: true, authenticated: true, accountId: "11111111-1111-4111-8111-111111111111", deviceId: "synthetic-device" } }));
  await page.route("**/api/workspace?*", route => {
    const space = new URL(route.request().url()).searchParams.get("space") as "company" | "personal";
    return route.fulfill({ json: remote[space] });
  });
  await page.goto("/projects/auto-project"); await ready(page);
  await openDetails(page, "프로젝트 정보·연결");
  await openDetails(page, "GitHub 점검·분석 상세");
  const monitor = page.getByRole("region", { name: "합성 GitHub GitHub 점검" });
  await expect(monitor).toContainText("점검 요청 저장됨");
  remote.company = { data: analyzed(stamp), revision: 2 };
  await page.clock.fastForward(31_000);
  await expect(monitor).toContainText("합성 저장소 분석 결과");
});

test("프로젝트 상단의 자동 웹 주소·대화 요청·후속 업무는 영역을 유지하고 다시 열어도 보존된다", async ({ page }, info) => {
  const stamp = new Date().toISOString(), data = automationWorkspace(stamp);
  data.services[0].monitoring!.webLinks = [{ url: "https://synthetic-project.vercel.app/", kind: "homepage", environment: "홈페이지", sourceUrl: "https://github.com/example/synthetic", observedAt: stamp }];
  data.services[0].monitoring!.runnerSeenAt = stamp; data.services[0].monitoring!.runnerVersion = "2.0.0";
  await seed(page, data); await page.goto("/projects/auto-project"); await ready(page);
  const links = page.getByRole("region", { name: "프로젝트 바로가기", exact: true });
  await expect(links.getByRole("link", { name: "웹 화면 열기", exact: true })).toHaveAttribute("href", "https://synthetic-project.vercel.app/");
  const agent = page.getByRole("region", { name: "프로젝트 AI 작업실", exact: true });
  await expect(agent).toContainText("CLI 연결됨");
  await agent.getByLabel("AI에게 요청", { exact: true }).fill("합성 모바일 버튼 개선");
  await agent.getByLabel("반영 범위", { exact: true }).selectOption("pr");
  await agent.getByRole("button", { name: "요청 보내기", exact: true }).click();
  await expect(agent).toContainText("실행 대기");
  await page.reload(); await ready(page); await expect(agent).toContainText("합성 모바일 버튼 개선");
  const saved = (await state(page))!;
  expect(saved.projects[0].automation!.turns).toHaveLength(1); expect(saved.tasks).toHaveLength(1);
  expect(saved.projects[0].automation!.turns[0]).toMatchObject({ mode: "change", publish: "pr", repository: "example/synthetic" });
  await agent.getByRole("button", { name: "요청 취소", exact: true }).click();
  await expect(agent).toContainText("요청 취소됨");
  await agent.getByLabel("요청 방식", { exact: true }).selectOption("ask");
  await expect(agent.getByLabel("반영 범위", { exact: true })).toHaveCount(0);
  await agent.getByLabel("AI에게 요청", { exact: true }).fill("합성 프로젝트 구조를 설명해줘");
  await agent.getByRole("button", { name: "요청 보내기", exact: true }).click();
  expect((await state(page))!.tasks).toHaveLength(1);
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("project-ai-workroom.png"), fullPage: true });
  await page.getByRole("button", { name: "개인", exact: true }).click();
  await expect(page.getByText("합성 모바일 버튼 개선", { exact: true })).toHaveCount(0);
});

test("CLI 결과를 자동 분류하고 수정·검증·후속 업무를 별도 수기 입력 없이 보여준다", async ({ page }, info) => {
  const { enqueueWork, claimProjectWork, reportProjectWork } = await import("../../src/lib/automation/work");
  const stamp = new Date().toISOString();
  let data = enqueueWork(automationWorkspace(stamp), "company", "auto-project", "auto-service", "합성 모바일 여백 수정", "change", "merge", stamp);
  const claimed = claimProjectWork(data, { space: "company", projectIds: ["auto-project"], deviceId: "runner" }, stamp), job = claimed.job!;
  data = reportProjectWork(claimed.data, "company", { projectId: job.projectId, jobId: job.id, leaseToken: job.leaseToken, phase: "result", result: {
    reply: "모바일 여백을 수정했습니다. CI와 배포 결과를 확인했습니다.", summary: "모바일 가독성 개선", currentStatus: "반영됨", nextAction: "태블릿 확인", changes: ["src/page.tsx"],
    checks: [{ name: "GitHub CI", status: "passed", detail: "합성 커밋 검사 성공" }], followUps: [{ title: "태블릿 화면 회귀 확인", reason: "추가 화면 크기", kind: "todo" }, { title: "문구 최종 확인", reason: "표현 결정", kind: "decision" }],
    outcome: "deployed", branch: `jarvis/work-${job.id}`, baseSha: "a".repeat(40), headSha: "b".repeat(40), prUrl: "https://github.com/example/synthetic/pull/1", deployment: { state: "success", url: "https://synthetic-project.vercel.app/", sha: "c".repeat(40) },
  } }, "runner", stamp);
  await seed(page, data); await page.goto("/projects/auto-project"); await ready(page);
  await openDetails(page, "수정·검증");
  await openDetails(page, "후속 업무");
  await openDetails(page, "확인·결정할 사항");
  await expect(page.getByRole("region", { name: "자동 수정 검증 결과", exact: true })).toContainText("통과 · GitHub CI");
  await expect(page.getByRole("region", { name: "자동 후속 업무", exact: true })).toContainText("태블릿 화면 회귀 확인");
  await expect(page.getByRole("region", { name: "자동 확인 사항", exact: true })).toContainText("문구 최종 확인");
  await expect(page.getByRole("region", { name: "프로젝트 바로가기", exact: true }).getByRole("link", { name: "웹 화면 열기", exact: true })).toHaveAttribute("href", "https://synthetic-project.vercel.app/");
  await page.reload(); await ready(page);
  expect((await state(page))!.tasks).toHaveLength(3);
  await page.screenshot({ path: info.outputPath("project-ai-results.png"), fullPage: true });
});

test("장문·많은 기록은 기본 화면을 늘리지 않고 전문·이력·원문은 다시 열 수 있다", async ({ page }, info) => {
  const { randomUUID } = await import("node:crypto");
  const stamp = new Date().toISOString(), data = analyzed(stamp);
  const reply = "합성 응답 전문입니다. 저장소에서 확인한 결과와 다음 검증 내용을 보존합니다. ".repeat(90) + "응답 마지막 문장";
  const result = {
    reply, summary: "합성 결과 요약 ".repeat(200), currentStatus: "대상 앱 연동은 미구현입니다. ".repeat(40), nextAction: "대상 저장소의 구현 범위를 확인하세요. ".repeat(40),
    changes: Array.from({ length: 50 }, (_, n) => `src/synthetic-${n}.tsx`),
    checks: [{ name: "합성 검사", status: "failed" as const, detail: "합성 검사 상세 ".repeat(100) }], followUps: [], outcome: "blocked" as const,
    branch: null, baseSha: null, headSha: null, prUrl: null, deployment: { state: "not_configured" as const, url: null, sha: null },
  };
  const turns = Array.from({ length: 35 }, (_, n) => ({ id: randomUUID(), serviceId: "auto-service", repository: "example/synthetic", request: n === 34 ? "최신 합성 요청" : `이전 합성 요청 ${n}`, mode: "change" as const, publish: "pr" as const, status: "completed" as const, phase: "reporting" as const, attempt: 1, createdAt: stamp, updatedAt: stamp, result }));
  data.projects[0].automation = { turns: [turns.at(-1)!] };
  data.services[0].monitoring!.runnerSeenAt = stamp;
  for (let n = 0; n < 24; n++) data.tasks.push({ id: `compact-task-${n}`, projectId: "auto-project", space: "company", title: `합성 후속 업무 ${n}`, status: n % 2 ? "decision" : "todo", sourceSuggestionId: `compact-${n}`, dueDate: "", createdAt: stamp });
  data.sourceRecords[0].content = '파일 SHA: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n{"syntheticSource":true}\n' + "합성 코드 원문 ".repeat(400);
  await seed(page, data); await page.goto("/projects/auto-project"); await ready(page);
  const heightBefore = await page.evaluate(() => document.documentElement.scrollHeight);
  data.projects[0].automation = { turns };
  await seed(page, data); await page.goto("/projects/auto-project"); await ready(page);
  const agent = page.getByRole("region", { name: "프로젝트 AI 작업실", exact: true });
  const latest = agent.locator('[aria-label="최근 요청"]');
  await expect(agent.getByText("최신 합성 요청", { exact: true })).toBeVisible();
  await expect(agent.getByText("이전 합성 요청 33", { exact: true })).not.toBeVisible();
  await expect(latest.getByText(reply, { exact: true })).not.toBeVisible();
  await expect(agent.getByRole("status").first()).toHaveText("Jarvis CLI 연결됨");
  await expect(agent.getByLabel("반영 범위", { exact: true })).toBeVisible();
  expect((await agent.getByLabel("AI에게 요청", { exact: true }).boundingBox())!.y).toBeLessThan((await latest.boundingBox())!.y);
  await expect(page.locator("summary").filter({ hasText: "수정·검증" })).toContainText("실패 있음");
  expect(await page.evaluate(() => document.documentElement.scrollHeight) - heightBefore).toBeLessThan(100);
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThan(2600);
  await page.screenshot({ path: info.outputPath("compact-project-mobile.png"), fullPage: true });
  if (info.project.name === "desktop") {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: info.outputPath("compact-project-desktop.png"), fullPage: true });
  }
  await latest.getByText("답변 전문 보기", { exact: true }).click();
  await expect(latest.getByText(reply, { exact: true })).toBeVisible();
  await latest.getByText("답변 전문 접기", { exact: true }).click();
  await openDetails(page, "이전 대화 34건");
  await expect(agent.getByText("이전 합성 요청 33", { exact: true })).toBeVisible();
  await expect(agent.getByText("이전 합성 요청 0", { exact: true })).toHaveCount(0);
  for (let n = 0; n < 3; n++) await agent.getByRole("button", { name: "이전 대화 더 보기" }).click();
  await expect(agent.getByText("이전 합성 요청 0", { exact: true })).toBeVisible();
  const sourceSummary = page.locator("summary").filter({ hasText: "수집 자료·근거" });
  await sourceSummary.focus(); await page.keyboard.press("Enter");
  const sources = page.getByRole("region", { name: "최근 결과와 진행 상황", exact: true });
  await expect(sources.getByText(data.sourceRecords[0].content, { exact: true })).not.toBeVisible();
  await sources.getByText("원문 내용 보기", { exact: true }).click();
  await expect(sources.getByText(data.sourceRecords[0].content, { exact: true })).toBeVisible();
  await page.reload(); await ready(page);
  expect((await state(page))!.projects[0].automation!.turns).toHaveLength(35);
  await expect(latest.getByText(reply, { exact: true })).not.toBeVisible();
});

test("과거 수집 기록과 현재 실행기 접속을 구분하고 예전 중단 요청도 조작할 수 있다", async ({ page }) => {
  const { enqueueWork } = await import("../../src/lib/automation/work");
  const stamp = new Date().toISOString();
  let data = analyzed(stamp);
  data = enqueueWork(data, "company", "auto-project", "auto-service", "이전 중단 요청", "change", "pr", stamp);
  data.projects[0].automation!.turns[0].status = "interrupted";
  data.projects[0].automation!.turns[0].error = "runner_interrupted";
  data = enqueueWork(data, "company", "auto-project", "auto-service", "최신 대기 요청", "ask", "pr", stamp);
  data.services[0].monitoring!.runnerSeenAt = new Date(Date.now() - 300_000).toISOString();
  await seed(page, data); await page.goto("/projects/auto-project"); await ready(page);
  const agent = page.getByRole("region", { name: "프로젝트 AI 작업실", exact: true });
  await expect(agent.getByRole("status").first()).toHaveText("Jarvis CLI 최근 응답 없음");
  await openDetails(page, "진행·확인 필요 1건");
  const interrupted = agent.getByRole("article", { name: "작업 요청", exact: true }).filter({ hasText: "이전 중단 요청" });
  await interrupted.getByRole("button", { name: "이어서 실행", exact: true }).click();
  await expect.poll(async () => (await state(page))!.projects[0].automation!.turns[0].status).toBe("queued");
  await interrupted.getByRole("button", { name: "요청 취소", exact: true }).click();
  await expect.poll(async () => (await state(page))!.projects[0].automation!.turns[0].status).toBe("cancelled");
});

test("화면 준비 요청과 맥미니 전용 링크·만료 상태를 저장하고 모바일에서도 표시한다", async ({ page }, info) => {
  const stamp = new Date().toISOString(), data = automationWorkspace(stamp);
  await page.clock.install({ time: new Date(stamp) });
  await seed(page, data); await page.goto("/projects/auto-project"); await ready(page);
  const screen = page.getByRole("region", { name: "수정된 화면 확인", exact: true });
  await screen.getByRole("button", { name: "화면 준비", exact: true }).click();
  await expect(screen).toContainText("연결되면 저장된 요청을 처리합니다");
  await expect(screen.getByRole("button", { name: "화면 준비 대기·진행 중" })).toBeDisabled();
  const saved = (await state(page))!;
  expect(saved.projects[0].automation!.turns[0].mode).toBe("preview"); expect(saved.tasks).toHaveLength(0);
  const { claimProjectWork, reportProjectWork } = await import("../../src/lib/automation/work");
  const claimed = claimProjectWork(saved, { space: "company", projectIds: ["auto-project"], deviceId: "runner", previews: true }, stamp), job = claimed.job!;
  const complete = reportProjectWork(claimed.data, "company", { projectId: job.projectId, jobId: job.id, leaseToken: job.leaseToken, phase: "result", result: {
    reply: "합성 미리보기 준비", summary: "화면 준비", currentStatus: "", nextAction: "", changes: [], checks: [], followUps: [], outcome: "answered", branch: null, baseSha: "a".repeat(40), headSha: null, prUrl: null,
    deployment: { state: "not_configured", url: null, sha: null }, preview: { state: "ready", kind: "mac", url: "http://127.0.0.1:45678/", sha: "a".repeat(40), checkedAt: stamp, expiresAt: new Date(Date.parse(stamp) + 60_000).toISOString(), message: "실행한 맥미니에서 열 수 있습니다." },
  } }, "runner", stamp);
  await seed(page, complete); await page.goto("/projects/auto-project"); await ready(page);
  await expect(screen.getByRole("link", { name: "맥미니에서만 열기" })).toHaveAttribute("href", "http://127.0.0.1:45678/");
  await expect(screen).toContainText("이전 실행기가 만든 주소");
  await expect(screen).toContainText("실행한 맥미니");
  const preview = complete.projects[0].automation!.turns[0].result!.preview!;
  preview.kind = "remote"; preview.remoteId = "11111111-1111-4111-8111-111111111111";
  preview.url = "https://synthetic-private-preview.trycloudflare.com/";
  preview.message = "이 PC에서 열 수 있습니다. 승인된 Jarvis 기기에서만 접근합니다.";
  await seed(page, complete); await page.goto("/projects/auto-project"); await ready(page);
  const remoteLink = screen.getByRole("link", { name: "이 PC에서 화면 열기" });
  await expect(remoteLink).toHaveAttribute("href", `/api/preview/open?space=company&projectId=auto-project&turnId=${job.id}`);
  await expect(screen).toContainText("원격 미리보기 준비됨");
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("project-screen-mobile.png"), fullPage: true });
  await page.clock.fastForward(61_000);
  await expect(screen).toContainText("미리보기 시간 만료");
  await expect(screen.getByRole("link", { name: "맥미니에서만 열기" })).toHaveCount(0);
  await expect(remoteLink).toHaveCount(0);
});

test("최근 수정본으로 원격 테스트·화면 준비·후속 요청을 저장하고 검사 결과를 보여준다", async ({ page }) => {
  const { enqueueWork, claimProjectWork, reportProjectWork } = await import("../../src/lib/automation/work");
  const stamp = new Date().toISOString();
  const initial = enqueueWork(automationWorkspace(stamp), "company", "auto-project", "auto-service", "합성 수정", "change", "pr", stamp);
  const scope = { space: "company" as const, projectIds: ["auto-project"], deviceId: "runner", remoteWork: true, previews: true };
  const first = claimProjectWork(initial, scope, stamp), job = first.job!;
  const data = reportProjectWork(first.data, "company", { projectId: job.projectId, jobId: job.id, leaseToken: job.leaseToken, phase: "result", result: {
    reply: "합성 수정본", summary: "수정", currentStatus: "", nextAction: "", changes: ["app.js"], checks: [], followUps: [], outcome: "pr_open", branch: `jarvis/work-${job.id}`, baseSha: "a".repeat(40), headSha: "b".repeat(40), prUrl: "https://github.com/example/synthetic/pull/1", deployment: { state: "not_configured", url: null, sha: null },
  } }, "runner", stamp);
  await seed(page, data); await page.goto("/projects/auto-project"); await ready(page);
  const screen = page.getByRole("region", { name: "수정된 화면 확인", exact: true });
  await expect(screen.getByLabel("확인할 코드")).toHaveValue("latest");
  await screen.getByRole("button", { name: "테스트 실행", exact: true }).click();
  let saved = (await state(page))!;
  expect(saved.projects[0].automation!.turns.at(-1)).toMatchObject({ mode: "test", sourceTurnId: job.id });
  expect(saved.tasks).toHaveLength(1);
  const testing = claimProjectWork(saved, scope, stamp), testJob = testing.job!;
  const complete = reportProjectWork(testing.data, "company", { projectId: testJob.projectId, jobId: testJob.id, leaseToken: testJob.leaseToken, phase: "result", result: {
    reply: "합성 검증 결과", summary: "실패", currentStatus: "", nextAction: "", changes: [], checks: [{ name: "npm run test", status: "failed", detail: "격리 실행 · 종료 코드 1" }], followUps: [], outcome: "blocked", branch: null, baseSha: "b".repeat(40), headSha: null, prUrl: null, deployment: { state: "not_configured", url: null, sha: null },
  } }, "runner", stamp);
  await seed(page, complete); await page.goto("/projects/auto-project"); await ready(page);
  await expect(page.getByRole("article", { name: "작업 요청" }).getByText("npm run test · 실패", { exact: true })).toBeVisible();
  await screen.getByRole("button", { name: "화면 준비", exact: true }).click();
  saved = (await state(page))!;
  expect(saved.projects[0].automation!.turns.at(-1)).toMatchObject({ mode: "preview", sourceTurnId: job.id });
  const agent = page.getByRole("region", { name: "프로젝트 AI 작업실", exact: true });
  await agent.getByLabel("AI에게 요청", { exact: true }).fill("합성 후속 수정");
  await agent.getByRole("button", { name: "요청 보내기" }).click();
  expect((await state(page))!.projects[0].automation!.turns.at(-1)).toMatchObject({ mode: "change", sourceTurnId: job.id });
  await page.reload(); await ready(page);
  await expect(screen.getByLabel("확인할 코드")).toHaveValue("latest");
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test("새 프로젝트는 자동 준비와 첫 개발 요청을 저장하고 준비 중 후속 대화를 보존한다", async ({ page }) => {
  const data = automationWorkspace(new Date().toISOString()); data.activeSpace = "personal";
  await seed(page, data); await page.goto("/projects"); await ready(page);
  await page.getByRole("button", { name: "프로젝트 만들기", exact: true }).click();
  const form = page.getByRole("dialog", { name: "프로젝트 만들기", exact: true });
  await form.getByLabel("프로젝트 이름", { exact: true }).fill("자동 그래프 앱");
  await form.getByLabel("프로젝트 설명", { exact: true }).fill("연도별 수익률 그래프를 만들고 입력값 저장");
  await form.getByRole("radio", { name: /개발 시작·이어가기/ }).check();
  await expect(form.getByRole("checkbox", { name: "저장소·실행 환경 자동 준비" })).toBeChecked();
  await form.getByRole("button", { name: "프로젝트 저장", exact: true }).click(); await expect(form).not.toBeVisible();
  const project = (await state(page))!.projects.find(p => p.name === "자동 그래프 앱")!;
  expect(project.setup).toMatchObject({ status: "queued", target: "mac", requests: [{ request: "연도별 수익률 그래프를 만들고 입력값 저장", mode: "change" }] });
  await page.goto(`/projects/${project.id}`); await ready(page);
  const agent = page.getByRole("region", { name: "프로젝트 AI 작업실", exact: true });
  await expect(agent).toContainText("개발 환경 자동 준비");
  await agent.getByLabel("AI에게 요청", { exact: true }).fill("배당금 포함 여부도 선택하게 해줘");
  await agent.getByRole("button", { name: "요청 보내기", exact: true }).click();
  await expect(agent.getByLabel("AI에게 요청", { exact: true })).toHaveValue("");
  await page.reload(); await ready(page);
  expect((await state(page))!.projects.find(p => p.id === project.id)!.setup!.requests).toHaveLength(2);
  await expect(agent).toContainText("배당금 포함 여부도 선택하게 해줘");
  await agent.getByRole("button", { name: "자동 준비 취소", exact: true }).click();
  await expect(agent.getByLabel("AI에게 요청", { exact: true })).toBeDisabled();
  await agent.getByRole("button", { name: "이어서 준비", exact: true }).click();
  await expect(agent.getByLabel("AI에게 요청", { exact: true })).toBeEnabled();
});

test("기본 브랜치의 최신 준비 화면은 예전 PR에 가려지지 않고 후속 요청도 같은 코드를 사용한다", async ({ page }) => {
  const { enqueueWork, claimProjectWork, reportProjectWork } = await import("../../src/lib/automation/work");
  const stamp = new Date(Date.now() - 60_000).toISOString(), later = new Date().toISOString();
  const scope = { space: "company" as const, projectIds: ["auto-project"], deviceId: "runner", remoteWork: true, previews: true };
  const first = claimProjectWork(enqueueWork(automationWorkspace(stamp), "company", "auto-project", "auto-service", "합성 수정", "change", "pr", stamp), scope, stamp), job = first.job!;
  const prResult = { reply: "합성 수정본", summary: "수정", currentStatus: "", nextAction: "", changes: ["app.js"], checks: [], followUps: [], outcome: "pr_open", branch: `jarvis/work-${job.id}`, baseSha: "a".repeat(40), headSha: "b".repeat(40), prUrl: "https://github.com/example/synthetic/pull/1", deployment: { state: "not_configured", url: null, sha: null } };
  const old = reportProjectWork(first.data, "company", { projectId: job.projectId, jobId: job.id, leaseToken: job.leaseToken, phase: "result", result: prResult }, "runner", stamp);
  const prepared = claimProjectWork(enqueueWork(old, "company", "auto-project", "auto-service", "반영된 화면 준비", "preview", "pr", later), scope, later), previewJob = prepared.job!;
  const data = reportProjectWork(prepared.data, "company", { projectId: previewJob.projectId, jobId: previewJob.id, leaseToken: previewJob.leaseToken, phase: "result", result: {
    ...prResult, outcome: "answered", changes: [], branch: null, headSha: null, prUrl: null, baseSha: "c".repeat(40),
    preview: { state: "ready", kind: "remote", remoteId: previewJob.id, sha: "c".repeat(40), url: "https://synthetic-current.trycloudflare.com/", checkedAt: later, expiresAt: new Date(Date.now() + 3600_000).toISOString(), message: "합성 기본 브랜치 화면" },
  } }, "runner", later);
  await seed(page, data); await page.goto("/projects/auto-project"); await ready(page);
  const screen = page.getByRole("region", { name: "수정된 화면 확인", exact: true });
  const agent = page.getByRole("region", { name: "프로젝트 AI 작업실", exact: true });
  for (let reload = 0; reload < 2; reload++) {
    await expect(screen.getByLabel("확인할 코드")).toHaveValue("main");
    await expect(agent.getByLabel("작업할 코드")).toHaveValue("main");
    await expect(screen).toContainText("코드 cccccccc");
    await expect(screen.getByRole("link", { name: "이 PC에서 화면 열기" })).toHaveAttribute("href", new RegExp(previewJob.id));
    await expect(screen).not.toContainText("최근 수정본 bbbbbbbb");
    await page.reload(); await ready(page);
  }
  await screen.getByLabel("미리보기 AI").selectOption("ollama");
  await expect(screen.getByRole("link", { name: "이 PC에서 화면 열기" })).toHaveCount(0);
  await screen.getByLabel("미리보기 AI").selectOption("none");
  await screen.getByRole("button", { name: "화면 준비", exact: true }).click();
  expect((await state(page))!.projects[0].automation!.turns.at(-1)?.sourceTurnId).toBeUndefined();
  await agent.getByLabel("AI에게 요청", { exact: true }).fill("확인한 화면에서 후속 수정");
  await agent.getByRole("button", { name: "요청 보내기" }).click();
  const saved = (await state(page))!;
  expect(saved.projects[0].automation!.turns.at(-1)).toMatchObject({ mode: "change" });
  expect(saved.projects[0].automation!.turns.at(-1)?.sourceTurnId).toBeUndefined();
  expect(saved.projects[0].automation!.turns.at(-1)?.followLatest).toBeUndefined();
  expect(saved.projects[0].automation!.turns[0].result).toMatchObject(prResult);
  await screen.getByLabel("확인할 코드").selectOption("latest");
  await expect(screen).toContainText("최근 수정본 bbbbbbbb");
});

test("PR 변경 실패에서 반영된 코드로 한 번에 화면 준비하며 구독 CLI 선택을 보존한다", async ({ page }) => {
  const { enqueueWork, claimProjectWork, reportProjectWork } = await import("../../src/lib/automation/work");
  const stamp = new Date().toISOString();
  const scope = { space: "company" as const, projectIds: ["auto-project"], deviceId: "runner", remoteWork: true, previews: true, previewCli: true };
  const first = claimProjectWork(enqueueWork(automationWorkspace(stamp), "company", "auto-project", "auto-service", "합성 수정", "change", "pr", stamp), scope, stamp), job = first.job!;
  const old = reportProjectWork(first.data, "company", { projectId: job.projectId, jobId: job.id, leaseToken: job.leaseToken, phase: "result", result: {
    reply: "합성 수정본", summary: "수정", currentStatus: "", nextAction: "", changes: [], checks: [], followUps: [], outcome: "pr_open", branch: `jarvis/work-${job.id}`, baseSha: "a".repeat(40), headSha: "b".repeat(40), prUrl: "https://github.com/example/synthetic/pull/1", deployment: { state: "not_configured", url: null, sha: null },
  } }, "runner", stamp);
  const prepared = claimProjectWork(enqueueWork(old, "company", "auto-project", "auto-service", "예전 PR 확인", "preview", "pr", stamp, undefined, job.id, "codex"), scope, stamp), failed = prepared.job!;
  const data = reportProjectWork(prepared.data, "company", { projectId: failed.projectId, jobId: failed.id, leaseToken: failed.leaseToken, phase: "error", code: "work_source_changed" }, "runner", stamp);
  await seed(page, data); await page.goto("/projects/auto-project"); await ready(page);
  const screen = page.getByRole("region", { name: "수정된 화면 확인", exact: true });
  await expect(screen.getByLabel("확인할 코드")).toHaveValue("latest");
  await screen.getByRole("button", { name: "반영된 코드로 화면 준비", exact: true }).click();
  await expect(screen.getByLabel("확인할 코드")).toHaveValue("main");
  const saved = (await state(page))!.projects[0].automation!.turns;
  expect(saved.at(-1)).toMatchObject({ mode: "preview", previewAI: "codex", status: "queued" });
  expect(saved.at(-1)?.sourceTurnId).toBeUndefined();
  expect(saved.find(t => t.id === failed.id)).toMatchObject({ status: "failed", error: "work_source_changed", sourceTurnId: job.id });
});

test("로컬 LLM 선택은 구독 CLI와 구분해 저장하고 구버전 실행기 대기를 설명한다", async ({page}) => {
  const {observeWorkRunner}=await import("../../src/lib/automation/runner-status");
  const stamp=new Date().toISOString();
  const data=observeWorkRunner(automationWorkspace(stamp),{space:"company",projectIds:["auto-project"]},{runnerVersion:"2.6.0",previewVersion:1,remoteWorkVersion:1,previewCliVersion:1},stamp);
  await seed(page,data);await page.goto('/projects/auto-project');await ready(page);
  const screen=page.getByRole('region',{name:'수정된 화면 확인',exact:true});
  await screen.getByLabel('미리보기 AI').selectOption('ollama');
  await expect(screen).toContainText('맥미니에 설치된 TranslateGemma');
  await screen.getByRole('button',{name:'화면 준비',exact:true}).click();
  expect((await state(page))!.projects[0].automation!.turns.at(-1)?.previewAI).toBe('ollama');
  await page.reload();await ready(page);
  await expect(screen.getByLabel('미리보기 AI')).toHaveValue('ollama');
  await expect(screen).toContainText('실행기 2.7.0 적용 대기');
  await expect(page.getByRole('region',{name:'프로젝트 AI 작업실',exact:true})).toContainText('화면 준비 · 로컬 LLM 선택');
});

test("개발 작업 공간은 사진과 설명을 같은 요청에 저장하고 모바일 탭과 대화를 복원한다", async ({ page, isMobile }) => {
  const data = automationWorkspace(new Date().toISOString()); await seed(page, data); await page.goto("/projects/auto-project"); await ready(page);
  const nav = page.getByRole("navigation", { name: "개발 작업 보기" }), agent = page.getByRole("region", { name: "프로젝트 AI 작업실", exact: true });
  if (isMobile) {
    await nav.getByRole("button", { name: "개발 대화", exact: true }).click();
    await expect(agent).toBeVisible(); await expect(page.getByRole("region", { name: "수정된 화면 확인", exact: true })).not.toBeVisible();
  } else {
    const screen = (await page.getByRole("region", { name: "수정된 화면 확인", exact: true }).boundingBox())!, chat = (await agent.boundingBox())!;
    expect(screen.x + screen.width).toBeLessThan(chat.x + 1);
  }
  await agent.getByLabel("프로젝트 사진 첨부").setInputFiles({ name: "synthetic-screen.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1kAAAAASUVORK5CYII=", "base64") });
  await expect(agent).toContainText("synthetic-screen.jpg"); await agent.getByLabel("AI에게 요청", { exact: true }).fill("사진의 버튼 간격을 수정해주세요.");
  await agent.getByRole("button", { name: "요청 보내기", exact: true }).click();
  const saved = (await state(page))!, turn = saved.projects[0].automation!.turns.at(-1)!;
  expect(turn.images).toHaveLength(1); const doc = saved.documents.find(doc => doc.id === turn.images![0].id)!;
  expect(doc).toMatchObject({ projectId: "auto-project", space: "company", mime: "image/jpeg" }); expect(doc.size).toBeGreaterThan(10); expect(turn.images![0].sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(await page.evaluate(async fileId => { const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open("jarvis-workspace", 1); request.onsuccess = () => resolve(request.result); }); const blob = await new Promise<Blob>(resolve => { const request = db.transaction("files").objectStore("files").get(fileId); request.onsuccess = () => resolve(request.result); }); db.close(); return blob.size; }, doc.id)).toBe(doc.size);
  await page.reload(); await ready(page); await expect(agent).toContainText("첨부 사진 1장");
  if (isMobile) { await nav.getByRole("button", { name: "검사 결과", exact: true }).click(); await expect(page.getByRole("region", { name: "개발 검사 결과" })).toBeVisible(); await expect(agent).not.toBeVisible(); }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("개발 화면은 기존 서버를 새 요청 없이 열고 제한된 iframe은 새 탭으로 안내하며 서버 명령을 보관한다", async ({ page, isMobile }) => {
  const { enqueueWork, claimProjectWork, reportProjectWork } = await import("../../src/lib/automation/work");
  const stamp = new Date().toISOString(), first = claimProjectWork(enqueueWork(automationWorkspace(stamp), "company", "auto-project", "auto-service", "화면 준비", "preview", "pr", stamp), { space: "company", projectIds: ["auto-project"], deviceId: "runner", previews: true }, stamp), job = first.job!;
  const url = "https://synthetic-development.trycloudflare.com/";
  const data = reportProjectWork(first.data, "company", { projectId: job.projectId, jobId: job.id, leaseToken: job.leaseToken, phase: "result", result: { reply: "로컬 서버 실행", summary: "준비", currentStatus: "", nextAction: "", changes: [], checks: [], followUps: [], outcome: "answered", branch: null, baseSha: "a".repeat(40), headSha: null, prUrl: null, deployment: { state: "not_configured", url: null, sha: null }, preview: { state: "ready", kind: "remote", execution: "native", reused: true, remoteId: job.id, url, sha: "a".repeat(40), checkedAt: stamp, expiresAt: new Date(Date.now()+3600000).toISOString(), message: "기존 서버 재사용" } } }, "runner", stamp);
  await seed(page, data);
  await page.context().route("**/api/preview/open?**", route => route.fulfill({ contentType: "text/html", body: `<script>location.replace(${JSON.stringify(url)})</script>` }));
  await page.context().route(url + "**", route => route.fulfill({ contentType: "text/html", body: `<h1>Private fixture</h1><script>if(parent!==window)parent.postMessage({type:'jarvis-preview-open-tab'},'http://127.0.0.1:4317')</script>` }));
  await page.goto("/projects/auto-project"); await ready(page);
  const screen = page.getByRole("region", { name: "수정된 화면 확인", exact: true });
  if (isMobile) await page.getByRole("navigation", { name: "개발 작업 보기" }).getByRole("button", { name: "화면", exact: true }).click();
  await expect(screen).toContainText("실행 중인 서버 재사용"); await screen.getByRole("button", { name: "작업실에서 화면 보기", exact: true }).click();
  await expect(screen).toContainText("브라우저가 작업실 안의 연결을 제한했습니다").catch(async error => {
    const frames = await Promise.all(page.frames().map(async frame => ({ url: frame.url(), text: await frame.locator("body").innerText().catch(() => "unavailable") })));
    await test.info().attach("frame-debug", { body: JSON.stringify(frames), contentType: "application/json" }); throw error;
  });
  const popup = page.waitForEvent("popup"); await screen.getByRole("link", { name: "이 PC에서 화면 열기 ↗", exact: true }).click(); const app = await popup; await expect(app.locator("h1")).toHaveText("Private fixture"); await app.close();
  expect((await state(page))!.projects[0].automation!.turns).toHaveLength(1);
  await screen.getByRole("button", { name: "서버 로그", exact: true }).click(); expect((await state(page))!.projects[0].automation!.turns.at(-1)).toMatchObject({ runtimeAction: "logs", mode: "preview", status: "queued" });
});

test("첫 개발 프로젝트는 다른 서비스가 없어도 준비 결과를 자동으로 받는다", async ({ page }) => {
  const { emptyWorkspace } = await import("../../src/lib/workspace/types"), { newProjectSetup, claimSetup, reportSetup } = await import("../../src/lib/automation/provision");
  const stamp = new Date().toISOString(), data = emptyWorkspace();
  data.projects.push({ id: "first-native", name: "첫 로컬 개발", description: "합성 프로젝트", space: "company", stage: "development", createdAt: stamp, setup: newProjectSetup(stamp, "mac") });
  const remote = { company: { data, revision: 1 }, personal: { data: emptyWorkspace(), revision: 1 } };
  await page.clock.install();
  await page.route("**/api/account", route => route.fulfill({ json: { enabled: true, configured: true, authenticated: true, accountId: "11111111-1111-4111-8111-111111111111", deviceId: "synthetic-device" } }));
  await page.route("**/api/workspace?*", route => route.fulfill({ json: remote[new URL(route.request().url()).searchParams.get("space") as "company" | "personal"] }));
  await page.goto("/projects/first-native"); await ready(page);
  const setup = page.getByRole("region", { name: "프로젝트 자동 준비" }); await expect(setup).toContainText("2.9.0");
  const scope = { space: "company" as const, projectIds: ["first-native"], deviceId: "runner", development: true }, claim = claimSetup(data, scope, stamp), job = claim.job!;
  remote.company = { revision: 2, data: reportSetup(claim.data, "company", { projectId: job.projectId, jobId: job.id, leaseToken: job.leaseToken, phase: "result", result: { repository: "example/first-native", target: "mac", database: "none", reason: "로컬 개발", checks: [{ name: "저장소", status: "passed", detail: "합성 준비" }] } }, "runner", stamp) };
  await page.clock.fastForward(6000);
  await expect(setup).toContainText("개발 환경 준비 완료"); await expect(page.getByRole("button", { name: "화면 준비", exact: true })).toBeEnabled();
});
