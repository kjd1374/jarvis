import { test, expect } from "@playwright/test";
import { id } from "../../src/lib/workspace/types";
import { addSheet, archiveSheet, parseDocumentAnswer, parseSheetRange, saveSheetSnapshot } from "../../src/lib/sheets/documents";
import { claimDocumentQuestion, enqueueDocumentQuestion, changeDocumentQuestion, reportDocumentQuestion } from "../../src/lib/sheets/questions";
import { normalizeWorkspace } from "../../src/lib/workspace/validation";
import { mergeCloudWorkspace } from "../../src/lib/cloud/merge";
import { searchWorkspace } from "../../src/lib/workspace/search";
import { sheetWorkspace, stamp, snapshotId, questionId } from "../support/sheets";
const scope = { space: "company" as const, projectIds: ["sheet-project"], deviceId: "device-a" };
function queued() { const data = sheetWorkspace(); return enqueueDocumentQuestion(data, "company", data.documents[0].id, snapshotId, "가장 빠른 일정은?", stamp, questionId); }
const answer = { reply: "합성 일정은 10월 20일입니다.", rows: [11], limitation: "불러온 범위만 확인했습니다." };
function claimed() {
  const claim = claimDocumentQuestion(queued(), scope, stamp), job = claim.job!;
  return { ...claim, body: { projectId: job.projectId, documentId: job.documentId, snapshotId: job.snapshot.id, jobId: job.id, leaseToken: job.leaseToken, phase: "result", answer } };
}
test("ranges are bounded and snapshots preserve immutable question evidence", () => {
  expect(parseSheetRange(" b10:d20 ")).toMatchObject({ startRow: 10, startColumn: 2, endColumn: 4 });
  for (const range of ["A:A", "A0:A20", "A1:ZZ500", "A1:T501", "B3:A2", "tab!A1:B2"]) expect(() => parseSheetRange(range)).toThrow();
  let data = queued(); const document = data.documents[0], saved = document.sheet!.snapshots[0];
  data = saveSheetSnapshot(data, "company", document.id, { ...saved, id: id(), values: [["변경한 값"]], capturedAt: "2026-10-17T00:01:00Z" });
  expect(data.documents[0].sheet!.snapshots.find(s => s.id === snapshotId)?.values[1][0]).toBe("합성 일정");
  expect(claimDocumentQuestion(data, scope, stamp).job!.snapshot).toEqual(saved);
  expect(() => saveSheetSnapshot(data, "company", document.id, { ...saved, values: [["a".repeat(40_001)]] })).toThrow();
  expect(() => parseDocumentAnswer({ ...answer, rows: [1] }, saved)).toThrow();
  expect(() => parseDocumentAnswer({ ...answer, rows: [20] }, saved)).toThrow();
  expect(normalizeWorkspace(data).documents[0].sheet!.snapshots).toHaveLength(2);
});
test("scope, deduplication, archive and saved-sheet retrieval survive disconnection", () => {
  const data = sheetWorkspace(), document = data.documents[0];
  const reselected = addSheet(data, "company", "sheet-project", document.sheet!.spreadsheetId, "이름 갱신", [{ id: 9, title: "원본에서 교체한 탭" }], stamp);
  expect(reselected.documentId).toBe(document.id);
  expect(reselected.data.documents[0].sheet!.tabs[0].id).toBe(9);
  expect(reselected.data.documents[0].sheet!.snapshots).toEqual(document.sheet!.snapshots);
  expect(() => enqueueDocumentQuestion(data, "personal", document.id, snapshotId, "질문", stamp)).toThrow();
  expect(() => addSheet(data, "personal", "sheet-project", "synthetic_sheet_123", "영역 오류", [], stamp)).toThrow();
  const archived = archiveSheet(data, "company", document.id, true, stamp);
  const question = enqueueDocumentQuestion(archived, "company", document.id, snapshotId, "보관한 시트 질문", stamp, questionId);
  expect(enqueueDocumentQuestion(question, "company", document.id, snapshotId, "보관한 시트 질문", stamp, questionId)).toBe(question);
  expect(claimDocumentQuestion(question, { ...scope, projectIds: [null] }, stamp).job).toBeNull();
  expect(claimDocumentQuestion(question, { ...scope, space: "personal" }, stamp).job).toBeNull();
  expect(claimDocumentQuestion(question, scope, stamp).job!.kind).toBe("document");
  expect(searchWorkspace(archived, { space: "company", query: "합성 일정", projectId: "sheet-project" }, stamp)).toHaveLength(1);
  expect(searchWorkspace(archived, { space: "personal", query: "합성" }, stamp)).toHaveLength(0);
  expect(archiveSheet(archived, "company", document.id, false, stamp).documents[0].sheet!.snapshots).toEqual(document.sheet!.snapshots);
  const bad = structuredClone(data); Object.assign(bad.documents[0].sheet!, { accessToken: "synthetic-forbidden" });
  expect(() => normalizeWorkspace(bad)).toThrow(/인증값/);
});
test("document leases fence other devices, projects, snapshots, cancellation and expired attempts", () => {
  const { data, body } = claimed();
  expect(() => reportDocumentQuestion(data, "company", body, "device-b", stamp)).toThrow("stale_job");
  expect(() => reportDocumentQuestion(data, "personal", body, scope.deviceId, stamp)).toThrow("stale_job");
  for (const changed of [{ projectId: null }, { snapshotId: "wrong" }, { leaseToken: id() }]) expect(() => reportDocumentQuestion(data, "company", { ...body, ...changed }, scope.deviceId, stamp)).toThrow("stale_job");
  const cancelled = changeDocumentQuestion(data, "company", body.documentId, questionId, "cancel", stamp);
  expect(() => reportDocumentQuestion(cancelled, "company", body, scope.deviceId, stamp)).toThrow("stale_job");
  const later = "2026-10-17T00:06:00Z", expired = claimDocumentQuestion(data, scope, later);
  expect(expired.job).toBeNull(); expect(expired.data.documents[0].sheet!.questions[0].status).toBe("interrupted");
  expect(() => reportDocumentQuestion(data, "company", body, scope.deviceId, later)).toThrow("stale_job");
  const retry = claimDocumentQuestion(changeDocumentQuestion(expired.data, "company", body.documentId, questionId, "retry", later), scope, later);
  expect(retry.job!.leaseToken).not.toBe(body.leaseToken);
  const completed = reportDocumentQuestion(data, "company", body, scope.deviceId, stamp);
  expect(reportDocumentQuestion(completed, "company", body, scope.deviceId, later)).toBe(completed);
  expect(normalizeWorkspace(completed).documents[0].sheet!.questions[0].answer).toEqual(answer);
});
test("concurrent tab refresh and server answer merge without losing either snapshot or lease result", () => {
  const { data: base, body } = claimed();
  const local = archiveSheet(saveSheetSnapshot(base, "company", body.documentId, { ...base.documents[0].sheet!.snapshots[0], id: id(), values: [["다른 값"]] }), "company", body.documentId, true, stamp);
  const remote = reportDocumentQuestion(base, "company", body, scope.deviceId, stamp);
  const merged = mergeCloudWorkspace(base, local, remote);
  expect(merged.conflicts).toEqual([]);
  expect(merged.data.documents[0].sheet).toMatchObject({ archivedAt: stamp, questions: [{ status: "completed", answer }] });
  expect(merged.data.documents[0].sheet!.snapshots).toHaveLength(2);
});
test("backup import pauses document questions while preserving saved ranges and completed answers", async () => {
  const { parseBackup } = await import("../../src/lib/workspace/backup");
  const data = queued();
  const restored = parseBackup(JSON.stringify({ format: "jarvis-backup", version: 1, exportedAt: stamp, scope: "company", includesFiles: false, data, files: [] }));
  expect(restored.data.documents[0].sheet!.questions[0].status).toBe("interrupted");
  expect(restored.data.documents[0].sheet!.snapshots).toEqual(data.documents[0].sheet!.snapshots);
});
