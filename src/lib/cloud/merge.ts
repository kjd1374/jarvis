import { type WorkspaceData } from "../workspace/types";
import { collections, normalizeWorkspace } from "../workspace/validation";
import { canonical } from "./records";

type Preference = "local" | "remote";
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const same = (a: unknown, b: unknown) =>
  a === undefined || b === undefined ? a === b : canonical(a) === canonical(b);

// A lost HTTP acknowledgement can leave the exact initial request locally while
// the server has already claimed it. Adopt the complete server record, never
// reconstruct a lease or reinterpret a cancellation/retry as an initial send.
function acknowledgedWork(local: unknown, remote: unknown) {
  if (!object(local) || !object(remote) || local.status !== "queued" || local.phase !== "queued" ||
    local.attempt !== 0 || local.updatedAt !== local.createdAt ||
    ["executionDevice", "leaseOwner", "leaseToken", "leaseUntil", "error", "result"].some(key => local[key] !== undefined)) return false;
  const identity = ["id", "serviceId", "repository", "request", "mode", "publish", "sourceTurnId", "followLatest", "previewAI", "createdAt"];
  return identity.every(key => same(local[key], remote[key])) &&
    Number.isInteger(remote.attempt) && (remote.attempt as number) >= 0;
}

// Baseline is the last acknowledged server snapshot, never a guessed timestamp.
// Without one (old caches), preserve additions and require review of differences.
export function mergeCloudWorkspace(
  base: WorkspaceData | undefined,
  local: WorkspaceData,
  remote: WorkspaceData,
  preference?: Preference,
) {
  for (const key of collections) {
    const remoteRows = new Map((remote[key] as { id: string; space?: string }[]).map(row => [row.id, row]));
    for (const row of local[key] as { id: string; space?: string }[]) {
      const other = remoteRows.get(row.id);
      if (other && row.space !== other.space) throw new Error("영역이 다른 같은 ID가 있습니다. 기존 기록은 유지됩니다.");
    }
  }
  const conflicts: string[] = [];
  function merge(b: unknown, l: unknown, r: unknown, path: string[]): unknown {
    const optionalText = path.length === 3 && path[0] === "projects" && ["currentStatus", "nextAction"].includes(path[2]);
    const equal = (a: unknown, b: unknown) => same(a, b) || optionalText && (a ?? "") === (b ?? "");
    if (equal(l, r)) return l;
    if (base) {
      if (equal(l, b)) return r;
      if (equal(r, b)) return l;
    } else {
      if (l === undefined) return r;
      if (r === undefined) return l;
    }
    // The selected view is a device preference, not conflicting user content.
    if (path.length === 2 && ["activeProjects", "activeConversations"].includes(path[0])) return l;
    // Removing a connected sheet also removes its in-flight work; a late runner
    // heartbeat or another browser's save must not resurrect that connection.
    if (base && path.length === 2 && path[0] === "documents" && object(b) && object(b.sheet) && (l === undefined || r === undefined)) return undefined;
    if (path.length === 6 && path[0] === "documents" && path[2] === "sheet" && path[3] === "tabs" && path[5] === "wholeRead") {
      conflicts.push(path.join("."));
      return preference === "remote" ? r : l;
    }
    const turn = path.length === 5 && path[0] === "projects" && path[2] === "automation" && path[3] === "turns";
    const planningTurn = path.length === 5 && path[0] === "projects" && path[2] === "planning" && path[3] === "turns";
    const question = path.length === 5 && path[0] === "documents" && path[2] === "sheet" && path[3] === "questions";
    const job = path.length === 4 && path[0] === "services" && path[2] === "monitoring" && path[3] === "job";
    const observation = path.length === 4 && path[0] === "services" && path[2] === "monitoring" &&
      ["runnerSeenAt", "runnerVersion", "runnerConnection", "lastSuccessAt", "lastAttemptAt", "error", "nextRetryAt", "inspection", "analysis", "previousAnalyses", "webLinks"].includes(path[3]) ||
      path.length === 3 && path[0] === "sourceRecords" && path[2] !== "taskId";
    if (path[0] === "providerConnections" || path.length === 3 && path[0] === "projects" && path[2] === "release") return r;
    if (path.length === 4 && path[0] === "projects" && path[2] === "planning" && ["runnerSeenAt", "runnerVersion"].includes(path[3])) return r;
    if (base && b === undefined && planningTurn && object(l) && object(r) && l.status === "queued" && l.attempt === 0 &&
      l.updatedAt === l.createdAt && ["leaseOwner", "leaseToken", "leaseUntil", "baseRevision", "baseVersionId", "result", "error", "appliedRevision"].every(k => l[k] === undefined) &&
      ["id", "request", "createdAt"].every(k => same(l[k], r[k]))) return r;
    if (observation || path.length === 4 && path[0] === "documents" && path[2] === "sheet" && path[3] === "runnerSeenAt") return r;
    if (base && b === undefined && turn && acknowledgedWork(l, r)) return r;
    // The task created by that same initial send may already be in progress.
    if (base && b === undefined && path.length === 2 && path[0] === "tasks" && object(l) && object(r) &&
      l.status === "todo" && ["in_progress", "done", "decision"].includes(String(r.status)) &&
      same({ ...l, status: r.status }, r)) {
      const left = local.projects.find(p => p.id === l.projectId)?.automation?.turns.find(t => t.id === l.sourceMessageId);
      const right = remote.projects.find(p => p.id === r.projectId)?.automation?.turns.find(t => t.id === r.sourceMessageId);
      if (l.id === `work-${left?.id}` && acknowledgedWork(left, right)) return r;
    }
    // Never splice lease/result fields or roll back a progressing execution during review.
    if (path.length === 4 && path[0] === "projects" && path[2] === "planning" && path[3] === "document") {
      conflicts.push(path.join("."));
      return preference === "remote" ? r : l;
    }
    if (turn || planningTurn || job || question || path.length === 3 && path[0] === "projects" && path[2] === "setup") {
      conflicts.push(path.join("."));
      return r;
    }
    const keyed = path.length === 1 && collections.includes(path[0] as typeof collections[number]) ||
      path.length === 4 && path[0] === "projects" && path[2] === "automation" && path[3] === "turns" ||
      path.length === 4 && path[0] === "projects" && path[2] === "planning" && ["turns", "history"].includes(path[3]) ||
      path.length === 4 && path[0] === "documents" && path[2] === "sheet" && ["questions", "snapshots", "tabs"].includes(path[3]);
    if (keyed && Array.isArray(l) && Array.isArray(r) && (b === undefined || Array.isArray(b))) {
      const indexed = (rows: unknown[]) => new Map(rows.map(row => {
        if (!object(row) || !(typeof row.id === "string" || path[3] === "tabs" && Number.isSafeInteger(row.id))) throw new Error("항목 ID를 확인해주세요. 기존 기록은 유지됩니다.");
        return [String(row.id), row] as const;
      }));
      const bm = indexed(Array.isArray(b) ? b : []), lm = indexed(l), rm = indexed(r);
      const ids = new Set([...rm.keys(), ...lm.keys(), ...bm.keys()]);
      return [...ids].flatMap(id => {
        const left = lm.get(id), right = rm.get(id);
        if (left && right && left.space !== right.space) throw new Error("영역이 다른 같은 ID가 있습니다. 기존 기록은 유지됩니다.");
        const row = merge(bm.get(id), left, right, [...path, id]);
        return row === undefined ? [] : [row];
      });
    }
    if (object(l) && object(r) && (b === undefined || object(b))) {
      return Object.fromEntries([...new Set([...Object.keys(l), ...Object.keys(r), ...Object.keys(object(b) ? b : {})])].flatMap(key => {
        const value = merge(object(b) ? b[key] : undefined, l[key], r[key], [...path, key]);
        return value === undefined ? [] : [[key, value]];
      }));
    }
    conflicts.push(path.join("."));
    return preference === "remote" ? r : l;
  }
  const merged = merge(base, local, remote, []) as WorkspaceData;
  const removedSheets = new Set(base?.documents.filter(d => d.sheet && !merged.documents.some(row => row.id === d.id)).map(d => d.id));
  const cleaned = removedSheets.size ? { ...merged, messages: merged.messages.map(m => ({ ...m, fileIds: m.fileIds.filter(id => !removedSheets.has(id)) })) } : merged;
  return { data: normalizeWorkspace(cleaned), conflicts };
}
