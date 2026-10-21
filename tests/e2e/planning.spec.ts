import { test, expect, seed, state, ready } from "../support/fixtures";
import { emptyWorkspace } from "../../src/lib/workspace/types";
import { createStagedProject } from "../../src/lib/projects/lifecycle";
import { enqueuePlanning, claimPlanning, reportPlanning, savePlan } from "../../src/lib/projects/planning";
const stamp = new Date().toISOString();
function idea() { return createStagedProject(emptyWorkspace(), { space: "company", name: "합성 기획 프로젝트", description: "작은 개인 도구", stage: "idea" }, stamp, "idea"); }
test("과거 기획 실패의 원인을 표시하고 실행기 응답을 작업 성공과 구분한다", async ({ page, isMobile }) => {
  let data = savePlan(idea(), "company", "idea", "기존 기획안과 결정", 0, stamp);
  const cases = [
    ["cli_timeout", "기획 CLI 응답 대기 시간이 초과됐습니다."],
    ["invalid_planning_answer", "AI가 반환한 기획안의 내용·형식을 확인하지 못했습니다."],
    ["cli_unavailable", "맥미니에서 구독 CLI를 실행하지 못했습니다."],
    ["constructor", "기획 요청을 완료하지 못했습니다."],
  ];
  for (const [code] of cases) {
    const claim = claimPlanning(enqueuePlanning(data, "company", "idea", "합성 기획 요청", stamp), { space: "company", projectIds: ["idea"], deviceId: "runner", runnerVersion: "2.9.3" }, stamp), job = claim.job!;
    data = reportPlanning(claim.data, "company", { projectId: "idea", jobId: job.id, leaseToken: job.leaseToken, phase: "error", error: code }, "runner", stamp);
  }
  const original = structuredClone(data.projects[0].planning);
  await seed(page, data); await page.goto("/projects/idea"); await ready(page);
  if (isMobile) await page.getByRole("navigation", { name: "기획 공간 보기" }).getByRole("button", { name: "AI 대화", exact: true }).click();
  const chat = page.getByRole("region", { name: "기획 AI 대화", exact: true });
  await expect(chat.getByLabel("기획 실행기 버전", { exact: true })).toHaveText("버전 2.9.3");
  await expect(chat).toContainText("기획 실행기 응답 확인"); await expect(chat).not.toContainText("기획 CLI 연결됨");
  for (const [code, message] of cases) {
    const turn = chat.getByRole("article", { name: "기획 요청", exact: true }).filter({ has: page.locator("code", { hasText: code }) });
    await expect(turn).toContainText(message); await expect(turn).toContainText("요청과 기존 기획안은 보존됩니다.");
    await expect(turn.getByRole("button", { name: "기획 요청 재시도", exact: true })).toBeEnabled();
  }
  expect((await state(page))!.projects[0].planning).toEqual(original);
  await page.reload(); await ready(page);
  expect((await state(page))!.projects[0].planning).toEqual(original);
  if (isMobile) await page.getByRole("navigation", { name: "기획 공간 보기" }).getByRole("button", { name: "AI 대화", exact: true }).click();
  await expect(chat.locator("code", { hasText: "cli_timeout" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test("세 등록 카드 중 아이디어는 자원 생성 없이 기획 공간으로 열리고 문서·요청을 보존한다", async ({ page, isMobile }) => {
  await seed(page, emptyWorkspace()); await page.goto("/projects"); await ready(page);
  await page.getByRole("button", { name: "프로젝트 만들기", exact: true }).click();
  const form = page.getByRole("dialog", { name: "프로젝트 만들기", exact: true });
  await expect(form.getByRole("radio")).toHaveCount(3); await expect(form.getByRole("radio", { name: /아이디어부터/ })).toBeChecked();
  await form.getByLabel("프로젝트 이름", { exact: true }).fill("합성 새 아이디어");
  await form.getByLabel("프로젝트 설명", { exact: true }).fill("일상을 정리하는 도구");
  await expect(form.getByRole("checkbox")).toHaveCount(0);
  await form.getByRole("button", { name: "프로젝트 저장", exact: true }).click();
  const doc = page.getByRole("region", { name: "프로젝트 기획안", exact: true }); await expect(doc).toBeVisible();
  await doc.getByRole("button", { name: "직접 편집", exact: true }).click();
  await doc.getByLabel("기획안 내용", { exact: true }).fill("# 첫 기획안\n사용자와 해결할 문제");
  await doc.getByRole("button", { name: "기획안 저장", exact: true }).click();
  await expect(doc).toContainText("버전 1");
  if (isMobile) await page.getByRole("navigation", { name: "기획 공간 보기" }).getByRole("button", { name: "AI 대화", exact: true }).click();
  const chat = page.getByRole("region", { name: "기획 AI 대화", exact: true });
  await chat.getByLabel("기획 AI에게 요청").fill("완료 기준을 구체화해주세요");
  await chat.getByRole("button", { name: "기획 요청 보내기", exact: true }).click();
  await expect(chat).toContainText("이 기기에 저장됐습니다");
  const saved = (await state(page))!;
  expect(saved.projects[0]).toMatchObject({ stage: "idea", planning: { document: { revision: 1 }, turns: [{ status: "queued" }] } });
  expect(saved.projects[0].setup).toBeUndefined(); expect(saved.services).toHaveLength(0);
  await page.reload(); await expect(doc).toContainText("사용자와 해결할 문제");
  await expect(page.getByRole("button", { name: "개발 시작", exact: true })).toBeDisabled();
  const size = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, window: innerWidth })); expect(size.content).toBeLessThanOrEqual(size.window + 1);
});
test("AI 제안을 비교 적용하고 기획안을 보존한 채 개발로 전환한다", async ({ page, isMobile }) => {
  const queued = enqueuePlanning(idea(), "company", "idea", "핵심 기능 정리", stamp), claimed = claimPlanning(queued, { space: "company", projectIds: ["idea"], deviceId: "runner" }, stamp), j = claimed.job!;
  const manual = savePlan(claimed.data, "company", "idea", "직접 정리한 초안", 0, stamp);
  const data = reportPlanning(manual, "company", { projectId: "idea", jobId: j.id, leaseToken: j.leaseToken, phase: "result", answer: { reply: "범위를 구체화했습니다", document: "# 개선된 기획안\n핵심 기능과 완료 기준" } }, "runner", stamp);
  await seed(page, data); await page.goto("/projects/idea"); await ready(page);
  if (isMobile) await page.getByRole("navigation", { name: "기획 공간 보기" }).getByRole("button", { name: "AI 대화", exact: true }).click();
  const chat = page.getByRole("region", { name: "기획 AI 대화" });
  await expect(chat).toContainText("직접 편집된 기획안을 보존했습니다");
  await chat.getByText("AI 기획안 제안 보기", { exact: true }).click();
  await chat.getByRole("button", { name: "현재 기획안에 제안 적용", exact: true }).click();
  await expect.poll(async () => (await state(page))!.projects[0].planning!.document.revision).toBe(2);
  await page.getByRole("button", { name: "개발 시작", exact: true }).click();
  await expect(page.getByRole("region", { name: "프로젝트 AI 작업실", exact: true })).toBeVisible();
  const p = (await state(page))!.projects[0]; expect(p.stage).toBe("development"); expect(p.setup!.target).toBe("mac"); expect(p.planning!.document.content).toContain("핵심 기능과 완료 기준");
  await page.reload(); await ready(page); await expect(page.getByText("회사 프로젝트 · 개발", { exact: true })).toBeVisible();
});
test("완성 서비스 카드는 서비스로 연결하고 관리는 내부 화면에서 한다", async ({ page }) => {
  await seed(page, emptyWorkspace()); await page.goto("/projects"); await ready(page);
  await page.getByRole("button", { name: "프로젝트 만들기", exact: true }).click();
  const form = page.getByRole("dialog", { name: "프로젝트 만들기" });
  await form.getByRole("radio", { name: /완성된 서비스 등록하기/ }).check();
  await form.getByLabel("프로젝트 이름", { exact: true }).fill("합성 완성 서비스");
  await form.getByLabel("서비스 주소", { exact: true }).fill("https://example.invalid/service");
  await form.getByRole("button", { name: "프로젝트 저장", exact: true }).click();
  const link = page.getByRole("link", { name: "합성 완성 서비스 프로젝트 열기", exact: true });
  await expect(link).toHaveAttribute("href", "https://example.invalid/service"); await expect(link).toHaveAttribute("target", "_blank");
  await page.getByRole("link", { name: "합성 완성 서비스 관리", exact: true }).click();
  await expect(page.getByRole("heading", { name: "서비스 주소 관리", exact: true })).toBeVisible();
  await page.getByLabel("서비스 주소", { exact: true }).fill("https://example.invalid/updated");
  await page.getByRole("button", { name: "주소 저장", exact: true }).click();
  await expect(page.getByRole("link", { name: "서비스 열기 ↗", exact: true })).toHaveAttribute("href", "https://example.invalid/updated");
  expect((await state(page))!.projects[0].setup).toBeUndefined();
});

test('이전 프로젝트는 수정 창에서 개발 단계를 확정하고 입력 중인 정보와 기록을 보존한다',async({page})=>{
 const {automationWorkspace}=await import('../support/automation'),data=automationWorkspace(stamp),original=structuredClone(data.projects[0]);
 expect(original.stage).toBeUndefined();await seed(page,data);await page.goto('/projects/auto-project');await ready(page);
 await page.getByRole('button',{name:'프로젝트 수정',exact:true}).click();const dialog=page.getByRole('dialog',{name:'프로젝트 수정',exact:true});
 await dialog.getByLabel('프로젝트 이름',{exact:true}).fill('저장 전 이름 초안');await dialog.getByRole('button',{name:'개발 단계로 설정',exact:true}).click();
 await expect(dialog.getByRole('group',{name:'프로젝트 단계',exact:true})).toHaveText('프로젝트 단계 · 개발');await expect(dialog.getByLabel('프로젝트 이름',{exact:true})).toHaveValue('저장 전 이름 초안');
 const saved=(await state(page))!;expect(saved.projects[0]).toEqual({...original,stage:'development'});expect(saved.services).toEqual(data.services);expect(saved.projects[0].setup).toBeUndefined();
 await dialog.getByRole('button',{name:'취소',exact:true}).click();await page.reload();await ready(page);expect((await state(page))!.projects[0].stage).toBe('development');
 await page.getByRole('button',{name:'프로젝트 수정',exact:true}).click();await expect(dialog.getByRole('button',{name:'개발 단계로 설정',exact:true})).toHaveCount(0);
});
