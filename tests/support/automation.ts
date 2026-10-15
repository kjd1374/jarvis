import { emptyWorkspace, type Service } from "../../src/lib/workspace/types";
import { requestInspection, claimInspection, applyAnalysis } from "../../src/lib/automation/state";
import { acceptFacts, parseAnalysis } from "../../src/lib/automation/facts";
export const automationStamp = "2026-10-15T10:00:00.000Z";
export const head = "a".repeat(40);
export function automationWorkspace(stamp = automationStamp) {
  const data = emptyWorkspace();
  data.projects.push({ id: "auto-project", space: "company", name: "합성 점검 프로젝트", description: "합성 목표", createdAt: stamp });
  data.activeProjects.company = "auto-project";
  const service: Service = { id: "auto-service", space: "company", projectId: "auto-project", name: "합성 GitHub", webUrl: "https://github.com/example/synthetic", repositoryUrl: "https://github.com/example/synthetic", connector: "shortcut", favorite: true, createdAt: stamp, connectionStatus: "shortcut", lastSuccessAt: null, lastAttemptAt: null, error: null, nextRetryAt: null, failures: 0 };
  data.services.push(requestInspection(service, stamp));
  return data;
}
export function facts(stamp = automationStamp) {
  return { items: [{ externalId: "github:example/synthetic:file:README.md", title: "README.md", content: "합성 구조와 검증 기준", status: "reviewed", sourceUrl: `https://github.com/example/synthetic/blob/${head}/README.md`, sourceUpdatedAt: stamp }], deletedIds: [], unchangedIds: [], inspection: { repository: "example/synthetic", branch: "main", headSha: head, treeComplete: true, filesTotal: 1, reviewedPaths: ["README.md"], excludedFiles: 0, fileShas: { "README.md": head }, limitations: ["선택한 코드만 읽었으며 실행하지 않았습니다."] } };
}
export function collected(stamp = automationStamp) {
  const initial = automationWorkspace(stamp);
  const claim = claimInspection(initial, { space: "company", projectIds: ["auto-project"], deviceId: "device-a", provider: "codex" }, stamp)!;
  return acceptFacts(claim.data, claim.service, facts(stamp), stamp);
}
export function analysisRaw(sourceId: string) {
  return { summary: "합성 저장소 분석 결과", currentStatus: "검증 기준 확인 필요", nextAction: "합성 회귀 검증 추가", sourceIds: [sourceId], suggestions: [{ kind: "task", title: "합성 회귀 검증 추가", reason: "README의 검증 기준을 확인합니다.", sourceIds: [sourceId], taskId: null as string | null }] };
}
export function analyzed(stamp = automationStamp) {
  const data = collected(stamp);
  data.services[0] = applyAnalysis(data.services[0], parseAnalysis(data, data.services[0], analysisRaw(data.sourceRecords[0].id), stamp));
  return data;
}
