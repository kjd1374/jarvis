import { test, expect } from "@playwright/test";
import { emptyWorkspace } from "../../src/lib/workspace/types";
import { mergeCloudWorkspace } from "../../src/lib/cloud/merge";
import { automationWorkspace } from "../support/automation";

const stamp = "2026-10-15T00:00:00Z";
test("runner connection observations merge atomically without mixing versions and capabilities", () => {
  const base = automationWorkspace(stamp), local = structuredClone(base), remote = structuredClone(base);
  local.services[0].name = "사용자 편집";
  local.services[0].monitoring!.runnerConnection = { seenAt: stamp, version: "2.4.1", remoteWork: true, previews: true };
  remote.services[0].monitoring!.runnerConnection = { seenAt: "2026-10-15T00:01:00Z", remoteWork: false, previews: false };
  const result = mergeCloudWorkspace(base, local, remote, "local");
  expect(result.data.services[0].name).toBe("사용자 편집");
  expect(result.data.services[0].monitoring!.runnerConnection).toEqual(remote.services[0].monitoring!.runnerConnection);
  expect(result.conflicts).toEqual([]);
});
function fixture() {
  const data = emptyWorkspace();
  data.projects.push({ id: "project", space: "company", name: "합성", description: "기준", createdAt: stamp });
  return data;
}
test("known baseline combines independent fields and additions without overwriting either side", () => {
  const base = fixture(), local = structuredClone(base), remote = structuredClone(base);
  local.projects[0].name = "사용자 편집";
  local.projects[0].currentStatus = ""; // Opening an editor fills an unset optional field.
  remote.projects[0].currentStatus = "서버 결과";
  remote.notes.push({ id: "note", space: "company", projectId: "project", content: "서버 메모", createdAt: stamp, updatedAt: stamp });
  const merged = mergeCloudWorkspace(base, local, remote);
  expect(merged.conflicts).toEqual([]);
  expect(merged.data.projects[0]).toMatchObject({ name: "사용자 편집", currentStatus: "서버 결과" });
  expect(merged.data.notes).toEqual(remote.notes);
  expect(base.projects[0].name).toBe("합성");
});
test("overlapping fields need review but unrelated changes during review do not", () => {
  const base = fixture(), local = structuredClone(base), remote = structuredClone(base);
  local.projects[0].description = "내 편집"; remote.projects[0].description = "다른 기기 편집";
  expect(mergeCloudWorkspace(base, local, remote).conflicts).toEqual(["projects.project.description"]);
  const reviewed = mergeCloudWorkspace(base, local, remote, "local").data;
  const latest = structuredClone(remote); latest.projects[0].nextAction = "새 서버 진행";
  expect(mergeCloudWorkspace(remote, reviewed, latest).conflicts).toEqual([]);
  latest.projects[0].description = "검토 이후 새 편집";
  expect(mergeCloudWorkspace(remote, reviewed, latest).conflicts).toHaveLength(1);
});
test("legacy review keeps additions and cannot replay a stale execution", () => {
  const local = fixture(), remote = fixture();
  const turn = { id: "11111111-1111-4111-8111-111111111111", serviceId: "service", repository: "example/project", request: "합성 요청", mode: "change" as const, publish: "pr" as const, status: "queued" as const, phase: "queued" as const, createdAt: stamp, updatedAt: stamp, attempt: 0 };
  local.projects[0].automation = { turns: [turn, { ...turn, id: "22222222-2222-4222-8222-222222222222" }] };
  remote.projects[0].automation = { turns: [{ ...turn, status: "cancelled" }] };
  const merged = mergeCloudWorkspace(undefined, local, remote, "local");
  expect(merged.data.projects[0].automation?.turns.map(t => t.status)).toEqual(["cancelled", "queued"]);
});
test("deletion versus edit requires review and cross-space identity collisions are rejected", () => {
  const base = fixture(), local = structuredClone(base), remote = structuredClone(base);
  local.projects = []; remote.projects[0].description = "동시 편집";
  expect(mergeCloudWorkspace(base, local, remote).conflicts).toHaveLength(1);
  expect(mergeCloudWorkspace(base, local, remote, "remote").data.projects).toHaveLength(1);
  local.projects = structuredClone(base.projects); local.projects[0].space = "personal";
  expect(() => mergeCloudWorkspace(base, local, remote)).toThrow(/영역/);
});
test("legacy local preference preserves current runner observations while a heartbeat advances during review", () => {
  const local = automationWorkspace(), remote = structuredClone(local);
  local.projects[0].name = "보존할 내 이름";
  local.services[0].monitoring!.runnerSeenAt = "2026-10-15T10:00:00Z";
  remote.services[0].monitoring!.runnerSeenAt = "2026-10-15T10:01:00Z";
  const reviewed = mergeCloudWorkspace(undefined, local, remote, "local").data;
  const latest = structuredClone(remote);
  latest.services[0].monitoring!.runnerSeenAt = "2026-10-15T10:02:00Z";
  const merged = mergeCloudWorkspace(remote, reviewed, latest);
  expect(merged.conflicts).toEqual([]);
  expect(merged.data.projects[0].name).toBe("보존할 내 이름");
  expect(merged.data.services[0].monitoring!.runnerSeenAt).toBe("2026-10-15T10:02:00Z");
});

test("two devices selecting different projects do not block independent saved work", () => {
  const base = fixture();
  base.projects.push({ ...base.projects[0], id: "second", name: "다른 프로젝트" });
  base.activeProjects.company = null;
  const local = structuredClone(base), remote = structuredClone(base);
  local.activeProjects.company = "project";
  remote.activeProjects.company = "second";
  local.projects[0].description = "휴대폰 요청 설명";
  remote.projects[1].description = "맥미니 결과";
  const result = mergeCloudWorkspace(base, local, remote);
  expect(result.conflicts).toEqual([]);
  expect(result.data.activeProjects.company).toBe("project");
  expect(result.data.projects.map(p => p.description)).toEqual(["휴대폰 요청 설명", "맥미니 결과"]);
});

test("lost save acknowledgement adopts the exact submitted request already claimed by the runner", async () => {
  const { enqueueWork, claimProjectWork } = await import("../../src/lib/automation/work");
  const base = automationWorkspace();
  const local = enqueueWork(base, "company", "auto-project", "auto-service", "화면 준비", "preview", "pr", stamp);
  const remote = claimProjectWork(local, { space: "company", projectIds: ["auto-project"], deviceId: "runner", previews: true }, stamp).data;
  const result = mergeCloudWorkspace(base, local, remote);
  expect(result.conflicts).toEqual([]);
  expect(result.data.projects[0].automation?.turns).toEqual(remote.projects[0].automation?.turns);
  expect(result.data.projects[0].automation?.turns).toHaveLength(1);
});

test("acknowledgement recovery also preserves the claimed change task without replaying it", async () => {
  const { enqueueWork, claimProjectWork } = await import("../../src/lib/automation/work");
  const base = automationWorkspace();
  const local = enqueueWork(base, "company", "auto-project", "auto-service", "수정 요청", "change", "pr", stamp);
  const remote = claimProjectWork(local, { space: "company", projectIds: ["auto-project"], deviceId: "runner", remoteWork: true }, stamp).data;
  const merged = mergeCloudWorkspace(base, local, remote);
  expect(merged.conflicts).toEqual([]);
  expect(merged.data.tasks).toEqual(remote.tasks);
  expect(merged.data.projects[0].automation?.turns).toEqual(remote.projects[0].automation?.turns);
  const cancel = structuredClone(local);
  cancel.projects[0].automation!.turns[0].status = "cancelled";
  expect(mergeCloudWorkspace(base, cancel, remote).conflicts).toContain(`projects.auto-project.automation.turns.${cancel.projects[0].automation!.turns[0].id}`);
  const changed = structuredClone(local);
  changed.projects[0].automation!.turns[0].request = "다른 요청";
  expect(mergeCloudWorkspace(base, changed, remote).conflicts.length).toBeGreaterThan(0);
});
