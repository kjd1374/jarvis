import { readFile } from "./storage";
import { normalizeWorkspace } from "./validation";
import { type WorkspaceData } from "./types";
export type Backup = {
  format: "jarvis-backup";
  version: 1;
  exportedAt: string;
  data: WorkspaceData;
  files: { id: string; mime: string; base64: string }[];
  includesFiles: boolean;
};
function base64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let text = "";
  for (let i = 0; i < bytes.length; i += 8192)
    text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}
export async function createBackup(
  data: WorkspaceData,
  includesFiles = true,
  readOriginal = readFile,
): Promise<Backup> {
  const value = { ...normalizeWorkspace(data), providerConnections: undefined };
  const files: Backup["files"] = [];
  let size = 0;
  if (includesFiles)
    for (const record of value.documents) {
      if (record.sourceUrl) continue;
      const file = await readOriginal(record.id);
      size += file.size;
      if (size > 45 * 1024 * 1024)
        throw new Error(
          "전체 원본이 큽니다. 영역별로 내보내거나 원본 제외 백업을 선택해주세요.",
        );
      files.push({
        id: record.id,
        mime: record.mime,
        base64: base64(await file.arrayBuffer()),
      });
    }
  return {
    format: "jarvis-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    data: value,
    files,
    includesFiles,
  };
}
export function parseBackup(text: string): Backup {
  if (text.length > 64 * 1024 * 1024)
    throw new Error("백업은 64 MB 이내로 선택해주세요.");
  let value: Backup;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("백업 JSON을 읽을 수 없습니다.");
  }
  if (
    value?.format !== "jarvis-backup" ||
    value.version !== 1 ||
    !Array.isArray(value.files) ||
    typeof value.includesFiles !== "boolean"
  )
    throw new Error("Jarvis 백업 파일을 선택해주세요.");
  const data = normalizeWorkspace(value.data);
  const ids = new Set();
  for (const file of value.files) {
    const record = data.documents.find((d) => d.id === file.id && !d.sourceUrl);
    if (
      !record ||
      ids.has(file.id) ||
      typeof file.base64 !== "string" ||
      file.mime !== record.mime
    )
      throw new Error("파일 원본 연결이 올바르지 않습니다.");
    ids.add(file.id);
    let raw: string;
    try {
      raw = atob(file.base64);
    } catch {
      throw new Error("파일 원본을 해석하지 못했습니다.");
    }
    if (raw.length !== record.size || raw.length > 20 * 1024 * 1024)
      throw new Error("파일 크기가 백업 정보와 다릅니다.");
  }
  if (
    value.includesFiles &&
    data.documents.some((d) => !d.sourceUrl && !ids.has(d.id))
  )
    throw new Error(
      "원본 포함 백업에 빠진 파일이 있습니다. 원본 제외 백업 여부를 확인해주세요.",
    );
  data.providerConnections = undefined;
  data.projects = data.projects.map(p => p.release ? { ...p, release: { ...p.release, status: "interrupted", error: "imported_request_review", leaseToken: undefined, leaseUntil: undefined } } : p);
  data.projects = data.projects.map(p => p.planning ? { ...p, planning: { ...p.planning, runnerSeenAt: undefined, turns: p.planning.turns.map(t =>
    ["queued", "running"].includes(t.status) ? { ...t, status: "interrupted" as const, error: "imported_request_review", leaseOwner: undefined, leaseToken: undefined, leaseUntil: undefined } : t) } } : p);
  // Restoring a record is not permission to replay a previous external code change.
  data.projects = data.projects.map(p => p.automation ? { ...p, automation: { turns: p.automation.turns.map(t =>
    ["queued", "running"].includes(t.status) ? { ...t, status: "interrupted" as const, error: "imported_request_review", leaseOwner: undefined, leaseToken: undefined, leaseUntil: undefined } : t) } } : p);
  data.projects = data.projects.map(p => p.setup && ["queued", "running"].includes(p.setup.status) ? { ...p, setup: { ...p.setup, status: "interrupted", error: "imported_request_review", leaseOwner: undefined, leaseToken: undefined, leaseUntil: undefined } } : p);
  data.documents = data.documents.map(d => d.sheet ? { ...d, sheet: { ...d.sheet, runnerSeenAt: undefined, questions: d.sheet.questions.map(q =>
    ["queued", "running"].includes(q.status) ? { ...q, status: "interrupted" as const, error: "imported_request_review", leaseOwner: undefined, leaseToken: undefined, leaseUntil: undefined } : q) } } : d);
  return { ...value, data };
}
export async function backupFiles(backup: Backup) {
  const files: { id: string; blob: Blob; preventOverwrite: true }[] = [];
  for (const file of backup.files) {
    const incoming = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
    let existing: Blob | null = null;
    try {
      existing = await readFile(file.id);
    } catch {
      /* No local blob: add without overwriting. */
    }
    if (existing) {
      const bytes = new Uint8Array(await existing.arrayBuffer());
      if (
        bytes.length !== incoming.length ||
        bytes.some((b, i) => b !== incoming[i])
      )
        throw new Error(
          "같은 ID의 다른 파일 원본이 있습니다. 기존 기록을 덮어쓰지 않았습니다.",
        );
    } else
      files.push({
        id: file.id,
        blob: new Blob([incoming], { type: file.mime }),
        preventOverwrite: true,
      });
  }
  return files;
}
