import type { GitHubMonitoring } from "./types";
import type { ProjectTurn } from "./work-types";
import type { Space, WorkspaceData } from "../workspace/types";
import { MIN_PROJECT_WORK_RUNNER, projectWorkRunnerReady } from "./work-runtime";

export function runnerProjectIds(data: WorkspaceData, space: Space, requested: (string | null)[], mode: "space" | "selected") {
  if (mode === "space") return [...new Set([null, ...data.projects.filter(p => p.space === space).map(p => p.id)])];
  if (requested.some(id => id !== null && !data.projects.some(p => p.id === id && p.space === space))) throw new Error("mixed_scope");
  return requested;
}

export function observeWorkRunner(data: WorkspaceData, scope: { space: Space; projectIds: (string | null)[]; projectScope?: "space" | "selected" }, body: Record<string, unknown>, stamp: string): WorkspaceData {
  const connection = { seenAt: stamp,
    version: typeof body.runnerVersion === "string" && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(body.runnerVersion) ? body.runnerVersion : undefined,
    ...(body.developmentVersion === 1 ? { development: true } : {}), remoteWork: body.remoteWorkVersion === 1, previews: body.previewVersion === 1, ...(body.previewLocalVersion === 1 ? { previewLocal: true } : {}), ...(body.previewCliVersion === 1 ? { previewCli: true } : {}), ...(scope.projectScope ? { projectScope: scope.projectScope } : {}) };
  return { ...data, services: data.services.map(service => {
    const m = service.monitoring, prior = m?.runnerConnection;
    if (service.space !== scope.space || !scope.projectIds.includes(service.projectId) || !m) return service;
    // Capability/version changes must be visible immediately, even inside the heartbeat interval.
    if (prior && prior.version === connection.version && !!prior.development === !!connection.development && prior.remoteWork === connection.remoteWork && prior.previews === connection.previews && !!prior.previewLocal === !!connection.previewLocal && !!prior.previewCli === !!connection.previewCli && prior.projectScope === connection.projectScope && Date.parse(stamp) - Date.parse(prior.seenAt) < 60_000) return service;
    return { ...service, monitoring: { ...m, runnerSeenAt: stamp, runnerVersion: undefined, runnerConnection: connection } };
  }) };
}

// Invoke only after validating the reporting job's lease/device. This keeps newly
// registered projects visible while the runner is occupied by a longer job.
export function refreshAutomaticRunner(data: WorkspaceData, space: Space, serviceId: string | undefined, stamp: string): WorkspaceData {
  if (serviceId === undefined) return data;
  const connection = data.services.find(s => s.space === space && s.id === serviceId && s.monitoring?.runnerConnection && s.monitoring.runnerConnection.projectScope !== "selected")?.monitoring?.runnerConnection;
  if (!connection) return data;
  return observeWorkRunner(data, { space, projectIds: runnerProjectIds(data, space, [], "space"), projectScope: "space" }, {
    runnerVersion: connection.version, developmentVersion: connection.development ? 1 : 0, remoteWorkVersion: connection.remoteWork ? 1 : 0,
    previewLocalVersion: connection.previewLocal ? 1 : 0, previewVersion: connection.previews ? 1 : 0, previewCliVersion: connection.previewCli ? 1 : 0,
  }, stamp);
}

export function runnerOnline(monitoring: GitHubMonitoring | undefined, clock: number) {
  return !!monitoring?.runnerSeenAt && clock - Date.parse(monitoring.runnerSeenAt) < 120_000;
}

export function queuedWorkMessage(turn: Pick<ProjectTurn, "mode" | "sourceTurnId" | "previewAI" | "images" | "runtimeAction">, monitoring: GitHubMonitoring | undefined, clock: number, native = false) {
  if (!runnerOnline(monitoring, clock)) return "실행기의 최근 응답이 없습니다. 연결되면 저장된 요청을 처리합니다.";
  const connection = monitoring?.runnerConnection;
  if (!connection) return "실행기 접속은 확인됐지만 지원 기능은 아직 확인되지 않았습니다. 다음 응답을 기다리고 있습니다.";
  if (turn.mode === "change" && !projectWorkRunnerReady(connection.version)) return `개발 지침이 수정된 실행기 ${MIN_PROJECT_WORK_RUNNER} 적용 대기 중입니다. 현재 버전 ${connection.version ?? "미확인"}에는 수정 요청을 넘기지 않으며 요청은 보관됩니다. 사용 중인 미리보기의 서버 종료 후 유휴 자동 갱신을 기다려주세요(최대 30분 주기).`;
  if ((native && turn.mode !== "ask" || turn.images?.length || turn.runtimeAction) && !connection.development) return "로컬 개발·사진 전달·서버 관리를 지원하는 실행기 2.9.0 적용 대기 중입니다. 요청과 사진은 보관됩니다.";
  if ((turn.mode === "test" || turn.sourceTurnId) && !connection.remoteWork)
    return "최근 응답한 실행기는 자동 테스트·수정본 선택을 지원하지 않습니다. 맥미니 실행기를 2.4.1 이상으로 업데이트해야 이 요청을 시작할 수 있습니다.";
  if (turn.mode === "preview" && !connection.previews)
    return "최근 응답한 실행기는 미리보기가 활성화되지 않았습니다. 맥미니 실행기 설정에서 화면 준비를 활성화해주세요.";
  if (turn.previewAI === "ollama" && !connection.previewLocal) return "로컬 LLM 연결을 지원하는 실행기 2.7.0 적용 대기 중입니다. 기존 임시 화면이 종료된 뒤 자동 업데이트됩니다.";
  if (turn.previewAI === "codex" && !connection.previewCli)
    return "구독 CLI 미리보기를 지원하는 실행기 2.5.0 이상과 원격 미리보기 활성화가 필요합니다. 저장된 요청은 준비된 실행기가 처리합니다.";
  return "요청이 실행 대기 중입니다. 먼저 시작한 작업이 있으면 끝난 뒤 처리합니다.";
}
