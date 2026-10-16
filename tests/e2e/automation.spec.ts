import { test, expect, openDetails, seed, state, ready } from "../support/fixtures";
import { analyzed, collected, analysisRaw, automationWorkspace } from "../support/automation";
import { applyAnalysis } from "../../src/lib/automation/state";
import { parseAnalysis } from "../../src/lib/automation/facts";
test.setTimeout(60_000);
test("GitHub 점검 대기를 보존하고 비밀값 없는 현재 범위 설정을 받는다", async ({ page }) => {
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
  await setup.getByRole("button", { name: "현재 범위의 실행기 설정 받기" }).click();
  const download = await downloaded; const stream = await download.createReadStream(); const chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const config = JSON.parse(Buffer.concat(chunks).toString());
  expect(config).toEqual({ origin: "http://127.0.0.1:4317", provider: "codex", scopes: [{ space: "company", projectIds: ["auto-project"] }] });
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
  await expect(screen).toContainText("요청을 저장했습니다");
  await expect(screen.getByRole("button")).toBeDisabled();
  const saved = (await state(page))!;
  expect(saved.projects[0].automation!.turns[0].mode).toBe("preview"); expect(saved.tasks).toHaveLength(0);
  const { claimProjectWork, reportProjectWork } = await import("../../src/lib/automation/work");
  const claimed = claimProjectWork(saved, { space: "company", projectIds: ["auto-project"], deviceId: "runner", previews: true }, stamp), job = claimed.job!;
  const complete = reportProjectWork(claimed.data, "company", { projectId: job.projectId, jobId: job.id, leaseToken: job.leaseToken, phase: "result", result: {
    reply: "합성 미리보기 준비", summary: "화면 준비", currentStatus: "", nextAction: "", changes: [], checks: [], followUps: [], outcome: "answered", branch: null, baseSha: "a".repeat(40), headSha: null, prUrl: null,
    deployment: { state: "not_configured", url: null, sha: null }, preview: { state: "ready", kind: "mac", url: "http://127.0.0.1:45678/", sha: "a".repeat(40), checkedAt: stamp, expiresAt: new Date(Date.parse(stamp) + 60_000).toISOString(), message: "실행한 맥미니에서 열 수 있습니다." },
  } }, "runner", stamp);
  await seed(page, complete); await page.goto("/projects/auto-project"); await ready(page);
  await expect(screen.getByRole("link", { name: "맥미니에서 화면 열기" })).toHaveAttribute("href", "http://127.0.0.1:45678/");
  await expect(screen).toContainText("실행한 맥미니");
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("project-screen-mobile.png"), fullPage: true });
  await page.clock.fastForward(61_000);
  await expect(screen).toContainText("미리보기 시간 만료");
  await expect(screen.getByRole("link", { name: "맥미니에서 화면 열기" })).toHaveCount(0);
});
