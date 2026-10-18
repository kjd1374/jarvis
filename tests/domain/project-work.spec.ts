import { test, expect } from "@playwright/test";
import { automationWorkspace, automationStamp as stamp } from "../support/automation";
import { enqueueWork, claimProjectWork, reportProjectWork, changeWorkState, parseWorkResult, parseWorkPreview } from "../../src/lib/automation/work";
import { normalizeWorkspace } from "../../src/lib/workspace/validation";
import { parseWebLinks, publicWebUrl } from "../../src/lib/automation/web-links";
import { projectQuickLinks } from "../../src/lib/workspace/project-connections";
import { observeWorkRunner, queuedWorkMessage } from "../../src/lib/automation/runner-status";
const scope = { space: "company" as const, projectIds: ["auto-project"], deviceId: "device-a" };
const uuid = "11111111-1111-4111-8111-111111111111";
const result = { reply: "실제 변경과 검증을 정리했습니다.", summary: "화면 개선", currentStatus: "PR 검토", nextAction: "추가 회귀 검증", changes: ["src/page.tsx"], checks: [{ name: "CI", status: "passed", detail: "합성 검사" }], followUps: [{ title: "추가 회귀 검증", reason: "화면 범위를 넓혀 확인", kind: "todo" }], outcome: "pr_open", branch: `jarvis/work-${uuid}`, baseSha: "a".repeat(40), headSha: "b".repeat(40), prUrl: "https://github.com/example/synthetic/pull/10", deployment: { state: "not_configured", url: null, sha: null } };
function queued() { return enqueueWork(automationWorkspace(), "company", "auto-project", "auto-service", "모바일 버튼 수정", "change", "pr", stamp, uuid); }
test("구독 CLI 미리보기는 명시적으로 저장하며 지원 실행기와 실제 응답 증거가 필요하다", () => {
  const data = enqueueWork(automationWorkspace(), "company", "auto-project", "auto-service", "구독 CLI 통역 확인", "preview", "pr", stamp, uuid, undefined, "codex");
  expect(normalizeWorkspace(data).projects[0].automation!.turns[0].previewAI).toBe("codex");
  expect(claimProjectWork(data, { ...scope, previews: true, remoteWork: true }, stamp).job).toBeNull();
  const claimed = claimProjectWork(data, { ...scope, previews: true, remoteWork: true, previewCli: true }, stamp), job = claimed.job!;
  expect(job.previewAI).toBe("codex");
  const preview = { state: "ready", kind: "remote", remoteId: uuid, url: "https://synthetic-cli.trycloudflare.com/", sha: "a".repeat(40), checkedAt: stamp, expiresAt: new Date(Date.parse(stamp) + 3600_000).toISOString(), message: "합성 CLI 응답 확인" };
  const report = { ...result, outcome: "answered", changes: [], followUps: [], prUrl: null, branch: null, headSha: null, preview };
  expect(() => reportProjectWork(claimed.data, "company", { projectId: job.projectId, jobId: job.id, leaseToken: job.leaseToken, phase: "result", result: report }, scope.deviceId, stamp)).toThrow();
  const ai = { provider: "codex", verifiedAt: stamp, sample: "Xin chào" };
  expect(parseWorkPreview({ ...preview, ai }).ai).toEqual(ai);
  const completed = reportProjectWork(claimed.data, "company", { projectId: job.projectId, jobId: job.id, leaseToken: job.leaseToken, phase: "result", result: { ...report, preview: { ...preview, ai } } }, scope.deviceId, stamp);
  expect(normalizeWorkspace(completed).projects[0].automation!.turns[0].result?.preview?.ai?.provider).toBe("codex");
  const observed = observeWorkRunner(data, scope, { runnerVersion: "2.5.0", previewVersion: 1, previewCliVersion: 1 }, stamp);
  expect(observed.services[0].monitoring!.runnerConnection?.previewCli).toBe(true);
  expect(queuedWorkMessage(data.projects[0].automation!.turns[0], observeWorkRunner(data, scope, { previewVersion: 1 }, stamp).services[0].monitoring, Date.parse(stamp))).toContain("2.5.0");
  expect(() => enqueueWork(automationWorkspace(), "company", "auto-project", "auto-service", "수정", "change", "pr", stamp, uuid, undefined, "codex")).toThrow();
});
test("실패한 원격 미리보기는 원인·단계·응답 코드를 보존하고 원문 로그는 받지 않는다", () => {
  const preview = { state: "failed", kind: "remote", url: null, sha: "a".repeat(40), checkedAt: stamp, expiresAt: null, message: "외부 응답 실패", diagnostic: { stage: "health", code: "remote_health_http", statusCode: 530, rawLog: "must-not-persist" } };
  const parsed = parseWorkPreview(preview);
  expect(parsed.diagnostic).toEqual({ stage: "health", code: "remote_health_http", statusCode: 530 });
  expect(parseWorkResult({ ...result, outcome: "blocked", changes: [], followUps: [], prUrl: null, branch: null, headSha: null, preview }, "example/synthetic", "preview").preview?.diagnostic).toEqual(parsed.diagnostic);
  expect(() => parseWorkPreview({ ...preview, diagnostic: { stage: "health", code: "private log\nsecret" } })).toThrow();
  expect(() => parseWorkPreview({ ...preview, diagnostic: { ...preview.diagnostic, statusCode: 999 } })).toThrow();
});
test("구버전 접속은 버전을 추정하지 않고 요청을 보존하며 업데이트 관측은 즉시 바뀐다", () => {
  const data = enqueueWork(automationWorkspace(), "company", "auto-project", "auto-service", "자동 테스트", "test", "pr", stamp, uuid);
  data.services[0].monitoring!.runnerVersion = "2.0.0";
  data.services.push({ ...structuredClone(data.services[0]), id: "personal-service", space: "personal", projectId: null });
  const old = observeWorkRunner(data, scope, { previewVersion: 1 }, stamp);
  const monitoring = old.services[0].monitoring!;
  expect(monitoring.runnerVersion).toBeUndefined(); expect(monitoring.runnerConnection?.version).toBeUndefined();
  expect(old.services[1]).toBe(data.services[1]);
  const turn = old.projects[0].automation!.turns[0];
  expect(queuedWorkMessage(turn, monitoring, Date.parse(stamp))).toContain("업데이트해야");
  expect(claimProjectWork(old, { ...scope, previews: true }, stamp).job).toBeNull();
  expect(old.projects[0].automation!.turns[0]).toMatchObject({ id: uuid, status: "queued", attempt: 0 });
  const nextStamp = new Date(Date.parse(stamp) + 1000).toISOString();
  const updated = observeWorkRunner(old, scope, { runnerVersion: "2.4.1", remoteWorkVersion: 1, previewVersion: 1 }, nextStamp);
  expect(normalizeWorkspace(updated).services[0].monitoring!.runnerConnection).toEqual({ version: "2.4.1", remoteWork: true, previews: true, seenAt: nextStamp });
  const claim = claimProjectWork(updated, { ...scope, remoteWork: true, previews: true }, nextStamp), job = claim.job!;
  expect(job.id).toBe(uuid);
  const heartbeat = reportProjectWork(claim.data, "company", { projectId: job.projectId, jobId: job.id, leaseToken: job.leaseToken, phase: "heartbeat" }, scope.deviceId, nextStamp);
  expect(heartbeat.services[0].monitoring!.runnerConnection?.version).toBe("2.4.1");
  // A correctly installed 2.4.0 client did not send its version; capability still suffices.
  const olderCompatible = observeWorkRunner(updated, scope, { remoteWorkVersion: 1, previewVersion: 1 }, nextStamp);
  expect(olderCompatible.services[0].monitoring!.runnerConnection?.version).toBeUndefined();
  expect(claimProjectWork(olderCompatible, { ...scope, remoteWork: true }, nextStamp).job?.id).toBe(uuid);
});
test("대기는 기능 미지원·미리보기 비활성·기능 미확인·접속 끊김을 구분한다", () => {
  const monitoring = observeWorkRunner(automationWorkspace(), scope, { remoteWorkVersion: 1 }, stamp).services[0].monitoring!;
  const clock = Date.parse(stamp);
  expect(queuedWorkMessage({ mode: "preview" }, monitoring, clock)).toContain("활성화되지 않았습니다");
  expect(queuedWorkMessage({ mode: "test" }, monitoring, clock)).toContain("실행 대기 중");
  expect(queuedWorkMessage({ mode: "test" }, { ...monitoring, runnerConnection: undefined }, clock)).toContain("지원 기능은 아직 확인되지");
  expect(queuedWorkMessage({ mode: "test" }, monitoring, clock + 121_000)).toContain("최근 응답이 없습니다");
});
test("원격 미리보기는 HTTPS 전용 호스트·실행 ID·2시간 만료를 함께 검증한다", () => {
  const preview = { state: "ready", kind: "remote", remoteId: uuid, url: "https://synthetic-preview.trycloudflare.com/", sha: "a".repeat(40), checkedAt: stamp, expiresAt: new Date(Date.parse(stamp) + 3600_000).toISOString(), message: "합성 원격 미리보기" };
  expect(parseWorkPreview(preview)).toEqual(preview);
  for (const url of ["http://synthetic-preview.trycloudflare.com/", "https://synthetic-preview.trycloudflare.com.evil.test/", "https://synthetic-preview.trycloudflare.com/path", "https://user@synthetic-preview.trycloudflare.com/", "http://127.0.0.1:45678/"])
    expect(() => parseWorkPreview({ ...preview, url })).toThrow();
  expect(() => parseWorkPreview({ ...preview, remoteId: undefined })).toThrow();
  expect(() => parseWorkPreview({ ...preview, expiresAt: new Date(Date.parse(stamp) + 3 * 3600_000).toISOString() })).toThrow();
});
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

test("최근 미병합 수정본은 같은 프로젝트·저장소에만 선택하며 새 실행기에 고정한 커밋을 전달한다", async () => {
  const { latestWorkSource } = await import("../../src/lib/automation/work");
  const claim = claimProjectWork(queued(), scope, stamp), job = claim.job!;
  const data = reportProjectWork(claim.data, "company", { projectId: job.projectId, jobId: job.id, leaseToken: job.leaseToken, phase: "result", result }, scope.deviceId, stamp);
  const recent = latestWorkSource(data.projects[0], "auto-service", "example/synthetic")!;
  expect(recent.id).toBe(uuid);
  expect(latestWorkSource(data.projects[0], "another-service", "example/synthetic")).toBeUndefined();
  expect(latestWorkSource(data.projects[0], "auto-service", "example/other")).toBeUndefined();
  const nextId = "22222222-2222-4222-8222-222222222222";
  for (const mode of ["test", "preview", "ask", "change"] as const) {
    const next = enqueueWork(data, "company", "auto-project", "auto-service", "선택한 수정본 확인", mode, "pr", stamp, nextId, recent.id);
    expect(normalizeWorkspace(next).projects[0].automation!.turns.at(-1)!.sourceTurnId).toBe(uuid);
    expect(claimProjectWork(next, { ...scope, previews: true }, stamp).job).toBeNull();
    const claimed = claimProjectWork(next, { ...scope, previews: true, remoteWork: true }, stamp).job!;
    expect(claimed.source).toEqual({ prUrl: result.prUrl, headSha: result.headSha, baseSha: result.baseSha, branch: result.branch });
    expect(claimed.context.history[0].outcome).toBe("pr_open");
    expect(claimed.context.history[0].checks).toEqual(result.checks);
    const removed = structuredClone(next); removed.projects[0].automation!.turns.shift();
    expect(claimProjectWork(removed, { ...scope, previews: true, remoteWork: true }, stamp).data.projects[0].automation!.turns[0].error).toBe("work_source_changed");
  }
  expect(() => enqueueWork(data, "company", "auto-project", "auto-service", "test", "test", "pr", stamp, nextId, nextId)).toThrow();
});
test("테스트 전용 요청은 작업을 생성하거나 PR·병합 결과를 받아들이지 않는다", () => {
  const data = enqueueWork(automationWorkspace(), "company", "auto-project", "auto-service", "테스트 실행", "test", "pr", stamp, uuid);
  expect(data.tasks).toHaveLength(0);
  expect(claimProjectWork(data, scope, stamp).job).toBeNull();
  expect(claimProjectWork(data, { ...scope, remoteWork: true }, stamp).job?.mode).toBe("test");
  expect(() => parseWorkResult(result, "example/synthetic", "test")).toThrow();
});
