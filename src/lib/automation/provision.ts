import { id, type Project, type Space, type WorkspaceData } from "../workspace/types";
import { repositoryFor, requestInspection } from "./state";
import { enqueueWork } from "./work";

export type ProjectSetup = {
  id: string;
  status: "queued" | "running" | "ready" | "failed" | "interrupted" | "cancelled";
  target: "auto" | "mac" | "vercel";
  database: "auto" | "none" | "supabase";
  createdAt: string;
  updatedAt: string;
  phase: string;
  attempt: number;
  leaseOwner?: string;
  leaseToken?: string;
  leaseUntil?: string;
  executionDevice?: string;
  error?: string;
  result?: SetupResult;
  requests: { id: string; request: string; mode: "ask" | "change"; publish: "pr" | "merge"; createdAt: string }[];
};
export type SetupResult = {
  repository: string;
  target: "mac" | "vercel";
  database: "none" | "sqlite" | "supabase";
  reason: string;
  vercelProjectId?: string;
  supabaseProjectId?: string;
  checks: { name: string; status: "passed" | "not_run"; detail: string }[];
};
const uuid = (v: unknown) => typeof v === "string" && /^[a-f0-9-]{36}$/.test(v);
const date = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v));
const text = (v: unknown, max: number) => typeof v === "string" && v.length <= max;
const repo = (v: unknown) => typeof v === "string" && /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(v) && !v.includes("..");
export function validateSetup(project: Project) {
  const s = project.setup;
  if (!s) return;
  if (!uuid(s.id) || !["queued", "running", "ready", "failed", "interrupted", "cancelled"].includes(s.status) ||
    !["auto", "mac", "vercel"].includes(s.target) || !["auto", "none", "supabase"].includes(s.database) ||
    !date(s.createdAt) || !date(s.updatedAt) || !text(s.phase, 160) || !Number.isInteger(s.attempt) || s.attempt < 0 || s.attempt > 100 ||
    !Array.isArray(s.requests) || s.requests.length > 100 || new Set(s.requests.map(r => r.id)).size !== s.requests.length ||
    s.requests.some(r => !uuid(r.id) || !text(r.request, 8000) || !r.request.trim() || !["ask", "change"].includes(r.mode) || !["pr", "merge"].includes(r.publish) || !date(r.createdAt)) ||
    s.leaseOwner !== undefined && !text(s.leaseOwner, 200) || s.executionDevice !== undefined && !text(s.executionDevice, 200) ||
    s.leaseToken !== undefined && !uuid(s.leaseToken) || s.leaseUntil !== undefined && !date(s.leaseUntil) || s.error !== undefined && !/^[a-z_]{1,100}$/.test(s.error)) throw new Error("프로젝트 자동 준비 형식을 확인해주세요.");
  if (s.result) parseSetupResult(s.result);
}
export function parseSetupResult(value: unknown): SetupResult {
  const r = value as SetupResult;
  if (!r || !repo(r.repository) || !["mac", "vercel"].includes(r.target) || !["none", "sqlite", "supabase"].includes(r.database) || !text(r.reason, 2000) ||
    !Array.isArray(r.checks) || r.checks.length > 20 || r.checks.some(c => !text(c.name, 160) || !["passed", "not_run"].includes(c.status) || !text(c.detail, 2000)) ||
    r.vercelProjectId !== undefined && !/^prj_[a-zA-Z0-9]{1,100}$/.test(r.vercelProjectId) ||
    r.supabaseProjectId !== undefined && !/^[a-z]{20}$/.test(r.supabaseProjectId) ||
    r.target === "vercel" && !r.vercelProjectId || r.database === "supabase" && !r.supabaseProjectId) throw new Error("invalid_setup_result");
  return { repository: r.repository, target: r.target, database: r.database, reason: r.reason, checks: r.checks.map(c => ({ name: c.name, status: c.status, detail: c.detail })),
    ...(r.vercelProjectId ? { vercelProjectId: r.vercelProjectId } : {}), ...(r.supabaseProjectId ? { supabaseProjectId: r.supabaseProjectId } : {}) };
}
export function newProjectSetup(stamp: string, target: ProjectSetup["target"] = "auto", database: ProjectSetup["database"] = "auto"): ProjectSetup {
  return { id: id(), status: "queued", target, database, createdAt: stamp, updatedAt: stamp, phase: "실행기 자동 준비 대기", attempt: 0, requests: [] };
}
export function queueSetupRequest(data: WorkspaceData, space: Space, projectId: string, request: string, mode: "ask" | "change", publish: "pr" | "merge", stamp: string, requestId = id()) {
  const p = data.projects.find(p => p.space === space && p.id === projectId);
  if (!p || !request.trim() || request.length > 8000) throw new Error("프로젝트와 요청을 확인해주세요.");
  const setup = p.setup ?? newProjectSetup(stamp, "mac");
  if (setup.requests.some(r => r.id === requestId)) return data;
  if (setup.requests.length >= 100 || setup.status === "cancelled") throw new Error("자동 준비 상태를 확인해주세요.");
  return { ...data, projects: data.projects.map(row => row.id === p.id ? { ...row, setup: { ...setup, requests: [...setup.requests, { id: requestId, request: request.trim(), mode, publish, createdAt: stamp }] } } : row) };
}
function replace(data: WorkspaceData, project: Project, setup: ProjectSetup): WorkspaceData {
  return { ...data, projects: data.projects.map(p => p.id === project.id ? { ...p, setup } : p) };
}
export function changeSetup(data: WorkspaceData, space: Space, projectId: string, action: "retry" | "cancel", stamp: string) {
  const p = data.projects.find(p => p.id === projectId && p.space === space), s = p?.setup;
  if (!p || !s || action === "retry" && !["failed", "interrupted", "cancelled"].includes(s.status) || action === "cancel" && !["queued", "running", "failed", "interrupted"].includes(s.status)) throw new Error("자동 준비 상태를 확인해주세요.");
  return replace(data, p, { ...s, status: action === "retry" ? "queued" : "cancelled", updatedAt: stamp, leaseOwner: undefined, leaseUntil: undefined, leaseToken: undefined, error: undefined });
}
export function claimSetup(data: WorkspaceData, scope: { space: Space; projectIds: (string | null)[]; deviceId: string; development?: boolean }, stamp: string) {
  for (const p of data.projects.filter(p => p.space === scope.space && scope.projectIds.includes(p.id))) {
    let s = p.setup;
    if (!s || s.target === "mac" && !scope.development) continue;
    if (s.status === "running" && Date.parse(s.leaseUntil ?? "") <= Date.parse(stamp)) {
      // A journal + deterministic resource identity makes recovery idempotent on the same device.
      s = { ...s, status: "queued", leaseToken: undefined, leaseUntil: undefined };
      data = replace(data, p, s);
    }
    if (s.status !== "queued" || s.executionDevice && s.executionDevice !== scope.deviceId) continue;
    const claimed: ProjectSetup = { ...s, status: "running", attempt: s.attempt + 1, phase: "실행 환경 확인", updatedAt: stamp,
      executionDevice: scope.deviceId, leaseOwner: scope.deviceId, leaseToken: id(), leaseUntil: new Date(Date.parse(stamp) + 600_000).toISOString() };
    const existing = data.services.find(v => v.space === p.space && v.projectId === p.id && repositoryFor(v));
    return { data: replace(data, p, claimed), job: { kind: "provision", id: s.id, projectId: p.id, space: p.space, leaseToken: claimed.leaseToken,
      target: s.target, database: s.database, name: p.name, description: p.description, ...(existing ? { repository: repositoryFor(existing) } : {}) } };
  }
  return { data, job: null };
}
export function reportSetup(data: WorkspaceData, space: Space, body: Record<string, unknown>, deviceId: string, stamp: string) {
  const p = data.projects.find(p => p.id === body.projectId && p.space === space), s = p?.setup;
  if (!p || !s || s.id !== body.jobId || s.executionDevice !== deviceId) throw new Error("stale_job");
  if (s.status === "ready" && body.phase === "result") return data;
  if (s.status !== "running" || s.leaseToken !== body.leaseToken || s.leaseOwner !== deviceId || Date.parse(s.leaseUntil ?? "") <= Date.parse(stamp)) throw new Error("stale_job");
  if (body.phase === "heartbeat") return replace(data, p, { ...s, phase: text(body.progress, 160) ? body.progress as string : s.phase, updatedAt: stamp, leaseUntil: new Date(Date.parse(stamp) + 600_000).toISOString() });
  if (body.phase === "error") return replace(data, p, { ...s, status: "failed", updatedAt: stamp, error: typeof body.code === "string" && /^[a-z_]{1,100}$/.test(body.code) ? body.code : "setup_failed", leaseToken: undefined, leaseUntil: undefined });
  if (body.phase !== "result") throw new Error("invalid_setup_result");
  const result = parseSetupResult(body.result);
  const existing = data.services.find(v => v.space === space && v.projectId === p.id && repositoryFor(v));
  if (existing && repositoryFor(existing) !== result.repository) throw new Error("repository_changed");
  const service = existing ?? requestInspection({ id: `setup-${s.id}`, space, projectId: p.id, name: "GitHub", webUrl: `https://github.com/${result.repository}`, repositoryUrl: `https://github.com/${result.repository}`,
    connector: "shortcut", favorite: true, createdAt: stamp, lastSuccessAt: null, lastAttemptAt: null, connectionStatus: "shortcut", error: null, failures: 0, nextRetryAt: null }, stamp);
  let next = replace(data, p, { ...s, status: "ready", phase: "개발 환경 준비 완료", result, updatedAt: stamp, leaseOwner: undefined, leaseToken: undefined, leaseUntil: undefined });
  if (!existing) next = { ...next, services: [...next.services, service] };
  for (const r of s.requests) next = enqueueWork(next, space, p.id, service.id, r.request, r.mode, r.publish, r.createdAt, r.id, undefined, undefined, true);
  if (!s.requests.length) next = enqueueWork(next, space, p.id, service.id, "준비한 프로젝트의 화면을 열어주세요.", "preview", "pr", stamp);
  return next;
}
