import { type WorkspaceData } from "../workspace/types";
import { collections, normalizeWorkspace } from "../workspace/validation";
import { canonical } from "./records";

type Preference = "local" | "remote";
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const same = (a: unknown, b: unknown) =>
  a === undefined || b === undefined ? a === b : canonical(a) === canonical(b);

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
    const turn = path.length === 5 && path[0] === "projects" && path[2] === "automation" && path[3] === "turns";
    const question = path.length === 5 && path[0] === "documents" && path[2] === "sheet" && path[3] === "questions";
    const job = path.length === 4 && path[0] === "services" && path[2] === "monitoring" && path[3] === "job";
    const observation = path.length === 4 && path[0] === "services" && path[2] === "monitoring" &&
      ["runnerSeenAt", "runnerVersion", "lastSuccessAt", "lastAttemptAt", "error", "nextRetryAt", "inspection", "analysis", "previousAnalyses", "webLinks"].includes(path[3]) ||
      path.length === 3 && path[0] === "sourceRecords" && path[2] !== "taskId";
    if (observation || path.length === 4 && path[0] === "documents" && path[2] === "sheet" && path[3] === "runnerSeenAt") return r;
    // Never splice lease/result fields or roll back a progressing execution during review.
    if (turn || job || question) {
      conflicts.push(path.join("."));
      return r;
    }
    const keyed = path.length === 1 && collections.includes(path[0] as typeof collections[number]) ||
      path.length === 4 && path[0] === "projects" && path[2] === "automation" && path[3] === "turns" ||
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
  return { data: normalizeWorkspace(merge(base, local, remote, [])), conflicts };
}
