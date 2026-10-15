import { test, expect, seed, state, ready } from "../support/fixtures";
import { analyzed, collected, analysisRaw, automationWorkspace } from "../support/automation";
import { applyAnalysis } from "../../src/lib/automation/state";
import { parseAnalysis } from "../../src/lib/automation/facts";
test.setTimeout(60_000);
test("GitHub 점검 대기를 보존하고 비밀값 없는 현재 범위 설정을 받는다", async ({ page }) => {
  await seed(page, automationWorkspace(new Date().toISOString()));
  await page.goto("/projects/auto-project"); await ready(page);
  const monitor = page.getByRole("region", { name: "합성 GitHub GitHub 점검" });
  await expect(monitor).toContainText("점검 요청 저장됨");
  await expect(monitor.getByRole("button", { name: "점검 대기·진행 중" })).toBeDisabled();
  expect((await state(page))!.services[0].lastSuccessAt).toBeNull();
  await page.reload(); await ready(page); await expect(monitor).toContainText("AI 분석 결과 없음");
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
  const monitor = page.getByRole("region", { name: "합성 GitHub GitHub 점검" });
  const complete = monitor.getByRole("button", { name: "확인한 업무 완료로 기록" });
  await expect(complete).toBeDisabled();
  await monitor.getByLabel("완료 조건과 근거를 직접 확인했습니다.").check(); await complete.click();
  await expect.poll(async () => (await state(page))!.tasks[0].status).toBe("done");
  const failed = analyzed(stamp); failed.services[0].monitoring!.error = "github_unavailable";
  failed.services[0].monitoring!.job = { ...failed.services[0].monitoring!.job!, status: "failed", error: "github_unavailable" };
  await seed(page, failed); await page.goto("/projects/auto-project"); await ready(page);
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
  await expect(page.getByRole("region", { name: "자동 수정 검증 결과", exact: true })).toContainText("통과 · GitHub CI");
  await expect(page.getByRole("region", { name: "자동 후속 업무", exact: true })).toContainText("태블릿 화면 회귀 확인");
  await expect(page.getByRole("region", { name: "자동 확인 사항", exact: true })).toContainText("문구 최종 확인");
  await expect(page.getByRole("region", { name: "프로젝트 바로가기", exact: true }).getByRole("link", { name: "웹 화면 열기", exact: true })).toHaveAttribute("href", "https://synthetic-project.vercel.app/");
  await page.reload(); await ready(page);
  expect((await state(page))!.tasks).toHaveLength(3);
  await page.screenshot({ path: info.outputPath("project-ai-results.png"), fullPage: true });
});
