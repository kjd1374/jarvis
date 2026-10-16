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
  if (!object(raw) || !["ready", "unavailable", "failed"].includes(String(raw.state)) || !["deployment", "mac"].includes(String(raw.kind)) ||
    typeof raw.sha !== "string" || !sha(raw.sha) || !date(raw.checkedAt) || !text(raw.message, 1000) ||
    !(raw.expiresAt === null || date(raw.expiresAt))) invalid();
  if (raw.state === "ready") {
    if (raw.kind === "deployment" && (!publicWebUrl(raw.url) || raw.expiresAt !== null)) invalid();
    if (raw.kind === "mac") {
      if (typeof raw.url !== "string" || !/^http:\/\/127\.0\.0\.1:[0-9]{4,5}\/$/.test(raw.url)) invalid();
      const port = Number(new URL(raw.url).port);
      if (port < 1024 || port > 65535 || !date(raw.expiresAt) || Date.parse(raw.expiresAt as string) <= Date.parse(raw.checkedAt as string) || Date.parse(raw.expiresAt as string) - Date.parse(raw.checkedAt as string) > 2 * 60 * 60_000) invalid();
    }
  } else if (raw.url !== null || raw.expiresAt !== null) invalid();
  return { state: raw.state as WorkPreview["state"], kind: raw.kind as WorkPreview["kind"], url: raw.url as string | null, sha: raw.sha,
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
  if ((mode === "ask" || mode === "preview") && (raw.outcome !== "answered" && raw.outcome !== "blocked" || raw.prUrl !== null || raw.branch !== null)) invalid();
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
      !text(turn.serviceId, 2048) || !text(turn.request, 8000) || !turn.request.trim() || !["ask", "change", "preview"].includes(turn.mode) || !["pr", "merge"].includes(turn.publish) ||
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
export function enqueueWork(data: WorkspaceData, space: Space, projectId: string, serviceId: string, request: string, mode: ProjectTurn["mode"], publish: ProjectTurn["publish"], stamp: string, turnId = id()) {
  const project = data.projects.find(p => p.id === projectId && p.space === space);
  const service = data.services.find(s => s.id === serviceId && s.space === space && s.projectId === projectId);
  const repository = service && repositoryFor(service);
  if (!project || !repository || !request.trim() || request.length > 8000) throw new Error("현재 프로젝트의 GitHub 연결과 요청 내용을 확인해주세요.");
  const turns = project.automation?.turns ?? [];
  if (turns.some(t => t.id === turnId)) return data;
  if (turns.length >= 500) throw new Error("프로젝트 대화 기록 한도에 도달했습니다. 백업 후 기록을 정리해주세요.");
  const turn: ProjectTurn = { id: turnId, serviceId, repository, request: request.trim(), mode, publish, status: "queued", phase: "queued", createdAt: stamp, updatedAt: stamp, attempt: 0 };
  return { ...data, projects: data.projects.map(p => p.id === projectId ? { ...p, automation: { turns: [...turns, turn] } } : p),
    tasks: mode === "change" ? [...data.tasks, { id: `work-${turnId}`, sourceMessageId: turnId, space, projectId, title: request.trim().slice(0, 160), status: "todo" as const, dueDate: "", createdAt: stamp }] : data.tasks };
}
export function changeWorkState(data: WorkspaceData, space: Space, projectId: string, turnId: string, action: "cancel" | "retry", stamp: string) {
  const project = data.projects.find(p => p.id === projectId && p.space === space), turn = project?.automation?.turns.find(t => t.id === turnId);
  if (!project || !turn || action === "retry" && !["failed", "interrupted"].includes(turn.status) || action === "cancel" && !["queued", "running", "failed", "interrupted"].includes(turn.status)) throw new Error("현재 요청 상태를 확인해주세요.");
  const next = updateTurn(data, project, { ...turn, status: action === "cancel" ? "cancelled" : "queued", phase: "queued", updatedAt: stamp, error: undefined, leaseOwner: undefined, leaseToken: undefined, leaseUntil: undefined });
  return { ...next, tasks: next.tasks.map(t => t.id === `work-${turn.id}` ? { ...t, status: action === "cancel" ? "decision" as const : "todo" as const } : t) };
}
export function claimProjectWork(data: WorkspaceData, scope: { space: Space; projectIds: (string | null)[]; deviceId: string; previews?: boolean }, stamp: string) {
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
      if (turn.executionDevice && turn.executionDevice !== scope.deviceId) continue;
      const service = current.services.find(s => s.id === turn.serviceId && s.space === project.space && s.projectId === project.id);
      if (!service || repositoryFor(service) !== turn.repository) {
        current = updateTurn(current, project, { ...turn, status: "failed", error: "repository_changed", updatedAt: stamp }); continue;
      }
      // Also serialize duplicate registrations of the same repository across projects.
      if (current.projects.some(p => p.automation?.turns.some(t => t.repository === turn.repository && ["running", "interrupted"].includes(t.status)))) continue;
      const claimed: ProjectTurn = { ...turn, status: "running", phase: "preparing", updatedAt: stamp, attempt: turn.attempt + 1,
        executionDevice: scope.deviceId, leaseOwner: scope.deviceId, leaseToken: id(), leaseUntil: new Date(Date.parse(stamp) + 10 * 60_000).toISOString() };
      current = updateTurn(current, project, claimed);
      current = { ...current, tasks: current.tasks.map(t => t.id === `work-${turn.id}` ? { ...t, status: "in_progress" as const } : t) };
      const history = turns.filter(t => t.status === "completed" && t.repository === turn.repository).slice(-6).map(t => ({ request: t.request, reply: t.result?.reply, prUrl: t.result?.prUrl }));
      return { data: current, job: { kind: "work", id: turn.id, space: project.space, projectId: project.id, serviceId: service.id, repository: turn.repository,
        provider: "codex", leaseToken: claimed.leaseToken, attempt: claimed.attempt, request: turn.request, mode: turn.mode, publish: turn.publish,
        context: { executionContext: {
          jarvisRunner: { connectedAt: stamp, provider: "codex", projectId: project.id, space: project.space },
          targetRepository: turn.repository,
          webWorkflow: "사용자는 브라우저에서 수정된 화면을 확인하려고 한다. GitHub 코드 주소와 실제 웹 주소를 구분한다. 실행기는 실제 배포 또는 맥미니의 별도 미리보기를 준비하고 확인된 주소를 결과에 덧붙인다. 사용자에게 프로젝트를 직접 다운로드하라는 안내로 작업을 대체하지 말고, 앱의 start/build 실행 조건이나 배포에 필요한 조건을 구체적으로 기록한다. 실행 전 미리보기·배포 완료를 주장하지 않는다.",
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
    return { ...next, services: next.services.map(s => s.id === turn.serviceId && s.monitoring ? { ...s, monitoring: { ...s.monitoring, runnerSeenAt: stamp, runnerVersion: "2.0.0" } } : s) };
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
