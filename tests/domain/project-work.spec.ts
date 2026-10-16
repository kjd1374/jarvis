import { test, expect } from "@playwright/test";
import { automationWorkspace, automationStamp as stamp } from "../support/automation";
import { enqueueWork, claimProjectWork, reportProjectWork, changeWorkState, parseWorkResult, parseWorkPreview } from "../../src/lib/automation/work";
import { normalizeWorkspace } from "../../src/lib/workspace/validation";
import { parseWebLinks, publicWebUrl } from "../../src/lib/automation/web-links";
import { projectQuickLinks } from "../../src/lib/workspace/project-connections";
const scope = { space: "company" as const, projectIds: ["auto-project"], deviceId: "device-a" };
const uuid = "11111111-1111-4111-8111-111111111111";
const result = { reply: "실제 변경과 검증을 정리했습니다.", summary: "화면 개선", currentStatus: "PR 검토", nextAction: "추가 회귀 검증", changes: ["src/page.tsx"], checks: [{ name: "CI", status: "passed", detail: "합성 검사" }], followUps: [{ title: "추가 회귀 검증", reason: "화면 범위를 넓혀 확인", kind: "todo" }], outcome: "pr_open", branch: `jarvis/work-${uuid}`, baseSha: "a".repeat(40), headSha: "b".repeat(40), prUrl: "https://github.com/example/synthetic/pull/10", deployment: { state: "not_configured", url: null, sha: null } };
function queued() { return enqueueWork(automationWorkspace(), "company", "auto-project", "auto-service", "모바일 버튼 수정", "change", "pr", stamp, uuid); }
test("프로젝트 요청은 원자적으로 저장되며 같은 제출을 중복 생성하지 않는다", () => {
  const data = queued();
  expect(enqueueWork(data, "company", "auto-project", "auto-service", "모바일 버튼 수정", "change", "pr", stamp, uuid)).toBe(data);
  expect(data.tasks).toHaveLength(1); expect(data.projects[0].automation!.turns).toHaveLength(1);
  expect(() => enqueueWork(data, "personal", "auto-project", "auto-service", "수정", "change", "pr", stamp)).toThrow();
  expect(normalizeWorkspace(data).projects[0].automation!.turns[0].publish).toBe("pr");
});
test("작업 임대는 영역·저장소·기기·토큰을 묶고 중단된 쓰기를 자동 재실행하지 않는다", () => {
  expect(claimProjectWork(queued(), { ...scope, space: "personal" }, stamp).job).toBeNull();
  const claim = claimProjectWork(queued(), scope, stamp), job = claim.job!;
  expect(job.context.executionContext).toMatchObject({ jarvisRunner: { connectedAt: stamp, provider: "codex", space: "company", projectId: "auto-project" }, targetRepository: "example/synthetic" });
  const body = { projectId: job.projectId, jobId: job.id, leaseToken: job.leaseToken, phase: "heartbeat" };
  expect(claimProjectWork(claim.data, scope, stamp).job).toBeNull();
  expect(() => reportProjectWork(claim.data, "company", body, "another-device", stamp)).toThrow();
  expect(() => reportProjectWork(claim.data, "company", { ...body, leaseToken: "old" }, scope.deviceId, stamp)).toThrow();
  const expired = claimProjectWork(claim.data, scope, "2026-10-15T10:11:00Z");
  expect(expired.job).toBeNull(); expect(expired.data.projects[0].automation!.turns[0].status).toBe("interrupted");
  const retried = changeWorkState(expired.data, "company", "auto-project", uuid, "retry", "2026-10-15T10:12:00Z");
  expect(claimProjectWork(retried, { ...scope, deviceId: "device-b" }, "2026-10-15T10:12:00Z").job).toBeNull();
  expect(claimProjectWork(retried, scope, "2026-10-15T10:12:00Z").job!.leaseToken).not.toBe(job.leaseToken);
  const changed = structuredClone(claim.data); changed.services[0].repositoryUrl = "https://github.com/example/other";
  expect(() => reportProjectWork(changed, "company", body, scope.deviceId, stamp)).toThrow();
});
test("응답은 후속 업무를 자동 등록하고 PR·병합·배포 완료를 구분한다", () => {
  const claim = claimProjectWork(queued(), scope, stamp), job = claim.job!;
  const body = { projectId: job.projectId, jobId: job.id, leaseToken: job.leaseToken, phase: "result", result };
  const data = reportProjectWork(claim.data, "company", body, scope.deviceId, stamp);
  expect(data.tasks).toHaveLength(2); expect(data.tasks[0].status).toBe("decision"); expect(data.tasks[1].status).toBe("todo");
  expect(data.projects[0].description).toBe("합성 목표");
  expect(normalizeWorkspace(data).projects[0].automation!.turns[0].result!.prUrl).toBe(result.prUrl);
  expect(() => reportProjectWork(claim.data, "company", { ...body, result: { ...result, outcome: "merged" } }, scope.deviceId, stamp)).toThrow();
  expect(() => parseWorkResult({ ...result, prUrl: "https://github.com/other/private/pull/1" }, "example/synthetic", "change")).toThrow();
  expect(() => parseWorkResult({ ...result, outcome: "deployed" }, "example/synthetic", "change")).toThrow();
  expect(() => parseWorkResult(result, "example/synthetic", "ask")).toThrow();
});
test("취소·연결 변경 후 늦은 작업 결과는 저장하지 않는다", () => {
  const claim = claimProjectWork(queued(), scope, stamp), job = claim.job!;
  const cancelled = changeWorkState(claim.data, "company", "auto-project", uuid, "cancel", stamp);
  expect(() => reportProjectWork(cancelled, "company", { projectId: job.projectId, jobId: job.id, leaseToken: job.leaseToken, phase: "result", result }, scope.deviceId, stamp)).toThrow();
  const switched = queued(); switched.services[0].repositoryUrl = "https://github.com/example/other";
  expect(claimProjectWork(switched, scope, stamp).data.projects[0].automation!.turns[0].error).toBe("repository_changed");
});
test("발견한 웹 링크는 출처·영역·프로젝트를 보존하고 비밀·내부 주소를 제외한다", () => {
  const data = automationWorkspace(), project = data.projects[0];
  const raw = [{ url: "https://synthetic-app.vercel.app", kind: "homepage", sourceUrl: "https://github.com/example/synthetic", environment: "홈페이지" }];
  data.services[0].monitoring!.webLinks = parseWebLinks(raw, "example/synthetic", stamp);
  expect(projectQuickLinks(data.services, project).web[0].href).toBe("https://synthetic-app.vercel.app/");
  expect(projectQuickLinks(data.services, { ...project, space: "personal" }).web).toEqual([]);
  const changed = structuredClone(data.services); changed[0].repositoryUrl = "https://github.com/example/other";
  expect(projectQuickLinks(changed, project).web).toEqual([]);
  for (const url of ["https://127.0.0.1", "https://localhost", "https://internal.local", "https://x.vercel.app/?token=secret", "javascript:alert(1)", "https://user:password@x.vercel.app"]) expect(publicWebUrl(url)).toBeNull();
  expect(() => parseWebLinks([{ ...raw[0], sourceUrl: "https://github.com/other/private" }], "example/synthetic", stamp)).toThrow();
});

test("백업 복원은 이전 실행 요청을 자동으로 재실행하지 않는다", async () => {
  const { parseBackup } = await import("../../src/lib/workspace/backup");
  const restored = parseBackup(JSON.stringify({ format: "jarvis-backup", version: 1, exportedAt: stamp, data: queued(), files: [], includesFiles: false })).data;
  expect(restored.projects[0].automation!.turns[0].status).toBe("interrupted");
  expect(claimProjectWork(restored, scope, stamp).job).toBeNull();
});

test("화면 준비는 새 실행기에만 배정하고 수정 업무나 AI 요청으로 처리하지 않는다", () => {
  const data = enqueueWork(automationWorkspace(), "company", "auto-project", "auto-service", "화면 준비", "preview", "pr", stamp, uuid);
  expect(data.tasks).toHaveLength(0);
  expect(claimProjectWork(data, scope, stamp).job).toBeNull();
  expect(claimProjectWork(data, { ...scope, previews: true }, stamp).job?.mode).toBe("preview");
});
test("미리보기는 커밋·확인 시각·접속 범위를 검증하고 내부 주소를 일반 배포로 허용하지 않는다", () => {
  const preview = { state: "ready", kind: "mac", url: "http://127.0.0.1:45678/", sha: "a".repeat(40), checkedAt: stamp, expiresAt: "2026-10-15T11:00:00Z", message: "맥미니 전용" };
  expect(parseWorkPreview(preview).kind).toBe("mac");
  for (const url of ["http://192.168.1.5:45678/", "http://127.0.0.1:22/", "http://127.0.0.1:99999/", "http://127.0.0.1:45678/admin", "javascript:alert(1)"])
    expect(() => parseWorkPreview({ ...preview, url })).toThrow();
  expect(() => parseWorkPreview({ ...preview, kind: "deployment", expiresAt: null })).toThrow();
  expect(() => parseWorkPreview({ ...preview, expiresAt: "2026-10-18T11:00:00Z" })).toThrow();
  expect(() => parseWorkPreview({ ...preview, sha: null })).toThrow();
  expect(() => parseWorkPreview({ ...preview, state: "failed" })).toThrow();
  expect(() => parseWorkResult({ ...result, preview: { ...preview, sha: "c".repeat(40) } }, "example/synthetic", "change")).toThrow();
});
