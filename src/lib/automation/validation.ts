import { parseWebLinks } from "./web-links";
import type { Service, WorkspaceData } from "../workspace/types";
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max: number) => typeof v === "string" && v.length <= max;
const date = (v: unknown) => text(v, 50) && Number.isFinite(Date.parse(v as string));
const repository = (v: unknown) => typeof v === "string" && /^[a-z0-9_.-]{1,100}\/[a-z0-9_.-]{1,100}$/.test(v);
const sha = (v: unknown) => typeof v === "string" && /^[a-f0-9]{40,64}$/.test(v);
const strings = (v: unknown, count: number, length: number): v is string[] => Array.isArray(v) && v.length <= count && v.every(s => text(s, length));
function invalid(): never { throw new Error("GitHub 점검·분석 기록의 형식과 범위를 확인해주세요."); }
export function validateMonitoring(service: Service, data: WorkspaceData) {
  const m: unknown = service.monitoring;
  if (m === undefined) return;
  if (!object(m) || ![m.lastSuccessAt, m.lastAttemptAt, m.nextRetryAt].every(v => v === null || date(v)) || !(m.error === null || text(m.error, 300)) || !repository(m.repository) || typeof m.enabled !== "boolean" || typeof m.automatic !== "boolean" ||
      !Number.isInteger(m.intervalMinutes) || (m.intervalMinutes as number) < 15 || (m.intervalMinutes as number) > 1440 || !Array.isArray(m.previousAnalyses) || m.previousAnalyses.length > 5) invalid();
  if (m.webLinks !== undefined) parseWebLinks(m.webLinks, m.repository as string, new Date().toISOString());
  if (m.runnerSeenAt !== undefined && !date(m.runnerSeenAt) || m.runnerVersion !== undefined && !text(m.runnerVersion, 50)) invalid();
  if (m.runnerConnection !== undefined) {
    const c = m.runnerConnection;
    if (object(c) && c.projectScope !== undefined && c.projectScope !== "space" && c.projectScope !== "selected") invalid();
    if (!object(c) || !date(c.seenAt) || typeof c.remoteWork !== "boolean" || typeof c.previews !== "boolean" ||
      c.previewLocal !== undefined && typeof c.previewLocal !== "boolean" ||
      c.previewCli !== undefined && typeof c.previewCli !== "boolean" ||
      c.version !== undefined && (typeof c.version !== "string" || !/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(c.version))) invalid();
  }
  if (m.job !== null) {
    const job = m.job;
    if (!object(job) || !text(job.id, 200) || !repository(job.repository) || !date(job.requestedAt) ||
        !["queued", "running", "completed", "failed"].includes(String(job.status)) || !["collect", "analyze"].includes(String(job.phase)) ||
        !Number.isInteger(job.attempt) || (job.attempt as number) < 0 || (job.attempt as number) > 100 ||
        job.leaseOwner !== undefined && !text(job.leaseOwner, 200) || job.leaseUntil !== undefined && !date(job.leaseUntil) ||
        job.provider !== undefined && !["codex", "claude"].includes(String(job.provider)) || job.error !== undefined && !text(job.error, 300)) invalid();
  }
  if (m.inspection !== null) {
    const inspection = m.inspection;
    if (!object(inspection) || !repository(inspection.repository) || !sha(inspection.headSha) || !text(inspection.branch, 250) || !date(inspection.inspectedAt) ||
        typeof inspection.treeComplete !== "boolean" || !Number.isSafeInteger(inspection.filesTotal) || (inspection.filesTotal as number) < 0 ||
        !Number.isSafeInteger(inspection.excludedFiles) || (inspection.excludedFiles as number) < 0 ||
        !strings(inspection.reviewedPaths, 100, 500) || !strings(inspection.limitations, 30, 500) || !object(inspection.fileShas) ||
        Object.keys(inspection.fileShas).length > 5000 || Object.entries(inspection.fileShas).some(([path, hash]) => !text(path, 500) || !sha(hash)) || !sha(inspection.fingerprint)) invalid();
  }
  for (const analysis of [m.analysis, ...m.previousAnalyses]) {
    if (analysis === null) continue;
    if (!object(analysis) || analysis.kind !== "ai" || !["codex", "claude"].includes(String(analysis.provider)) ||
        !text(analysis.summary, 6000) || !text(analysis.currentStatus, 2000) || !text(analysis.nextAction, 2000) ||
        !date(analysis.generatedAt) || !sha(analysis.basis) || !sha(analysis.headSha) || !strings(analysis.sourceIds, 50, 2048) ||
        !Array.isArray(analysis.suggestions) || analysis.suggestions.length > 12) invalid();
    const analysisSourceIds = analysis.sourceIds;
    if (!Array.isArray(analysis.citations) || analysis.citations.length !== analysisSourceIds.length || analysis.citations.some(c => !object(c) ||
        !analysisSourceIds.includes(c.id as string) || !text(c.title, 500) || !text(c.sourceUrl, 2048) || !date(c.sourceUpdatedAt) || !date(c.collectedAt))) invalid();
    for (const sourceId of analysis.sourceIds) {
      if (!data.sourceRecords.some(s => s.id === sourceId && s.space === service.space && s.projectId === service.projectId && s.serviceId === service.id)) invalid();
    }
    const ids = new Set<string>();
    for (const suggestion of analysis.suggestions) {
      if (!object(suggestion) || !text(suggestion.id, 200) || ids.has(suggestion.id as string) ||
          !["task", "completion", "defer", "review"].includes(String(suggestion.kind)) || !text(suggestion.title, 160) || !text(suggestion.reason, 2000) ||
          !strings(suggestion.sourceIds, 20, 2048) || suggestion.sourceIds.length === 0 || !date(suggestion.createdAt) ||
          !["proposed", "adopted", "dismissed"].includes(String(suggestion.state)) || suggestion.taskId !== null && !text(suggestion.taskId, 2048)) invalid();
      if (suggestion.sourceIds.some(sourceId => !analysisSourceIds.includes(sourceId))) invalid();
      if (suggestion.taskId !== null && data.tasks.some(t => t.id === suggestion.taskId && (t.space !== service.space || t.projectId !== service.projectId))) invalid();
      ids.add(suggestion.id as string);
    }
  }
}
