import { id, assertLinks, type Document, type Space, type WorkspaceData } from "../workspace/types";
import type { DocumentAnswer, SheetDocument, SheetSnapshot, SheetTab } from "./types";

export const SHEET_MIME = "application/vnd.google-apps.spreadsheet";
export const DEFAULT_RANGE = "A1:T200";
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
const date = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9-]{36}$/.test(v);
export const validSpreadsheetId = (v: unknown): v is string => typeof v === "string" && /^[a-zA-Z0-9_-]{10,180}$/.test(v);
export function sheetUrl(spreadsheetId: string, tabId?: number, range?: string) {
  if (!validSpreadsheetId(spreadsheetId)) throw new Error("시트 주소를 확인해주세요.");
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit${tabId === undefined ? "" : `#gid=${tabId}${range ? `&range=${encodeURIComponent(range)}` : ""}`}`;
}
function columnNumber(value: string) { return [...value].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0); }
export function columnName(value: number): string {
  let result = "";
  for (let n = value; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result;
  return result;
}
export function parseSheetRange(raw: string) {
  const range = raw.trim().toUpperCase(), match = /^([A-Z]{1,3})([1-9][0-9]{0,6}):([A-Z]{1,3})([1-9][0-9]{0,6})$/.exec(range);
  if (!match) throw new Error("불러올 범위를 A1:T200처럼 입력해주세요.");
  const startColumn = columnNumber(match[1]), endColumn = columnNumber(match[3]);
  const startRow = Number(match[2]), endRow = Number(match[4]);
  if (endColumn < startColumn || endRow < startRow || endColumn - startColumn >= 50 || endRow - startRow >= 500 || (endColumn - startColumn + 1) * (endRow - startRow + 1) > 10_000)
    throw new Error("한 번에 최대 500행·50열, 총 10,000셀까지 불러올 수 있습니다. 범위를 나눠주세요.");
  return { range, startColumn, endColumn, startRow, endRow };
}
export function validateSnapshot(raw: unknown): asserts raw is SheetSnapshot {
  if (!object(raw) || !uuid(raw.id) || !Number.isSafeInteger(raw.tabId) || Number(raw.tabId) < 0 || !text(raw.tabTitle, 200) || !raw.tabTitle || !text(raw.range, 40) || !date(raw.capturedAt) || !Array.isArray(raw.values)) throw new Error("시트 보관 내용을 확인해주세요.");
  const r = parseSheetRange(raw.range);
  if (raw.values.length > r.endRow - r.startRow + 1 || raw.values.some(row => !Array.isArray(row) || row.length > r.endColumn - r.startColumn + 1 || row.some(cell => !text(cell, 10_000))) || JSON.stringify(raw.values).length > 40_000)
    throw new Error("선택한 범위의 내용이 너무 큽니다. 더 작은 범위를 불러와주세요.");
}
export function parseDocumentAnswer(raw: unknown, snapshot: SheetSnapshot): DocumentAnswer {
  const { startRow } = parseSheetRange(snapshot.range);
  if (!object(raw) || !text(raw.reply, 6000) || !raw.reply.trim() || !text(raw.limitation, 1000) || !Array.isArray(raw.rows) || raw.rows.length > 30 ||
    raw.rows.some(row => !Number.isInteger(row) || row < startRow || row >= startRow + snapshot.values.length)) throw new Error("문답의 답변·근거 행을 확인하지 못했습니다.");
  return { reply: raw.reply, rows: [...new Set(raw.rows)] as number[], limitation: raw.limitation };
}
export function validateSheetDocument(document: Document) {
  const sheet = document.sheet;
  if (sheet === undefined) return;
  if (!object(sheet) || sheet.version !== 1 || !validSpreadsheetId(sheet.spreadsheetId) || document.mime !== SHEET_MIME || document.sourceUrl !== sheetUrl(sheet.spreadsheetId) ||
    !text(sheet.folder, 100) || typeof sheet.pinned !== "boolean" || !(sheet.archivedAt === null || date(sheet.archivedAt)) || !Array.isArray(sheet.tabs) || sheet.tabs.length > 100 ||
    !Array.isArray(sheet.snapshots) || sheet.snapshots.length > 200 || !Array.isArray(sheet.questions) || sheet.questions.length > 500 || sheet.runnerSeenAt !== undefined && !date(sheet.runnerSeenAt)) throw new Error("시트 연결 정보를 확인해주세요.");
  const snapshotIds = new Set<string>(), tabIds = new Set<number>(), questionIds = new Set<string>();
  for (const snapshot of sheet.snapshots) { validateSnapshot(snapshot); if (snapshotIds.has(snapshot.id)) throw new Error("시트 보관 ID가 중복되었습니다."); snapshotIds.add(snapshot.id); }
  for (const tab of sheet.tabs) {
    if (!object(tab) || !Number.isSafeInteger(tab.id) || tab.id < 0 || tabIds.has(tab.id) || !text(tab.title, 200) || !tab.title ||
      tab.snapshotId !== undefined && (!sheet.snapshots.some(s => s.id === tab.snapshotId && s.tabId === tab.id) || !date(tab.checkedAt))) throw new Error("시트 탭 연결을 확인해주세요.");
    tabIds.add(tab.id);
  }
  for (const q of sheet.questions) {
    const snapshot = sheet.snapshots.find(s => s.id === q.snapshotId);
    if (!object(q) || !uuid(q.id) || questionIds.has(q.id) || !snapshot || !text(q.question, 2000) || !q.question.trim() || !text(q.documentName, 500) ||
      !date(q.readAt) || !date(q.createdAt) || !date(q.updatedAt) || !["queued", "running", "completed", "failed", "interrupted", "cancelled"].includes(q.status) ||
      !Number.isInteger(q.attempt) || q.attempt < 0 || q.attempt > 100 || q.leaseOwner !== undefined && !text(q.leaseOwner, 200) || q.leaseToken !== undefined && !uuid(q.leaseToken) ||
      q.leaseUntil !== undefined && !date(q.leaseUntil) || q.error !== undefined && !text(q.error, 100)) throw new Error("문서 문답 기록을 확인해주세요.");
    if (q.answer) parseDocumentAnswer(q.answer, snapshot);
    if (q.status === "completed" && !q.answer) throw new Error("완료한 문답의 답변이 없습니다.");
    if (q.status === "running" && (!q.leaseOwner || !q.leaseToken || !q.leaseUntil)) throw new Error("문답 실행 등록을 확인해주세요.");
    questionIds.add(q.id);
  }
  const forbidden = /^(access_?token|refresh_?token|client_?secret|token|password|secret|api_?key)$/i;
  const walk = (value: unknown) => { if (object(value)) for (const [key, child] of Object.entries(value)) { if (forbidden.test(key)) throw new Error("Google 인증값을 자료에 보관할 수 없습니다."); walk(child); } else if (Array.isArray(value)) value.forEach(walk); };
  walk(sheet);
}
export function replaceSheet(data: WorkspaceData, document: Document, sheet: SheetDocument) {
  const next = { ...data, documents: data.documents.map(d => d.id === document.id && d.space === document.space ? { ...d, sheet } : d) };
  if (JSON.stringify(next.documents.filter(d => d.sheet)).length > 2_000_000) throw new Error("시트 보관 용량에 도달했습니다. 기존 내용은 유지됩니다. 불러올 범위를 줄여주세요.");
  return next;
}
export function addSheet(data: WorkspaceData, space: Space, projectId: string | null, spreadsheetId: string, name: string, tabs: SheetTab[], stamp: string) {
  assertLinks(data, space, projectId);
  const existing = data.documents.find(d => d.space === space && d.projectId === projectId && d.sheet?.spreadsheetId === spreadsheetId);
  if (existing) {
    if (existing.sheet!.archivedAt) return { data, documentId: existing.id };
    const document = { ...existing, name, sheet: { ...existing.sheet!, tabs: tabs.map(tab => ({ ...existing.sheet!.tabs.find(old => old.id === tab.id), ...tab })) } };
    validateSheetDocument(document);
    return { data: { ...data, documents: data.documents.map(row => row.id === document.id ? document : row) }, documentId: document.id };
  }
  const document: Document = { id: id(), space, projectId, taskId: null, name, mime: SHEET_MIME, size: 0, createdAt: stamp, sourceUrl: sheetUrl(spreadsheetId),
    sheet: { version: 1, spreadsheetId, folder: "", pinned: false, archivedAt: null, tabs, snapshots: [], questions: [] } };
  validateSheetDocument(document);
  return { data: { ...data, documents: [...data.documents, document] }, documentId: document.id };
}
export function saveSheetSnapshot(data: WorkspaceData, space: Space, documentId: string, snapshot: SheetSnapshot) {
  validateSnapshot(snapshot);
  const document = data.documents.find(d => d.id === documentId && d.space === space), sheet = document?.sheet;
  if (!document || !sheet || sheet.archivedAt || !sheet.tabs.some(t => t.id === snapshot.tabId)) throw new Error("현재 작업 중인 시트와 탭을 확인해주세요.");
  const duplicate = sheet.snapshots.find(s => s.tabId === snapshot.tabId && s.tabTitle === snapshot.tabTitle && s.range === snapshot.range && JSON.stringify(s.values) === JSON.stringify(snapshot.values));
  const selected = duplicate ?? snapshot;
  const tabs = sheet.tabs.map(t => t.id === snapshot.tabId ? { ...t, title: snapshot.tabTitle, snapshotId: selected.id, checkedAt: snapshot.capturedAt } : t);
  // Immutable snapshots also protect questions queued concurrently on another device.
  if (!duplicate && sheet.snapshots.length >= 200) throw new Error("이 문서의 보관 범위 한도에 도달했습니다. 기존 내용은 유지됩니다.");
  return replaceSheet(data, document, { ...sheet, tabs, snapshots: [...sheet.snapshots, ...(duplicate ? [] : [snapshot])] });
}
export function archiveSheet(data: WorkspaceData, space: Space, documentId: string, archived: boolean, stamp: string) {
  const document = data.documents.find(d => d.id === documentId && d.space === space), sheet = document?.sheet;
  if (!document || !sheet || archived && !sheet.tabs.some(t => t.snapshotId)) throw new Error("내용을 먼저 불러온 뒤 자료실로 보내주세요.");
  return replaceSheet(data, document, { ...sheet, archivedAt: archived ? stamp : null });
}
