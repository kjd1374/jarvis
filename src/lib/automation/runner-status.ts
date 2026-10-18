import type { GitHubMonitoring } from "./types";
import type { ProjectTurn } from "./work-types";
import type { Space, WorkspaceData } from "../workspace/types";

export function observeWorkRunner(data: WorkspaceData, scope: { space: Space; projectIds: (string | null)[] }, body: Record<string, unknown>, stamp: string): WorkspaceData {
  const connection = { seenAt: stamp,
    version: typeof body.runnerVersion === "string" && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(body.runnerVersion) ? body.runnerVersion : undefined,
    remoteWork: body.remoteWorkVersion === 1, previews: body.previewVersion === 1, ...(body.previewCliVersion === 1 ? { previewCli: true } : {}) };
  return { ...data, services: data.services.map(service => {
    const m = service.monitoring, prior = m?.runnerConnection;
    if (service.space !== scope.space || !scope.projectIds.includes(service.projectId) || !m) return service;
    // Capability/version changes must be visible immediately, even inside the heartbeat interval.
    if (prior && prior.version === connection.version && prior.remoteWork === connection.remoteWork && prior.previews === connection.previews && !!prior.previewCli === !!connection.previewCli && Date.parse(stamp) - Date.parse(prior.seenAt) < 60_000) return service;
    return { ...service, monitoring: { ...m, runnerSeenAt: stamp, runnerVersion: undefined, runnerConnection: connection } };
  }) };
}

export function runnerOnline(monitoring: GitHubMonitoring | undefined, clock: number) {
  return !!monitoring?.runnerSeenAt && clock - Date.parse(monitoring.runnerSeenAt) < 120_000;
}

export function queuedWorkMessage(turn: Pick<ProjectTurn, "mode" | "sourceTurnId" | "previewAI">, monitoring: GitHubMonitoring | undefined, clock: number) {
  if (!runnerOnline(monitoring, clock)) return "실행기의 최근 응답이 없습니다. 연결되면 저장된 요청을 처리합니다.";
  const connection = monitoring?.runnerConnection;
  if (!connection) return "실행기 접속은 확인됐지만 지원 기능은 아직 확인되지 않았습니다. 다음 응답을 기다리고 있습니다.";
  if ((turn.mode === "test" || turn.sourceTurnId) && !connection.remoteWork)
    return "최근 응답한 실행기는 자동 테스트·수정본 선택을 지원하지 않습니다. 맥미니 실행기를 2.4.1 이상으로 업데이트해야 이 요청을 시작할 수 있습니다.";
  if (turn.mode === "preview" && !connection.previews)
    return "최근 응답한 실행기는 미리보기가 활성화되지 않았습니다. 맥미니 실행기 설정에서 화면 준비를 활성화해주세요.";
  if (turn.previewAI === "codex" && !connection.previewCli)
    return "구독 CLI 미리보기를 지원하는 실행기 2.5.0 이상과 원격 미리보기 활성화가 필요합니다. 저장된 요청은 준비된 실행기가 처리합니다.";
  return "요청이 실행 대기 중입니다. 먼저 시작한 작업이 있으면 끝난 뒤 처리합니다.";
}
