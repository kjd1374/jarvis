import { test, expect } from "@playwright/test";
import { automationWorkspace, automationStamp as stamp, facts, collected, analyzed, analysisRaw } from "../support/automation";
import { requestInspection, claimInspection, requireLease, applyAnalysis, actOnSuggestion } from "../../src/lib/automation/state";
import { acceptFacts, parseAnalysis, analysisInput } from "../../src/lib/automation/facts";
import { normalizeWorkspace } from "../../src/lib/workspace/validation";
import { searchWorkspace } from "../../src/lib/workspace/search";
const scope = { space: "company" as const, projectIds: ["auto-project"], deviceId: "device-a", provider: "codex" as const };
test("명시적 영역·프로젝트와 기기 임대가 중복 실행·늦은 결과를 차단한다", () => {
  const data = automationWorkspace();
  expect(requestInspection(data.services[0], stamp)).toBe(data.services[0]);
  expect(claimInspection(data, { ...scope, space: "personal" }, stamp)).toBeNull();
  expect(claimInspection(data, { ...scope, projectIds: [null] }, stamp)).toBeNull();
  const first = claimInspection(data, scope, stamp)!;
  expect(claimInspection(first.data, { ...scope, deviceId: "device-b" }, stamp)).toBeNull();
  const job = first.service.monitoring!.job!;
  expect(() => requireLease(first.service, job.id, "device-b", stamp)).toThrow();
  expect(() => requireLease(first.service, job.id, "device-a", "2026-10-15T10:11:00Z")).toThrow();
  const retry = claimInspection(first.data, { ...scope, deviceId: "device-b" }, "2026-10-15T10:11:00Z")!;
  expect(retry.service.monitoring!.job).toMatchObject({ attempt: 2, leaseOwner: "device-b" });
  expect(() => requireLease({ ...retry.service, monitoring: { ...retry.service.monitoring!, enabled: false } }, job.id, "device-b", stamp)).toThrow();
});
test("GitHub 사실은 중복 없이 저장하고 v4 업무 연결 상태는 바꾸지 않는다", () => {
  let data = automationWorkspace(); data.services[0].connector = "v4"; data.services[0].connectionStatus = "needs_connection";
  const claim = claimInspection(data, scope, stamp)!;
  data = acceptFacts(claim.data, claim.service, facts(), stamp);
  expect(data.services[0]).toMatchObject({ connector: "v4", connectionStatus: "needs_connection", lastSuccessAt: null, monitoring: { lastSuccessAt: stamp } });
  const fingerprint = data.services[0].monitoring!.inspection!.fingerprint;
  data = acceptFacts(data, data.services[0], facts(), "2026-10-15T10:01:00Z");
  expect(data.sourceRecords).toHaveLength(1);
  expect(data.services[0].monitoring!.inspection!.fingerprint).toBe(fingerprint);
  expect(searchWorkspace(data, { space: "company", query: "합성" })[0].freshness).toBe("fresh");
  expect(normalizeWorkspace(data).services[0].monitoring?.inspection).toBeTruthy();
});
test("부분 조회는 파일 삭제를 반영하지 않으며 다른 저장소·비밀값을 제한한다", () => {
  const data = collected(), service = data.services[0];
  expect(() => acceptFacts(data, service, { ...facts(), deletedIds: [data.sourceRecords[0].externalId], inspection: { ...facts().inspection, treeComplete: false } }, stamp)).toThrow();
  expect(() => acceptFacts(data, service, { ...facts(), items: [{ ...facts().items[0], sourceUrl: "https://github.com/other/repo" }] }, stamp)).toThrow();
  const updated = acceptFacts(data, service, { ...facts(), items: [{ ...facts().items[0], content: "ghp_" + "x".repeat(24) }] }, stamp);
  expect(updated.sourceRecords[0].content).toBe("[토큰 제외]");
  const changed = { ...data, services: [{ ...service, repositoryUrl: "https://github.com/example/new" }] };
  expect(searchWorkspace(changed, { space: "company", query: "" })).toHaveLength(0);
});
test("AI 출처·업무는 같은 프로젝트 자료만 허용하고 오래된 분석은 거절한다", () => {
  const data = collected(), service = data.services[0], raw = analysisRaw(data.sourceRecords[0].id);
  expect(() => parseAnalysis(data, service, { ...raw, sourceIds: ["other-space"] }, stamp)).toThrow();
  expect(() => parseAnalysis(data, service, { ...raw, suggestions: [{ ...raw.suggestions[0], kind: "completion" }] }, stamp)).toThrow();
  const result = parseAnalysis(data, service, raw, stamp);
  expect(() => applyAnalysis(service, { ...result, basis: "b".repeat(64) })).toThrow();
  expect(analysisInput(data, service).tasks).toEqual([]);
  expect(analysisInput(data, service).executionContext).toMatchObject({ jarvisRunner: { lastContactAt: stamp, githubReadAt: stamp }, targetRepository: "example/synthetic" });
});
test("제안 채택은 한 번만 등록하고 사용자 선택을 재분석 뒤에도 유지한다", () => {
  let data = analyzed(); const proposal = data.services[0].monitoring!.analysis!.suggestions[0];
  data = actOnSuggestion(data, "company", "auto-service", proposal.id, "adopt", false, stamp);
  data = actOnSuggestion(data, "company", "auto-service", proposal.id, "adopt", false, stamp);
  expect(data.tasks).toHaveLength(1);
  const service = { ...data.services[0], monitoring: { ...data.services[0].monitoring!, job: { ...data.services[0].monitoring!.job!, phase: "analyze" as const } } };
  const again = parseAnalysis(data, service, { ...analysisRaw(data.sourceRecords[0].id), summary: "재분석" }, stamp);
  expect(applyAnalysis(service, again).monitoring!.analysis!.suggestions[0].state).toBe("adopted");
  const absent = { ...service, monitoring: { ...service.monitoring!, previousAnalyses: [service.monitoring!.analysis!], analysis: { ...service.monitoring!.analysis!, suggestions: [] } } };
  expect(applyAnalysis(absent, again).monitoring!.analysis!.suggestions[0].state).toBe("adopted");
  expect(normalizeWorkspace(data).tasks).toHaveLength(1);
});
test("완료 제안은 직접 확인을 요구하고 오류·24시간 경과 시 채택하지 않는다", () => {
  const data = collected();
  data.tasks.push({ id: "task", space: "company", projectId: "auto-project", title: "기존 업무", status: "todo", dueDate: "", createdAt: stamp });
  const raw = analysisRaw(data.sourceRecords[0].id); raw.suggestions[0] = { ...raw.suggestions[0], kind: "completion", taskId: "task" };
  data.services[0] = applyAnalysis(data.services[0], parseAnalysis(data, data.services[0], raw, stamp));
  const proposal = data.services[0].monitoring!.analysis!.suggestions[0].id;
  expect(() => actOnSuggestion(data, "company", "auto-service", proposal, "adopt", false, stamp)).toThrow();
  expect(() => actOnSuggestion(data, "company", "auto-service", proposal, "adopt", true, "2026-10-17T10:00:00Z")).toThrow();
  const failed = structuredClone(data); failed.services[0].monitoring!.error = "github_unavailable";
  expect(() => actOnSuggestion(failed, "company", "auto-service", proposal, "adopt", true, stamp)).toThrow();
  expect(actOnSuggestion(data, "company", "auto-service", proposal, "adopt", true, stamp).tasks[0].status).toBe("done");
});
test("재수집이 과거 AI 판단의 인용 링크·시각을 바꾸지 않는다", () => {
  const data = analyzed(), prior = structuredClone(data.services[0].monitoring!.analysis!.citations);
  const changed = facts(); changed.items[0].content = "새 원문"; changed.items[0].sourceUrl = changed.items[0].sourceUrl.replace("a".repeat(40), "b".repeat(40));
  const updated = acceptFacts(data, data.services[0], changed, "2026-10-15T10:02:00Z");
  expect(updated.sourceRecords[0].sourceUrl).not.toBe(prior[0].sourceUrl);
  expect(updated.services[0].monitoring!.analysis!.citations).toEqual(prior);
});
test("긴 저장소 파일 경로도 기존 저장 검증을 통과한다", () => {
  const data = collected(), response = facts(), path = `${"folder/".repeat(45)}file.ts`;
  response.items[0] = { ...response.items[0], externalId: `github:example/synthetic:file:${path}`, title: path, sourceUrl: `https://github.com/example/synthetic/blob/${"a".repeat(40)}/${path}` };
  expect(normalizeWorkspace(acceptFacts(data, data.services[0], response, stamp)).sourceRecords).toHaveLength(2);
});
