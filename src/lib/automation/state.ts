import { githubConnectionUrl, repositoryKey } from "../workspace/project-connections";
import { id, type Service, type Space, type WorkspaceData } from "../workspace/types";
import type { CliProvider, GitHubMonitoring, ProjectAnalysis } from "./types";

export function repositoryFor(service: Service) {
  const url = githubConnectionUrl(service);
  return url ? repositoryKey(url) : null;
}
export function requestInspection(service: Service, stamp: string): Service {
  const repository = repositoryFor(service);
  if (!repository) throw new Error("유효한 GitHub 저장소를 먼저 등록해주세요.");
  const prior = service.monitoring;
  if (prior?.enabled && prior.repository === repository &&
      (prior.job?.status === "queued" || prior.job?.status === "running" && Date.parse(prior.job.leaseUntil ?? "") > Date.parse(stamp)))
    return service;
  const monitoring: GitHubMonitoring = {
    lastSuccessAt: prior?.repository === repository ? prior.lastSuccessAt : null,
    lastAttemptAt: prior?.repository === repository ? prior.lastAttemptAt : null,
    error: prior?.repository === repository ? prior.error : null,
    nextRetryAt: prior?.repository === repository ? prior.nextRetryAt : null,
    enabled: true,
    automatic: prior?.automatic ?? true,
    intervalMinutes: prior?.intervalMinutes ?? 15,
    repository,
    inspection: prior?.inspection ?? null,
    analysis: prior?.analysis ?? null,
    previousAnalyses: prior?.previousAnalyses ?? [],
    job: { id: id(), repository, requestedAt: stamp, status: "queued", phase: "collect", attempt: 0 },
  };
  return { ...service, monitoring };
}
export function claimInspection(data: WorkspaceData, scope: {
  space: Space; projectIds: (string | null)[]; deviceId: string; provider: CliProvider;
}, stamp: string) {
  for (const service of data.services) {
    const monitor = service.monitoring;
    if (service.space !== scope.space || !scope.projectIds.includes(service.projectId) || !monitor?.enabled || repositoryFor(service) !== monitor.repository)
      continue;
    const job = monitor.job;
    if (job?.status === "running" && Date.parse(job.leaseUntil ?? "") > Date.parse(stamp)) continue;
    const due = monitor.automatic && (!monitor.lastAttemptAt || Date.parse(stamp) - Date.parse(monitor.lastAttemptAt) >= Math.max(15, monitor.intervalMinutes) * 60_000);
    if (job?.status !== "queued" && job?.status !== "running" && !due) continue;
    if (job?.status === "failed" && (job.attempt >= 3 || Date.parse(monitor.nextRetryAt ?? "") > Date.parse(stamp))) continue;
    const claimed = {
      ...(job?.status === "queued" || job?.status === "running" || job?.status === "failed" ? job : {
        id: id(), repository: monitor.repository, requestedAt: stamp, status: "queued" as const, phase: "collect" as const, attempt: 0,
      }),
      status: "running" as const,
      phase: "collect" as const,
      provider: scope.provider,
      attempt: (job && job.status !== "completed" ? job.attempt : 0) + 1,
      leaseOwner: scope.deviceId,
      leaseUntil: new Date(Date.parse(stamp) + 10 * 60_000).toISOString(),
      error: undefined,
    };
    const updated = { ...service, monitoring: { ...monitor, job: claimed, lastAttemptAt: stamp } };
    return { data: { ...data, services: data.services.map(s => s.id === service.id ? updated : s) }, service: updated };
  }
  return null;
}
export function requireLease(service: Service, jobId: unknown, deviceId: string, stamp: string) {
  const job = service.monitoring?.job;
  if (!service.monitoring?.enabled || !job || job.id !== jobId || job.status !== "running" || job.leaseOwner !== deviceId ||
      Date.parse(job.leaseUntil ?? "") <= Date.parse(stamp) || job.repository !== repositoryFor(service))
    throw new Error("실행 요청이 만료되었거나 저장소가 바뀌었습니다. 새 요청을 확인해주세요.");
  return job;
}
export function applyAnalysis(service: Service, analysis: ProjectAnalysis): Service {
  const prior = service.monitoring!;
  if (analysis.basis !== prior.inspection?.fingerprint || analysis.headSha !== prior.inspection.headSha || prior.job?.phase !== "analyze")
    throw new Error("분석 중 원본이 바뀌었습니다. 현재 자료로 다시 점검해주세요.");
  const old = prior.analysis;
  const decisions = new Map(old?.suggestions.map(s => [s.id, s]) ?? []);
  const updated = { ...analysis, suggestions: analysis.suggestions.map(s => {
    const decision = decisions.get(s.id);
    return decision && decision.state !== "proposed" ? { ...s, state: decision.state, taskId: decision.taskId } : s;
  }) };
  return { ...service, monitoring: {
    ...prior, analysis: updated,
    previousAnalyses: old && old.basis !== analysis.basis ? [...prior.previousAnalyses, old].slice(-5) : prior.previousAnalyses,
    job: { ...prior.job!, status: "completed", leaseOwner: undefined, leaseUntil: undefined },
  } };
}
export function actOnSuggestion(data: WorkspaceData, space: Space, serviceId: string, suggestionId: string, action: "adopt" | "dismiss", reviewed: boolean, stamp: string) {
  const service = data.services.find(s => s.id === serviceId && s.space === space);
  const suggestion = service?.monitoring?.analysis?.suggestions.find(s => s.id === suggestionId);
  if (!service || !suggestion) throw new Error("이 영역의 제안을 찾을 수 없습니다.");
  if (suggestion.state !== "proposed") return data;
  let tasks = data.tasks;
  let taskId = suggestion.taskId;
  if (action === "adopt") {
    const monitor = service.monitoring!;
    if (repositoryFor(service) !== monitor.repository || monitor.analysis!.basis !== monitor.inspection?.fingerprint ||
        monitor.analysis!.headSha !== monitor.inspection.headSha || monitor.error ||
        suggestion.sourceIds.some(sourceId => !data.sourceRecords.some(s => s.id === sourceId && !s.deletedAt && s.space === space && s.projectId === service.projectId && s.serviceId === serviceId)) ||
        Date.parse(stamp) - Date.parse(monitor.inspection.inspectedAt) > 86_400_000)
      throw new Error("현재 저장소 자료를 다시 확인한 뒤 제안을 채택해주세요.");
    if (suggestion.kind === "completion") {
      if (!reviewed) throw new Error("완료 근거를 직접 확인해주세요.");
      const target = tasks.find(t => t.id === taskId && t.space === space && t.projectId === service.projectId);
      if (!target) throw new Error("이 프로젝트의 연결 업무를 찾을 수 없습니다.");
      tasks = tasks.map(t => t.id === target.id ? { ...t, status: "done" as const } : t);
    } else {
      const existing = tasks.find(t => t.sourceSuggestionId === suggestion.id && t.space === space && t.projectId === service.projectId);
      taskId = existing?.id ?? id();
      if (!existing) tasks = [...tasks, { id: taskId, sourceSuggestionId: suggestion.id, space, projectId: service.projectId,
        title: suggestion.title, status: suggestion.kind === "task" ? "todo" : "decision", dueDate: "", createdAt: stamp }];
    }
  }
  return { ...data, tasks, services: data.services.map(s => s.id === serviceId ? {
    ...s, monitoring: { ...s.monitoring!, analysis: { ...s.monitoring!.analysis!, suggestions: s.monitoring!.analysis!.suggestions.map(item =>
      item.id === suggestionId ? { ...item, state: action === "adopt" ? "adopted" as const : "dismissed" as const, taskId } : item) } },
  } : s) };
}
