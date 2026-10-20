import { type Project, type Space, type WorkspaceData } from "../workspace/types";

export type ReleasePlan = {
  repository: string; repoId: number; branch: string; sha: string;
  framework: "nextjs" | "vite" | "static" | "express";
  database: "none" | "new" | "existing"; databaseId?: string;
  vercelId?: string; vercelAccount: string; outputDirectory?: "public"; name: string; team?: string; organization?: string;
  migrations: { path: string; sha: string }[];
  localData: boolean; notes: string[];
};
export type ProjectRelease = {
  id: string; status: "planned" | "queued" | "running" | "deployed" | "failed" | "cancelled" | "interrupted";
  phase: "database" | "database_wait" | "environment" | "deployment" | "deployment_wait" | "health" | "done";
  createdAt: string; updatedAt: string; ownerDevice: string; plan: ReleasePlan;
  error?: string; executionId?: string; runUntil?: string; leaseToken?: string; leaseUntil?: string;
  databaseId?: string; vercelId?: string; deploymentId?: string; url?: string;
  databaseIntent?: boolean; vercelIntent?: boolean; deploymentIntent?: boolean;
  databaseStatus?: string; deploymentStatus?: string; healthStatus?: number;
  migrationsApplied?: string[]; environmentKeys?: string[];
  confirmedAt?: string; workflowUrl?: string;
  history: { id: string; sha: string; status: string; at: string; url?: string }[];
};
export const releaseBusy = (r?: ProjectRelease) => !!r && ["queued", "running"].includes(r.status);
const short = (v: unknown, max = 200) => typeof v === "string" && v.length <= max;
export function validateRelease(project: Project) {
  const r = project.release;
  if (!r) return;
  const p = r.plan;
  if (!/^[a-f0-9-]{36}$/.test(r.id) || !["planned", "queued", "running", "deployed", "failed", "cancelled", "interrupted"].includes(r.status) ||
    !["database", "database_wait", "environment", "deployment", "deployment_wait", "health", "done"].includes(r.phase) ||
    ![r.createdAt, r.updatedAt].every(v => short(v) && Number.isFinite(Date.parse(v))) || !short(r.ownerDevice) || !p ||
    !/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(p.repository) || p.repository.includes("..") || !Number.isSafeInteger(p.repoId) || p.repoId <= 0 ||
    !/^[a-f0-9]{40}$/.test(p.sha) || !short(p.branch) || !short(p.vercelAccount) || p.outputDirectory !== undefined && p.outputDirectory !== "public" || !["nextjs", "vite", "static", "express"].includes(p.framework) ||
    !["none", "new", "existing"].includes(p.database) || !/^jarvis-live-[a-f0-9]{20}$/.test(p.name) ||
    typeof p.localData !== "boolean" || !Array.isArray(p.notes) || p.notes.length > 20 || p.notes.some(v => !short(v, 2000)) ||
    !Array.isArray(p.migrations) || p.migrations.length > 30 || p.migrations.some(m => !/^supabase\/migrations\/[a-zA-Z0-9_-]+\.sql$/.test(m.path) || !/^[a-f0-9]{40}$/.test(m.sha)) ||
    !Array.isArray(r.history) || r.history.length > 20 || r.history.some(h => !short(h.id) || !short(h.sha) || !short(h.status) || !short(h.at))) throw new Error("운영 배포 기록을 확인해주세요.");
  for (const value of [p.databaseId, r.databaseId]) if (value !== undefined && !/^[a-z]{20}$/.test(value)) throw new Error("운영 DB 식별자를 확인해주세요.");
  for (const value of [p.vercelId, r.vercelId]) if (value !== undefined && !/^prj_[a-zA-Z0-9]+$/.test(value)) throw new Error("운영 배포 식별자를 확인해주세요.");
  for (const value of [r.url, ...r.history.map(h => h.url)].filter(v => v !== undefined)) if (!releaseUrl(value)) throw new Error("운영 주소를 확인해주세요.");
  if (r.executionId !== undefined && !/^[a-f0-9-]{36}$/.test(r.executionId) || r.runUntil !== undefined && !Number.isFinite(Date.parse(r.runUntil))) throw new Error("운영 실행 임대를 확인해주세요.");
  if (r.deploymentId !== undefined && !/^dpl_[a-zA-Z0-9]+$/.test(r.deploymentId) || r.error !== undefined && !/^[a-z_]{1,100}$/.test(r.error) ||
    r.leaseToken !== undefined && !/^[a-f0-9-]{36}$/.test(r.leaseToken) || r.leaseUntil !== undefined && !Number.isFinite(Date.parse(r.leaseUntil)) ||
    r.workflowUrl !== undefined && !/^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/actions(?:\/runs\/\d+)?$/.test(r.workflowUrl) ||
    r.environmentKeys?.some(k => !/^[A-Z_][A-Z0-9_]{0,100}$/.test(k)) || r.migrationsApplied?.some(v => !p.migrations.some(m => m.path === v))) throw new Error("운영 배포 상태를 확인해주세요.");
}
export function releaseUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  try { const u = new URL(value); if (u.protocol === "https:" && /^[a-z0-9-]+\.vercel\.app$/.test(u.hostname) && !u.port && !u.username && !u.password && u.pathname === "/" && !u.search && !u.hash) return u.origin; } catch {}
}
export function projectForRelease(data: WorkspaceData, space: Space, projectId: unknown) {
  const project = data.projects.find(p => p.space === space && p.id === projectId);
  if (!project) throw new Error("project_missing");
  return project;
}
export function releasePatch(data: WorkspaceData, project: Project, release: ProjectRelease) {
  validateRelease({ ...project, release });
  return { ...data, projects: data.projects.map(p => p.id === project.id && p.space === project.space ? { ...p, release } : p) };
}
export function finishRelease(data: WorkspaceData, space: Space, projectId: string, jobId: unknown, stamp: string) {
  const project = projectForRelease(data, space, projectId), r = project.release;
  if (!r || r.id !== jobId || r.status !== "deployed" || r.phase !== "done" || r.healthStatus !== 200 || !releaseUrl(r.url)) throw new Error("release_not_verified");
  if (project.automation?.turns.some(t => ["queued", "running"].includes(t.status)) || releaseBusy(project.release)) throw new Error("development_busy");
  return { ...data, projects: data.projects.map(p => p.id === project.id ? { ...p, stage: "live" as const, launchUrl: r.url, release: { ...r, confirmedAt: stamp, updatedAt: stamp } } : p) };
}
