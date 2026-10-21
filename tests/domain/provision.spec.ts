import { test, expect } from "@playwright/test";
import { emptyWorkspace, type WorkspaceData } from "../../src/lib/workspace/types";
import { newProjectSetup, queueSetupRequest, claimSetup, reportSetup, changeSetup } from "../../src/lib/automation/provision";
import { claimProjectWork } from "../../src/lib/automation/work";
import { normalizeWorkspace } from "../../src/lib/workspace/validation";
import { createBackup, parseBackup } from "../../src/lib/workspace/backup";
const stamp = "2026-10-19T10:00:00Z", scope = { space: "personal" as const, projectIds: ["project"], deviceId: "runner", runnerVersion: "2.9.6" };
const result = { repository: "example/new-project", target: "mac", database: "sqlite", reason: "맥미니", checks: [{ name: "저장소", status: "passed", detail: "초기 코드 확인" }] };
function initial(): WorkspaceData { return { ...emptyWorkspace(), projects: [{ id: "project", space: "personal", name: "새 앱", description: "저장", createdAt: stamp, setup: newProjectSetup(stamp) }] }; }
test("준비 중 요청을 보존하고 같은 임대 결과를 한 번만 적용해 대화 개발로 넘긴다", () => {
  let data = queueSetupRequest(initial(), "personal", "project", "그래프 구현", "change", "merge", stamp);
  const claimed = claimSetup(data, scope, stamp), job = claimed.job!;
  expect(claimSetup(claimed.data, { ...scope, deviceId: "other" }, stamp).job).toBeNull();
  data = queueSetupRequest(claimed.data, "personal", "project", "범례도 추가", "change", "pr", stamp);
  const body = { projectId: "project", jobId: job.id, leaseToken: job.leaseToken, phase: "result", result };
  expect(() => reportSetup(data, "personal", body, "other", stamp)).toThrow("stale_job");
  expect(() => reportSetup(data, "company", body, "runner", stamp)).toThrow("stale_job");
  const ready = reportSetup(data, "personal", body, "runner", stamp);
  expect(normalizeWorkspace(ready).projects[0].setup?.status).toBe("ready");
  expect(ready.services).toHaveLength(1); expect(ready.projects[0].automation?.turns).toHaveLength(2);
  expect(reportSetup(ready, "personal", body, "runner", stamp)).toBe(ready);
  expect(claimProjectWork(ready, { ...scope, remoteWork: true }, stamp).job).toBeNull();
  expect(claimProjectWork(ready, { ...scope, deviceId: "other", remoteWork: true, managedWork: true }, stamp).job).toBeNull();
  const work = claimProjectWork(ready, { ...scope, remoteWork: true, managedWork: true }, stamp).job!;
  expect(work.request).toBe("그래프 구현"); expect(work.context.project.environment?.database).toBe("sqlite");
});
test("취소·기기·영역을 넘지 않고 동일 실행기에서만 만료된 준비를 복구한다", () => {
  expect(claimSetup(initial(), { ...scope, space: "company" }, stamp).job).toBeNull();
  const first = claimSetup(initial(), scope, stamp), body = { projectId: "project", jobId: first.job!.id, leaseToken: first.job!.leaseToken, phase: "result", result };
  const cancelled = changeSetup(first.data, "personal", "project", "cancel", stamp);
  expect(() => reportSetup(cancelled, "personal", body, "runner", stamp)).toThrow();
  expect(claimSetup(first.data, { ...scope, deviceId: "other" }, "2026-10-19T10:11:00Z").job).toBeNull();
  const reclaimed = claimSetup(first.data, scope, "2026-10-19T10:11:00Z");
  expect(reclaimed.job!.id).toBe(first.job!.id); expect(reclaimed.job!.leaseToken).not.toBe(first.job!.leaseToken);
  expect(() => reportSetup(reclaimed.data, "personal", body, "runner", "2026-10-19T10:11:00Z")).toThrow();
});
test("백업에 클라우드 연결 정보를 내보내지 않고 가져온 자동 실행은 멈춘다", async () => {
  const data = initial(); data.providerConnections = { personal: { vercel: { sealed: "opaque", label: "Vercel", updatedAt: stamp } } };
  const backup = await createBackup(data, false);
  expect(backup.data.providerConnections).toBeUndefined();
  const restored = parseBackup(JSON.stringify(backup));
  expect(restored.data.projects[0].setup?.status).toBe("interrupted");
  expect(claimSetup(restored.data, scope, stamp).job).toBeNull();
});


test("명시적 맥 개발 환경은 구버전이 가져가지 않고 로컬 실행 역량을 기다린다", () => {
  const data = initial(); data.projects[0].setup = newProjectSetup(stamp, "mac");
  expect(claimSetup(data, scope, stamp).job).toBeNull();
  expect(claimSetup(data, { ...scope, development: true }, stamp).job).toMatchObject({ target: "mac", kind: "provision" });
});
