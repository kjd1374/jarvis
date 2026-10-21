import { test, expect } from "@playwright/test";
import { emptyWorkspace } from "../../src/lib/workspace/types";
import { createStagedProject, projectStage, startDevelopment } from "../../src/lib/projects/lifecycle";
import { enqueuePlanning, claimPlanning, reportPlanning, savePlan, changePlanning, applyPlanningProposal } from "../../src/lib/projects/planning";
import { normalizeWorkspace } from "../../src/lib/workspace/validation";
import { mergeCloudWorkspace } from "../../src/lib/cloud/merge";
import { createBackup, parseBackup } from "../../src/lib/workspace/backup";
import { automationWorkspace } from "../support/automation";
import { claimProjectWork } from "../../src/lib/automation/work";
import { planningFailure } from "../../src/lib/projects/planning-status";
const stamp = "2026-10-20T01:00:00.000Z", later = "2026-10-20T01:00:01.000Z";
const scope = { space: "personal" as const, projectIds: ["idea"], deviceId: "runner-a" };
const answer = { reply: "목표와 검증할 가정을 정리했습니다.", document: "# 합성 기획안\n목표 사용자와 핵심 기능\n## 확인할 가정\n사용자 인터뷰 필요" };
function idea() { return createStagedProject(emptyWorkspace(), { space: "personal", name: "합성 아이디어", description: "개인 도구", stage: "idea", automatic: true }, stamp, "idea"); }
function claim() { return claimPlanning(enqueuePlanning(idea(), "personal", "idea", "첫 기획안을 만들어주세요", stamp), scope, later); }
test("알 수 없는 과거 오류도 코드를 보존하고 상세 원인이 없는 기록은 추측하지 않는다", () => {
  for (const code of ["network_error", "constructor", "__proto__"]) {
    expect(planningFailure({ status: "failed", error: code }).code).toBe(code);
  }
  expect(planningFailure({ status: "failed" })).toMatchObject({ code: "planning_failed", action: expect.stringContaining("기록된 상세 원인이 없습니다") });
  expect(planningFailure({ status: "interrupted" }).code).toBe("runner_interrupted");
});
test("기획 실행기 버전은 같은 분 안의 교체도 반영하며 기기 편집과 충돌하지 않는다", () => {
  const base = claimPlanning(idea(), { ...scope, runnerVersion: "2.9.2" }, stamp).data;
  const local = savePlan(base, "personal", "idea", "기기에 남긴 기획안", 0, later);
  local.projects[0].planning!.runnerVersion = "2.9.1";
  const remote = claimPlanning(base, { ...scope, runnerVersion: "2.9.3" }, later).data;
  const merged = mergeCloudWorkspace(base, local, remote);
  expect(merged.conflicts).toEqual([]);
  expect(merged.data.projects[0].planning).toMatchObject({ runnerVersion: "2.9.3", runnerSeenAt: later, document: { content: "기기에 남긴 기획안" } });
  const invalid = structuredClone(base); invalid.projects[0].planning!.runnerVersion = "private diagnostic";
  expect(() => normalizeWorkspace(invalid)).toThrow();
});
test("긴 기획은 heartbeat로 갱신한 임대 안에서 원래 5분이 지난 뒤에도 결과를 저장한다", () => {
  const c = claim(), j = c.job!, start = Date.parse(later);
  const body = { projectId: "idea", jobId: j.id, leaseToken: j.leaseToken };
  const live = reportPlanning(c.data, "personal", { ...body, phase: "heartbeat" }, scope.deviceId, new Date(start + 280000).toISOString());
  const completed = reportPlanning(live, "personal", { ...body, phase: "result", answer }, scope.deviceId, new Date(start + 330000).toISOString());
  expect(completed.projects[0].planning!.document.content).toBe(answer.document);
  expect(() => reportPlanning(c.data, "personal", { ...body, phase: "result", answer }, scope.deviceId, new Date(start + 330000).toISOString())).toThrow("stale_job");
});
test("단계 없는 기존 프로젝트는 자료·작업을 보존하고 개발 화면으로 해석한다", () => {
  const old = automationWorkspace(stamp), next = normalizeWorkspace(old);
  expect(next).toEqual(old); expect(next.projects[0].stage).toBeUndefined(); expect(projectStage(next.projects[0])).toBe("development");
});
test("아이디어와 서비스 등록은 자원을 만들지 않고 개발 자동 준비는 맥으로 제한한다", () => {
  const d = idea(); expect(d.services).toHaveLength(0); expect(d.projects[0].setup).toBeUndefined(); expect(d.projects[0].planning!.document.revision).toBe(0);
  const live = createStagedProject(d, { space: "personal", name: "서비스", description: "", stage: "live", launchUrl: "https://example.invalid/app", automatic: true }, stamp);
  expect(live.projects[1].launchUrl).toBe("https://example.invalid/app"); expect(live.projects[1].setup).toBeUndefined();
  expect(() => createStagedProject(d, { space: "personal", name: "bad", description: "", stage: "live", launchUrl: "javascript:alert(1)" }, stamp)).toThrow();
  const dev = createStagedProject(d, { space: "personal", name: "개발", description: "기능 구현", stage: "development", automatic: true }, stamp);
  expect(dev.projects[1].setup).toMatchObject({ target: "mac", requests: [{ request: "기능 구현" }] });
});
test("저장소 없는 기획 요청은 영역·프로젝트 범위 안에서만 가져간다", () => {
  const d = enqueuePlanning(idea(), "personal", "idea", "첫 기획", stamp);
  expect(claimPlanning(d, { ...scope, space: "company" }, later).job).toBeNull();
  expect(claimPlanning(d, { ...scope, projectIds: ["other"] }, later).job).toBeNull();
  expect(claimPlanning(d, scope, later).job).toMatchObject({ kind: "planning", projectId: "idea", document: "" });
  expect(() => enqueuePlanning(d, "company", "idea", "잘못된 영역", stamp)).toThrow();
});
test("중복 전송과 실행 중 추가 요청을 막고 완료 응답 재전송은 문서 버전을 늘리지 않는다", () => {
  const c = claim(), job = c.job!;
  expect(enqueuePlanning(c.data, "personal", "idea", job.request, stamp, job.id)).toBe(c.data);
  expect(() => enqueuePlanning(c.data, "personal", "idea", "다른 요청", stamp)).toThrow();
  const body = { projectId: "idea", jobId: job.id, leaseToken: job.leaseToken, phase: "result", answer };
  const d = reportPlanning(c.data, "personal", body, scope.deviceId, later);
  expect(d.projects[0].planning!.document).toMatchObject({ content: answer.document, revision: 1, author: "cli" });
  expect(reportPlanning(d, "personal", body, scope.deviceId, later)).toBe(d);
  expect(() => reportPlanning(d, "personal", body, "other-device", later)).toThrow("stale_job");
});
test("직접 편집 중 도착한 AI 결과는 제안으로 보관하고 명시 적용 시 새 버전을 만든다", () => {
  const c = claim(), j = c.job!;
  let d = savePlan(c.data, "personal", "idea", "직접 정리한 범위", 0, later);
  d = reportPlanning(d, "personal", { projectId: "idea", jobId: j.id, leaseToken: j.leaseToken, phase: "result", answer }, scope.deviceId, later);
  expect(d.projects[0].planning!.document.content).toBe("직접 정리한 범위");
  expect(d.projects[0].planning!.turns[0].appliedRevision).toBeUndefined();
  expect(() => applyPlanningProposal(d, "personal", "idea", j.id, 0, later)).toThrow();
  d = applyPlanningProposal(d, "personal", "idea", j.id, 1, later);
  expect(d.projects[0].planning!.document).toMatchObject({ revision: 2, content: answer.document });
  expect(d.projects[0].planning!.history.at(-1)!.content).toBe("직접 정리한 범위");
  expect(() => savePlan(d, "personal", "idea", "오래된 편집", 1, later)).toThrow();
});
test("취소·만료·다른 임대 응답은 거부하고 실패 재시도는 새 임대를 만든다", () => {
  const c = claim(), j = c.job!, body = { projectId: "idea", jobId: j.id, leaseToken: j.leaseToken, phase: "result", answer };
  expect(() => reportPlanning(c.data, "personal", { ...body, leaseToken: "bad" }, scope.deviceId, later)).toThrow("stale_job");
  expect(() => reportPlanning(c.data, "personal", body, scope.deviceId, "2026-10-20T02:00:00Z")).toThrow("stale_job");
  const cancelled = changePlanning(c.data, "personal", "idea", j.id, "cancel", later);
  expect(() => reportPlanning(cancelled, "personal", body, scope.deviceId, later)).toThrow("stale_job");
  const failed = reportPlanning(c.data, "personal", { ...body, phase: "error", error: "cli_limit" }, scope.deviceId, later);
  const retry = claimPlanning(changePlanning(failed, "personal", "idea", j.id, "retry", later), scope, later);
  expect(retry.job!.leaseToken).not.toBe(j.leaseToken);
  expect(() => reportPlanning(retry.data, "personal", body, scope.deviceId, later)).toThrow("stale_job");
});
test("기획안은 개발 전환에 남고 기존 저장소가 있으면 같은 저장소 작업의 맥락으로 전달한다", () => {
  let d = idea(); d = savePlan(d, "personal", "idea", answer.document, 0, later);
  const dev = startDevelopment(d, "personal", "idea", later);
  expect(dev.projects[0]).toMatchObject({ stage: "development", planning: { document: { content: answer.document } }, setup: { target: "mac" } });
  const repo = automationWorkspace(stamp).services[0]; d.services.push({ ...repo, space: "personal", projectId: "idea" });
  const existing = startDevelopment(d, "personal", "idea", later);
  expect(existing.projects[0].setup).toBeUndefined();
  const job = claimProjectWork(existing, { ...scope, runnerVersion: "2.9.5", remoteWork: true, development: true }, later).job!;
  expect(job.context.project.plan).toBe(answer.document);
  expect(() => startDevelopment(claim().data, "personal", "idea", later)).toThrow();
});
test("백업 복원은 기획 문서와 결과를 보존하고 대기·실행 요청을 멈춘다", async () => {
  const backup = await createBackup(claim().data, false);
  const restored = parseBackup(JSON.stringify(backup)).data;
  expect(restored.projects[0].planning!.turns[0]).toMatchObject({ status: "interrupted", error: "imported_request_review" });
  expect(restored.projects[0].planning!.turns[0].leaseToken).toBeUndefined();
});
test("응답 유실 후 서버의 기획 임대는 온전히 복원하고 서로 다른 문서 편집은 충돌로 보존한다", () => {
  const base = idea(), queued = enqueuePlanning(base, "personal", "idea", "기획", stamp), remote = claimPlanning(queued, scope, later).data;
  const ack = mergeCloudWorkspace(base, queued, remote);
  expect(ack.conflicts).toEqual([]); expect(ack.data.projects[0].planning!.turns).toEqual(remote.projects[0].planning!.turns);
  const a = savePlan(base, "personal", "idea", "기기 A", 0, later), b = savePlan(base, "personal", "idea", "기기 B", 0, later);
  const conflict = mergeCloudWorkspace(base, a, b);
  expect(conflict.conflicts).toContain("projects.idea.planning.document"); expect(conflict.data.projects[0].planning!.document.content).toBe("기기 A");
  expect(mergeCloudWorkspace(base, a, b, "remote").data.projects[0].planning!.document.content).toBe("기기 B");
  const following = enqueuePlanning(a, "personal", "idea", "후속 기획", later), running = claimPlanning(following, scope, later), j = running.job!;
  const fork = structuredClone(running.data); fork.projects[0].planning!.document = b.projects[0].planning!.document;
  const late = reportPlanning(fork, "personal", { projectId: "idea", jobId: j.id, leaseToken: j.leaseToken, phase: "result", answer }, scope.deviceId, later);
  expect(late.projects[0].planning!.document.content).toBe("기기 B"); expect(late.projects[0].planning!.turns.at(-1)!.appliedRevision).toBeUndefined();
});
test("휴대폰 기획안을 선택해도 더 진행된 서버 답변과 반영 이력을 삭제하지 않는다", () => {
  const base = idea(), phone = savePlan(base, "personal", "idea", "휴대폰에서 작성한 기획", 0, later);
  let remote = base;
  for (let i = 0; i < 2; i++) {
    const c = claimPlanning(enqueuePlanning(remote, "personal", "idea", `서버 기획 ${i}`, stamp), scope, later), j = c.job!;
    remote = reportPlanning(c.data, "personal", { projectId: "idea", jobId: j.id, leaseToken: j.leaseToken, phase: "result", answer }, scope.deviceId, later);
  }
  const merged = mergeCloudWorkspace(base, phone, remote, "local");
  expect(merged.data.projects[0].planning!.document.content).toBe("휴대폰에서 작성한 기획");
  expect(merged.data.projects[0].planning!.turns.at(-1)!.appliedRevision).toBe(2);
  expect(merged.data.projects[0].planning!.turns).toHaveLength(2);
});
