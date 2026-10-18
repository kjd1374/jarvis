import { id, type Project, type Space, type WorkspaceData } from "../workspace/types";
import { repositoryFor } from "./state";
import { publicWebUrl } from "./web-links";
import type { ProjectTurn, WorkResult, WorkPreview } from "./work-types";
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, n: number): v is string => typeof v === "string" && v.length <= n;
const date = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v));
const sha = (v: unknown) => v === null || typeof v === "string" && /^[a-f0-9]{40,64}$/.test(v);
const strings = (v: unknown, n: number, length: number): v is string[] => Array.isArray(v) && v.length <= n && v.every(s => text(s, length));
const repo = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9_.-]{1,100}\/[a-z0-9_.-]{1,100}$/.test(v) && !v.includes("..");
const clean = (v: string) => v.replace(/\b(?:ghp_|gho_|github_pat_|sk-(?:proj-)?)[A-Za-z0-9_-]{16,}\b/g, "[토큰 제외]");
const phaseValues = ["queued", "preparing", "coding", "testing", "publishing", "reporting"];
function invalid(): never { throw new Error("프로젝트 실행 기록의 범위·형식을 확인해주세요."); }
export function parseWorkPreview(raw: unknown): WorkPreview {
  if (!object(raw) || !["ready", "unavailable", "failed"].includes(String(raw.state)) || !["deployment", "mac", "remote"].includes(String(raw.kind)) ||
    typeof raw.sha !== "string" || !sha(raw.sha) || !date(raw.checkedAt) || !text(raw.message, 1000) ||
    !(raw.expiresAt === null || date(raw.expiresAt))) invalid();
  if (raw.state === "ready") {
    if (raw.kind === "deployment" && (!publicWebUrl(raw.url) || raw.expiresAt !== null)) invalid();
    if (raw.kind === "mac" || raw.kind === "remote") {
      if (raw.kind === "mac") {
        if (typeof raw.url !== "string" || !/^http:\/\/127\.0\.0\.1:[0-9]{4,5}\/$/.test(raw.url)) invalid();
        const port = Number(new URL(raw.url).port);
        if (port < 1024 || port > 65535) invalid();
      } else if (typeof raw.url !== "string" || !/^https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com\/$/.test(raw.url) ||
        typeof raw.remoteId !== "string" || !/^[a-f0-9-]{36}$/.test(raw.remoteId)) invalid();
      if (!date(raw.expiresAt) || Date.parse(raw.expiresAt as string) <= Date.parse(raw.checkedAt as string) || Date.parse(raw.expiresAt as string) - Date.parse(raw.checkedAt as string) > 2 * 60 * 60_000) invalid();
    }
  } else if (raw.url !== null || raw.expiresAt !== null) invalid();
  let diagnostic: WorkPreview["diagnostic"];
  if (raw.diagnostic !== undefined) {
    const d = raw.diagnostic;
    if (!object(d) || raw.state === "ready" || !["docker", "build", "application", "configuration", "provisioning", "connection", "health", "module"].includes(String(d.stage)) ||
      typeof d.code !== "string" || !/^[a-z_]{1,80}$/.test(d.code) ||
      d.statusCode !== undefined && (!Number.isInteger(d.statusCode) || (d.statusCode as number) < 100 || (d.statusCode as number) > 599) ||
      d.exitCode !== undefined && (!Number.isInteger(d.exitCode) || (d.exitCode as number) < 0 || (d.exitCode as number) > 255)) invalid();
    diagnostic = { stage: d.stage as NonNullable<WorkPreview["diagnostic"]>["stage"], code: d.code,
      ...(d.statusCode === undefined ? {} : { statusCode: d.statusCode as number }), ...(d.exitCode === undefined ? {} : { exitCode: d.exitCode as number }) };
  }
  return { state: raw.state as WorkPreview["state"], kind: raw.kind as WorkPreview["kind"], url: raw.url as string | null, sha: raw.sha,
    ...(diagnostic ? { diagnostic } : {}),
    ...(raw.kind === "remote" && raw.state === "ready" ? { remoteId: raw.remoteId as string } : {}),
    checkedAt: raw.checkedAt as string, expiresAt: raw.expiresAt as string | null, message: clean(raw.message) };
}
export function parseWorkResult(raw: unknown, repository: string, mode: ProjectTurn["mode"]): WorkResult {
  if (!object(raw) || !text(raw.reply, 8000) || !raw.reply.trim() || !text(raw.summary, 4000) || !text(raw.currentStatus, 2000) || !text(raw.nextAction, 2000) ||
    !strings(raw.changes, 50, 500) || !Array.isArray(raw.checks) || raw.checks.length > 30 ||
    raw.checks.some(c => !object(c) || !text(c.name, 160) || !["passed", "failed", "not_run"].includes(String(c.status)) || !text(c.detail, 2000)) ||
    !Array.isArray(raw.followUps) || raw.followUps.length > 12 || raw.followUps.some(f => !object(f) || !text(f.title, 160) || !f.title.trim() || !text(f.reason, 2000) || !["todo", "decision"].includes(String(f.kind))) ||
    !["answered", "no_changes", "pr_open", "merged", "deployed", "blocked"].includes(String(raw.outcome)) ||
    !(raw.branch === null || text(raw.branch, 120) && /^jarvis\/work-[a-f0-9-]+$/.test(raw.branch)) || !sha(raw.baseSha) || !sha(raw.headSha) ||
    !(raw.prUrl === null || text(raw.prUrl, 2048) && new RegExp(`^https://github\\.com/${repository.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/pull/[1-9][0-9]*$`).test(raw.prUrl))) invalid();
  const d = raw.deployment;
  if (!object(d) || !["not_configured", "pending", "success", "failure"].includes(String(d.state)) || !sha(d.sha) || !(d.url === null || publicWebUrl(d.url))) invalid();
  if (mode !== "change" && (raw.outcome !== "answered" && raw.outcome !== "blocked" || raw.prUrl !== null || raw.branch !== null)) invalid();
  if (["pr_open", "merged", "deployed"].includes(String(raw.outcome)) && (!raw.prUrl || !raw.headSha || !raw.baseSha || !raw.branch)) invalid();
  if (raw.outcome === "deployed" && (d.state !== "success" || !d.sha || !d.url)) invalid();
  if (raw.preview !== undefined && ![raw.baseSha, raw.headSha, d.sha].includes(parseWorkPreview(raw.preview).sha)) invalid();
  return {
    ...(raw.preview === undefined ? {} : { preview: parseWorkPreview(raw.preview) }),
    reply: clean(raw.reply), summary: clean(raw.summary), currentStatus: clean(raw.currentStatus), nextAction: clean(raw.nextAction),
    changes: raw.changes.map(clean), checks: raw.checks.map(c => ({ name: clean(c.name), status: c.status, detail: clean(c.detail) })),
    followUps: raw.followUps.map(f => ({ title: clean(f.title), reason: clean(f.reason), kind: f.kind })),
    outcome: raw.outcome as WorkResult["outcome"], branch: raw.branch as string | null, baseSha: raw.baseSha as string | null,
    headSha: raw.headSha as string | null, prUrl: raw.prUrl as string | null,
    deployment: { state: d.state as WorkResult["deployment"]["state"], url: d.url as string | null, sha: d.sha as string | null },
  };
}
export function validateProjectAutomation(project: Project, data: WorkspaceData) {
  if (project.automation === undefined) return;
  if (!object(project.automation) || !Array.isArray(project.automation.turns) || project.automation.turns.length > 500) invalid();
  const ids = new Set();
  for (const turn of project.automation.turns) {
    if (!object(turn) || !text(turn.id, 100) || !/^[a-f0-9-]{36}$/.test(turn.id) || ids.has(turn.id) || !repo(turn.repository) ||
      !text(turn.serviceId, 2048) || !text(turn.request, 8000) || !turn.request.trim() || !["ask", "change", "preview", "test"].includes(turn.mode) || !["pr", "merge"].includes(turn.publish) ||
      turn.sourceTurnId !== undefined && (!text(turn.sourceTurnId, 100) || !/^[a-f0-9-]{36}$/.test(turn.sourceTurnId) || turn.sourceTurnId === turn.id) ||
      !["queued", "running", "completed", "failed", "interrupted", "cancelled"].includes(turn.status) || !phaseValues.includes(turn.phase) ||
      !date(turn.createdAt) || !date(turn.updatedAt) || !Number.isInteger(turn.attempt) || turn.attempt < 0 || turn.attempt > 100 ||
      turn.executionDevice !== undefined && !text(turn.executionDevice, 200) || turn.leaseOwner !== undefined && !text(turn.leaseOwner, 200) || turn.leaseToken !== undefined && !text(turn.leaseToken, 100) ||
      turn.leaseUntil !== undefined && !date(turn.leaseUntil) || turn.error !== undefined && !text(turn.error, 100)) invalid();
    // Deleted connections may leave historical turns, but never a cross-scope connection.
    if (data.services.some(s => s.id === turn.serviceId && (s.space !== project.space || s.projectId !== project.id))) invalid();
    if (turn.result) parseWorkResult(turn.result, turn.repository, turn.mode);
    ids.add(turn.id);
  }
}
function updateTurn(data: WorkspaceData, project: Project, turn: ProjectTurn) {
  return { ...data, projects: data.projects.map(p => p.id === project.id ? { ...p, automation: { turns: (p.automation?.turns ?? []).map(t => t.id === turn.id ? turn : t) } } : p) };
}
export function latestWorkSource(project: Project, serviceId: string, repository: string) {
  const latest = [...(project.automation?.turns ?? [])].reverse().find(t => t.serviceId === serviceId && t.repository === repository && t.mode === "change" && t.result?.headSha && t.result.prUrl);
  return latest?.result?.outcome === "pr_open" ? latest : undefined;
}
export function enqueueWork(data: WorkspaceData, space: Space, projectId: string, serviceId: string, request: string, mode: ProjectTurn["mode"], publish: ProjectTurn["publish"], stamp: string, turnId = id(), sourceTurnId?: string) {
  const project = data.projects.find(p => p.id === projectId && p.space === space);
  const service = data.services.find(s => s.id === serviceId && s.space === space && s.projectId === projectId);
  const repository = service && repositoryFor(service);
  if (!project || !repository || !request.trim() || request.length > 8000) throw new Error("현재 프로젝트의 GitHub 연결과 요청 내용을 확인해주세요.");
  const turns = project.automation?.turns ?? [];
  if (turns.some(t => t.id === turnId)) return data;
  if (sourceTurnId && !turns.some(t => t.id === sourceTurnId && t.serviceId === serviceId && t.repository === repository && t.mode === "change" && t.result?.prUrl && t.result.headSha && t.result.branch)) throw new Error("선택한 수정본의 프로젝트·저장소를 확인해주세요.");
  if (turns.length >= 500) throw new Error("프로젝트 대화 기록 한도에 도달했습니다. 백업 후 기록을 정리해주세요.");
  const turn: ProjectTurn = { id: turnId, serviceId, repository, request: request.trim(), mode, publish, ...(sourceTurnId ? { sourceTurnId } : {}), status: "queued", phase: "queued", createdAt: stamp, updatedAt: stamp, attempt: 0 };
  return { ...data, projects: data.projects.map(p => p.id === projectId ? { ...p, automation: { turns: [...turns, turn] } } : p),
    tasks: mode === "change" ? [...data.tasks, { id: `work-${turnId}`, sourceMessageId: turnId, space, projectId, title: request.trim().slice(0, 160), status: "todo" as const, dueDate: "", createdAt: stamp }] : data.tasks };
}
export function changeWorkState(data: WorkspaceData, space: Space, projectId: string, turnId: string, action: "cancel" | "retry", stamp: string) {
  const project = data.projects.find(p => p.id === projectId && p.space === space), turn = project?.automation?.turns.find(t => t.id === turnId);
  if (!project || !turn || action === "retry" && !["failed", "interrupted"].includes(turn.status) || action === "cancel" && !["queued", "running", "failed", "interrupted"].includes(turn.status)) throw new Error("현재 요청 상태를 확인해주세요.");
  const next = updateTurn(data, project, { ...turn, status: action === "cancel" ? "cancelled" : "queued", phase: "queued", updatedAt: stamp, error: undefined, leaseOwner: undefined, leaseToken: undefined, leaseUntil: undefined });
  return { ...next, tasks: next.tasks.map(t => t.id === `work-${turn.id}` ? { ...t, status: action === "cancel" ? "decision" as const : "todo" as const } : t) };
}
export function claimProjectWork(data: WorkspaceData, scope: { space: Space; projectIds: (string | null)[]; deviceId: string; previews?: boolean; remoteWork?: boolean }, stamp: string) {
  let current = data;
  for (const project of current.projects.filter(p => p.space === scope.space && scope.projectIds.includes(p.id))) {
    const turns = project.automation?.turns ?? [];
    // A write job is never silently replayed after a crash or lease loss.
    for (const turn of turns.filter(t => t.status === "running" && Date.parse(t.leaseUntil ?? "") <= Date.parse(stamp)))
      {
      current = updateTurn(current, project, { ...turn, status: "interrupted", error: "runner_interrupted", updatedAt: stamp, leaseToken: undefined, leaseUntil: undefined });
      current = { ...current, tasks: current.tasks.map(t => t.id === `work-${turn.id}` ? { ...t, status: "decision" as const } : t) };
    }
    if (turns.some(t => ["running", "interrupted"].includes(t.status))) continue;
    for (const turn of turns.filter(t => t.status === "queued")) {
      if (turn.mode === "preview" && !scope.previews) continue;
      if ((turn.mode === "test" || turn.sourceTurnId) && !scope.remoteWork) continue;
      if (turn.executionDevice && turn.executionDevice !== scope.deviceId) continue;
      const service = current.services.find(s => s.id === turn.serviceId && s.space === project.space && s.projectId === project.id);
      if (!service || repositoryFor(service) !== turn.repository) {
        current = updateTurn(current, project, { ...turn, status: "failed", error: "repository_changed", updatedAt: stamp }); continue;
      }
      const source = turn.sourceTurnId ? turns.find(t => t.id === turn.sourceTurnId && t.serviceId === turn.serviceId && t.repository === turn.repository && t.mode === "change")?.result : undefined;
      if (turn.sourceTurnId && (!source?.prUrl || !source.headSha || !source.branch || !source.baseSha)) {
        current = updateTurn(current, project, { ...turn, status: "failed", error: "work_source_changed", updatedAt: stamp }); continue;
      }
      // Also serialize duplicate registrations of the same repository across projects.
      if (current.projects.some(p => p.automation?.turns.some(t => t.repository === turn.repository && ["running", "interrupted"].includes(t.status)))) continue;
      const claimed: ProjectTurn = { ...turn, status: "running", phase: "preparing", updatedAt: stamp, attempt: turn.attempt + 1,
        executionDevice: scope.deviceId, leaseOwner: scope.deviceId, leaseToken: id(), leaseUntil: new Date(Date.parse(stamp) + 10 * 60_000).toISOString() };
      current = updateTurn(current, project, claimed);
      current = { ...current, tasks: current.tasks.map(t => t.id === `work-${turn.id}` ? { ...t, status: "in_progress" as const } : t) };
      const history = turns.filter(t => t.status === "completed" && t.serviceId === turn.serviceId && t.repository === turn.repository).slice(-6).map(t => ({ request: t.request, reply: t.result?.reply, outcome: t.result?.outcome, baseSha: t.result?.baseSha, headSha: t.result?.headSha, prUrl: t.result?.prUrl, checks: t.result?.checks, preview: t.result?.preview }));
      return { data: current, job: { kind: "work", id: turn.id, space: project.space, projectId: project.id, serviceId: service.id, repository: turn.repository,
        provider: "codex", leaseToken: claimed.leaseToken, attempt: claimed.attempt, request: turn.request, mode: turn.mode, publish: turn.publish,
        ...(source ? { source: { prUrl: source.prUrl!, headSha: source.headSha!, branch: source.branch!, baseSha: source.baseSha! } } : {}),
        context: { executionContext: {
          jarvisRunner: { connectedAt: stamp, provider: "codex", projectId: project.id, space: project.space },
          targetRepository: turn.repository,
          webWorkflow: "사용자는 다른 PC의 Jarvis 브라우저에서 개발·테스트·화면 확인을 완료한다. 맥미니는 실행 서버다. 사용자에게 node/npm 명령, JSON 설정 실행, localhost 접속을 일반 테스트 절차로 요구하지 않는다. 자동 테스트는 Jarvis의 테스트 실행, 화면은 화면 준비와 이 PC에서 화면 열기로 안내한다. 테스트 실행 결과와 실제 AI·외부 연동 성공은 별도다. 아직 준비하지 않은 링크나 실행 결과를 만들지 않는다. 과거 답변의 구현 주장은 실제 커밋·PR·검사 상태와 구분한다. PR 작성은 병합 완료가 아니다.",
          connectionScope: "이 요청은 승인된 Jarvis 실행기가 가져왔다. 실행기 연결과 대상 저장소 앱 내부 Codex/Claude 연동은 별개다. 앱에 어댑터가 없거나 격리 작업 폴더에서 CLI/네트워크를 사용할 수 없는 것은 호스트 실행기 미연결의 근거가 아니다. 호스트의 다른 공급자 로그인·연결 상태는 미확인이다.",
        }, project: { name: project.name, description: project.description }, history,
          tasks: current.tasks.filter(t => t.projectId === project.id && t.space === project.space).slice(-50).map(t => ({ title: t.title, status: t.status })) } } };
    }
  }
  return { data: current, job: null };
}
export function requireWorkLease(data: WorkspaceData, space: Space, body: Record<string, unknown>, deviceId: string, stamp: string) {
  const project = data.projects.find(p => p.id === body.projectId && p.space === space);
  const turn = project?.automation?.turns.find(t => t.id === body.jobId);
  const service = data.services.find(s => s.id === turn?.serviceId && s.space === space && s.projectId === project?.id);
  if (!project || !turn || !service || turn.status !== "running" || turn.leaseOwner !== deviceId || turn.leaseToken !== body.leaseToken ||
    Date.parse(turn.leaseUntil ?? "") <= Date.parse(stamp) || repositoryFor(service) !== turn.repository) throw new Error("stale_job");
  return { project, turn };
}
export function reportProjectWork(data: WorkspaceData, space: Space, body: Record<string, unknown>, deviceId: string, stamp: string) {
  const { project, turn } = requireWorkLease(data, space, body, deviceId, stamp);
  if (body.phase === "heartbeat") {
    const phase = typeof body.progress === "string" && phaseValues.includes(body.progress) ? body.progress as ProjectTurn["phase"] : turn.phase;
    const next = updateTurn(data, project, { ...turn, phase, updatedAt: stamp, leaseUntil: new Date(Date.parse(stamp) + 10 * 60_000).toISOString() });
    return { ...next, services: next.services.map(s => s.id === turn.serviceId && s.monitoring ? { ...s, monitoring: { ...s.monitoring, runnerSeenAt: stamp } } : s) };
  }
  if (body.phase === "error") {
    const error = typeof body.code === "string" && /^[a-z_]{1,100}$/.test(body.code) ? body.code : "work_failed";
    const partial = body.result ? parseWorkResult(body.result, turn.repository, turn.mode) : turn.result;
    const next = updateTurn(data, project, { ...turn, result: partial, status: "failed", error, updatedAt: stamp, leaseOwner: undefined, leaseToken: undefined, leaseUntil: undefined });
    return { ...next, tasks: next.tasks.map(t => t.id === `work-${turn.id}` ? { ...t, status: "decision" as const } : t) };
  }
  if (body.phase !== "result") invalid();
  const result = parseWorkResult(body.result, turn.repository, turn.mode);
  if (turn.publish === "pr" && ["merged", "deployed"].includes(result.outcome)) invalid();
  const next = updateTurn(data, project, { ...turn, status: "completed", phase: "reporting", result, error: undefined, updatedAt: stamp, leaseOwner: undefined, leaseToken: undefined, leaseUntil: undefined });
  const tasks = next.tasks.map(t => t.id === `work-${turn.id}` ? { ...t, status: result.outcome === "deployed" || result.outcome === "merged" && result.deployment.state === "not_configured" ? "done" as const : result.outcome === "merged" ? "in_progress" as const : "decision" as const } : t);
  const normalized = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  for (const [index, follow] of result.followUps.entries()) {
    if (tasks.some(t => t.space === space && t.projectId === project.id && normalized(t.title) === normalized(follow.title))) continue;
    tasks.push({ id: `work-follow-${turn.id}-${index}`, sourceSuggestionId: `work:${turn.id}:${index}`, space, projectId: project.id, title: follow.title,
      status: follow.kind, dueDate: "", createdAt: stamp });
  }
  return { ...next, tasks };
}
