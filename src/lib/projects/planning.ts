import { id, type Project, type Space, type WorkspaceData } from "../workspace/types";

export type PlanDocument = { versionId: string; content: string; revision: number; updatedAt: string; author: "user" | "cli" };
export type PlanningTurn = {
  id: string; request: string; createdAt: string; updatedAt: string;
  status: "queued" | "running" | "completed" | "failed" | "interrupted" | "cancelled";
  attempt: number; baseRevision?: number; baseVersionId?: string; leaseOwner?: string; leaseToken?: string; leaseUntil?: string;
  error?: string; result?: { reply: string; document: string }; appliedRevision?: number;
};
export type ProjectPlanning = {
  document: PlanDocument;
  history: (PlanDocument & { id: string })[];
  turns: PlanningTurn[];
  runnerSeenAt?: string;
};
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
const date = (v: unknown): v is string => text(v, 100) && Number.isFinite(Date.parse(v));
const uuid = (v: unknown): v is string => text(v, 36) && /^[a-f0-9-]{36}$/.test(v);
const revision = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
export const planningBusy = (p: Project) => p.planning?.turns.some(t => ["queued", "running"].includes(t.status)) ?? false;
export function newPlanning(stamp: string): ProjectPlanning {
  return { document: { versionId: id(), content: "", revision: 0, updatedAt: stamp, author: "user" }, history: [], turns: [] };
}
export function validatePlanning(project: Project) {
  const p = project.planning;
  if (!p) { if (project.stage === "idea") throw new Error("기획안 정보를 확인해주세요."); return; }
  const doc = (d: PlanDocument) => d && uuid(d.versionId) && text(d.content, 16000) && revision(d.revision) && date(d.updatedAt) && ["user", "cli"].includes(d.author);
  if (!doc(p.document) || !Array.isArray(p.history) || p.history.length > 20 || p.history.some(d => !uuid(d.id) || !doc(d)) ||
    new Set(p.history.map(d => d.id)).size !== p.history.length || !Array.isArray(p.turns) || p.turns.length > 100 ||
    new Set(p.turns.map(t => t.id)).size !== p.turns.length || p.runnerSeenAt !== undefined && !date(p.runnerSeenAt)) throw new Error("기획안 형식을 확인해주세요.");
  for (const t of p.turns) {
    if (!uuid(t.id) || !text(t.request, 4000) || !t.request.trim() || !date(t.createdAt) || !date(t.updatedAt) ||
      !["queued", "running", "completed", "failed", "interrupted", "cancelled"].includes(t.status) || !Number.isInteger(t.attempt) || t.attempt < 0 || t.attempt > 100 ||
      t.baseRevision !== undefined && !revision(t.baseRevision) || t.baseVersionId !== undefined && !uuid(t.baseVersionId) || t.appliedRevision !== undefined && !revision(t.appliedRevision) ||
      t.leaseOwner !== undefined && !text(t.leaseOwner, 200) || t.leaseToken !== undefined && !uuid(t.leaseToken) || t.leaseUntil !== undefined && !date(t.leaseUntil) ||
      t.error !== undefined && !/^[a-z_]{1,100}$/.test(t.error) || t.status === "completed" && !t.result ||
      t.appliedRevision !== undefined && t.status !== "completed") throw new Error("기획 요청 형식을 확인해주세요.");
    if (t.result) parsePlanningAnswer(t.result);
  }
}
export function parsePlanningAnswer(value: unknown): { reply: string; document: string } {
  const r = value as { reply: unknown; document: unknown };
  if (!r || !text(r.reply, 6000) || !r.reply.trim() || !text(r.document, 16000) || !r.document.trim()) throw new Error("invalid_planning_answer");
  return { reply: r.reply, document: r.document };
}
function find(data: WorkspaceData, space: Space, projectId: string) {
  const p = data.projects.find(p => p.id === projectId && p.space === space);
  if (!p) throw new Error("이 영역의 프로젝트를 확인해주세요.");
  return p;
}
function replace(data: WorkspaceData, p: Project, planning: ProjectPlanning): WorkspaceData {
  return { ...data, projects: data.projects.map(row => row.id === p.id && row.space === p.space ? { ...row, planning } : row) };
}
function revised(p: ProjectPlanning, content: string, stamp: string, author: PlanDocument["author"]): ProjectPlanning {
  return { ...p, document: { versionId: id(), content, revision: p.document.revision + 1, updatedAt: stamp, author },
    history: [...p.history, { ...p.document, id: id() }].slice(-20) };
}
export function savePlan(data: WorkspaceData, space: Space, projectId: string, content: string, expected: number, stamp: string, expectedVersionId?: string) {
  const p = find(data, space, projectId), plan = p.planning ?? newPlanning(stamp);
  if (!text(content, 16000)) throw new Error("기획안은 16000자 이내로 입력해주세요.");
  if (plan.document.revision !== expected || expectedVersionId !== undefined && plan.document.versionId !== expectedVersionId) throw new Error("기획안이 변경됐습니다. 최신 내용을 확인한 뒤 저장해주세요.");
  return content === plan.document.content ? data : replace(data, p, revised(plan, content, stamp, "user"));
}
export function enqueuePlanning(data: WorkspaceData, space: Space, projectId: string, request: string, stamp: string, requestId = id()) {
  const p = find(data, space, projectId), plan = p.planning ?? newPlanning(stamp);
  if (p.stage !== "idea" || !text(request, 4000) || !request.trim()) throw new Error("기획 단계의 프로젝트와 요청을 확인해주세요.");
  if (plan.turns.some(t => t.id === requestId)) return data;
  if (planningBusy(p)) throw new Error("진행 중인 기획 요청을 기다리거나 취소해주세요.");
  if (plan.turns.length >= 100) throw new Error("기획 대화 보관 한도에 도달했습니다. 현재 기획안은 계속 편집할 수 있습니다.");
  return replace(data, p, { ...plan, turns: [...plan.turns, { id: requestId, request: request.trim(), createdAt: stamp, updatedAt: stamp, status: "queued", attempt: 0 }] });
}
export function changePlanning(data: WorkspaceData, space: Space, projectId: string, turnId: string, action: "cancel" | "retry", stamp: string) {
  const p = find(data, space, projectId), plan = p.planning, t = plan?.turns.find(t => t.id === turnId);
  if (!plan || !t || p.stage !== "idea" || action === "cancel" && !["queued", "running"].includes(t.status) ||
    action === "retry" && (!["failed", "interrupted"].includes(t.status) || planningBusy(p))) throw new Error("기획 요청 상태를 확인해주세요.");
  return replace(data, p, { ...plan, turns: plan.turns.map(row => row.id !== t.id ? row : { ...row,
    status: action === "cancel" ? "cancelled" : "queued", updatedAt: stamp, error: undefined, result: undefined,
    leaseOwner: undefined, leaseToken: undefined, leaseUntil: undefined }) });
}
export function applyPlanningProposal(data: WorkspaceData, space: Space, projectId: string, turnId: string, expected: number, stamp: string, expectedVersionId?: string) {
  const p = find(data, space, projectId), plan = p.planning, t = plan?.turns.find(t => t.id === turnId);
  if (!plan || p.stage !== "idea" || !t?.result || t.status !== "completed" || t.appliedRevision !== undefined || plan.document.revision !== expected || expectedVersionId !== undefined && plan.document.versionId !== expectedVersionId) throw new Error("최신 기획안과 적용할 제안을 다시 확인해주세요.");
  const next = revised(plan, t.result.document, stamp, "cli");
  return replace(data, p, { ...next, turns: next.turns.map(row => row.id === t.id ? { ...row, appliedRevision: next.document.revision } : row) });
}
export function claimPlanning(data: WorkspaceData, scope: { space: Space; projectIds: (string | null)[]; deviceId: string }, stamp: string) {
  for (const original of data.projects.filter(p => p.space === scope.space && scope.projectIds.includes(p.id) && p.stage === "idea")) {
    let plan = original.planning ?? newPlanning(stamp);
    plan = { ...plan, turns: plan.turns.map(t => t.status === "running" && Date.parse(t.leaseUntil ?? "") <= Date.parse(stamp)
      ? { ...t, status: "interrupted" as const, error: "runner_interrupted", updatedAt: stamp, leaseToken: undefined, leaseUntil: undefined } : t),
    runnerSeenAt: !plan.runnerSeenAt || Date.parse(stamp) - Date.parse(plan.runnerSeenAt) >= 60000 ? stamp : plan.runnerSeenAt };
    data = replace(data, original, plan);
    if (plan.turns.some(t => t.status === "running")) continue;
    const t = plan.turns.find(t => t.status === "queued");
    if (!t) continue;
    const claimed: PlanningTurn = { ...t, status: "running", updatedAt: stamp, attempt: t.attempt + 1, baseRevision: plan.document.revision, baseVersionId: plan.document.versionId,
      leaseOwner: scope.deviceId, leaseToken: id(), leaseUntil: new Date(Date.parse(stamp) + 300000).toISOString() };
    return { data: replace(data, original, { ...plan, turns: plan.turns.map(row => row.id === t.id ? claimed : row) }), job: {
      kind: "planning", id: t.id, space: scope.space, projectId: original.id, leaseToken: claimed.leaseToken, attempt: claimed.attempt,
      request: t.request, name: original.name, description: original.description, document: plan.document.content,
      history: plan.turns.filter(row => row.status === "completed").slice(-4).map(row => ({ request: row.request, reply: row.result!.reply })) } };
  }
  return { data, job: null };
}
export function reportPlanning(data: WorkspaceData, space: Space, body: Record<string, unknown>, device: string, stamp: string) {
  const p = find(data, space, String(body.projectId)), plan = p.planning, t = plan?.turns.find(t => t.id === body.jobId);
  if (!plan || !t || t.leaseOwner !== device || !t.leaseToken || t.leaseToken !== body.leaseToken) throw new Error("stale_job");
  if (body.phase === "result" && t.status === "completed") return data;
  if (p.stage !== "idea" || t.status !== "running" || Date.parse(t.leaseUntil ?? "") <= Date.parse(stamp)) throw new Error("stale_job");
  let next = plan;
  let turn: PlanningTurn;
  if (body.phase === "heartbeat") turn = { ...t, updatedAt: stamp, leaseUntil: new Date(Date.parse(stamp) + 300000).toISOString() };
  else if (body.phase === "error") turn = { ...t, status: "failed", updatedAt: stamp, leaseUntil: undefined, error: /^[a-z_]{1,100}$/.test(String(body.error)) ? String(body.error) : "planning_failed" };
  else if (body.phase === "result") {
    const result = parsePlanningAnswer(body.answer);
    turn = { ...t, result, status: "completed", updatedAt: stamp, leaseUntil: undefined };
    if (plan.document.revision === t.baseRevision && plan.document.versionId === t.baseVersionId) {
      next = revised(plan, result.document, stamp, "cli");
      turn.appliedRevision = next.document.revision;
    }
  } else throw new Error("invalid_planning_result");
  return replace(data, p, { ...next, runnerSeenAt: stamp, turns: next.turns.map(row => row.id === t.id ? turn : row) });
}
