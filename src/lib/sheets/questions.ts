import { id, type Space, type WorkspaceData, type Document } from "../workspace/types";
import { parseDocumentAnswer, replaceSheet } from "./documents";
import type { DocumentQuestion } from "./types";

const leaseMs = 5 * 60_000;
function update(data: WorkspaceData, document: Document, question: DocumentQuestion) {
  return replaceSheet(data, document, { ...document.sheet!, questions: document.sheet!.questions.map(q => q.id === question.id ? question : q) });
}
export function enqueueDocumentQuestion(data: WorkspaceData, space: Space, documentId: string, snapshotId: string, question: string, stamp: string, questionId = id()) {
  const document = data.documents.find(d => d.space === space && d.id === documentId), sheet = document?.sheet;
  const snapshot = sheet?.snapshots.find(s => s.id === snapshotId);
  if (!document || !sheet || !snapshot || !question.trim() || question.length > 2000) throw new Error("질문할 문서·불러온 범위와 질문 내용을 확인해주세요.");
  if (sheet.questions.some(q => q.id === questionId)) return data;
  if (sheet.questions.length >= 500) throw new Error("이 문서의 문답 보관 한도에 도달했습니다.");
  if (sheet.questions.some(q => ["queued", "running"].includes(q.status))) throw new Error("진행 중인 답변을 기다리거나 취소한 뒤 질문해주세요.");
  const tab = sheet.tabs.find(t => t.snapshotId === snapshotId);
  const item: DocumentQuestion = { id: questionId, snapshotId, question: question.trim(), documentName: document.name,
    readAt: tab?.checkedAt ?? snapshot.capturedAt, createdAt: stamp, updatedAt: stamp, status: "queued", attempt: 0 };
  return replaceSheet(data, document, { ...sheet, questions: [...sheet.questions, item] });
}
export function changeDocumentQuestion(data: WorkspaceData, space: Space, documentId: string, questionId: string, action: "cancel" | "retry", stamp: string) {
  const document = data.documents.find(d => d.space === space && d.id === documentId), q = document?.sheet?.questions.find(q => q.id === questionId);
  if (!document || !q || action === "cancel" && !["queued", "running"].includes(q.status) || action === "retry" && !["failed", "interrupted"].includes(q.status)) throw new Error("현재 문답 상태를 확인해주세요.");
  if (action === "retry" && document.sheet!.questions.some(t => t.id !== q.id && ["queued", "running"].includes(t.status))) throw new Error("진행 중인 답변을 먼저 기다려주세요.");
  return update(data, document, { ...q, status: action === "cancel" ? "cancelled" : "queued", updatedAt: stamp, error: undefined, leaseOwner: undefined, leaseToken: undefined, leaseUntil: undefined });
}
export function claimDocumentQuestion(data: WorkspaceData, scope: { space: Space; projectIds: (string | null)[]; deviceId: string }, stamp: string) {
  let current = data;
  for (const initial of data.documents.filter(d => d.space === scope.space && scope.projectIds.includes(d.projectId) && d.sheet)) {
    const sheet = initial.sheet!;
    const questions = sheet.questions.map(q => q.status === "running" && Date.parse(q.leaseUntil ?? "") <= Date.parse(stamp)
      ? { ...q, status: "interrupted" as const, error: "runner_interrupted", updatedAt: stamp, leaseUntil: undefined, leaseToken: undefined } : q);
    if (questions.some((q, i) => q !== sheet.questions[i]) || !sheet.runnerSeenAt || Date.parse(stamp) - Date.parse(sheet.runnerSeenAt) >= 60_000)
      current = replaceSheet(current, initial, { ...sheet, questions, runnerSeenAt: stamp });
  }
  for (const document of current.documents.filter(d => d.space === scope.space && scope.projectIds.includes(d.projectId) && d.sheet)) {
    const sheet = document.sheet!;
    if (sheet.questions.some(q => q.status === "running")) continue;
    const q = sheet.questions.find(q => q.status === "queued");
    if (!q) continue;
    const snapshot = sheet.snapshots.find(s => s.id === q.snapshotId);
    if (!snapshot) throw new Error("invalid_document_snapshot");
    const claimed: DocumentQuestion = { ...q, status: "running", attempt: q.attempt + 1, updatedAt: stamp,
      leaseOwner: scope.deviceId, leaseToken: id(), leaseUntil: new Date(Date.parse(stamp) + leaseMs).toISOString() };
    return { data: update(current, document, claimed), job: { kind: "document", id: q.id, documentId: document.id, space: document.space,
      projectId: document.projectId, provider: "codex", leaseToken: claimed.leaseToken, attempt: claimed.attempt,
      question: q.question, documentName: q.documentName, snapshot, readAt: q.readAt,
      history: sheet.questions.filter(t => t.status === "completed" && t.snapshotId === q.snapshotId).slice(-4).map(t => ({ question: t.question, reply: t.answer!.reply })) } };
  }
  return { data: current, job: null };
}
export function reportDocumentQuestion(data: WorkspaceData, space: Space, body: Record<string, unknown>, deviceId: string, stamp: string) {
  const document = data.documents.find(d => d.space === space && d.id === body.documentId), q = document?.sheet?.questions.find(q => q.id === body.jobId);
  if (!document || !q || document.projectId !== body.projectId || q.snapshotId !== body.snapshotId || q.leaseOwner !== deviceId || !q.leaseToken || q.leaseToken !== body.leaseToken) throw new Error("stale_job");
  // Only the device that completed this attempt may redeliver a lost acknowledgement.
  if (body.phase === "result" && q.status === "completed") return data;
  if (q.status !== "running" || Date.parse(q.leaseUntil ?? "") <= Date.parse(stamp)) throw new Error("stale_job");
  if (body.phase === "heartbeat") return update(data, document, { ...q, updatedAt: stamp, leaseUntil: new Date(Date.parse(stamp) + leaseMs).toISOString() });
  if (body.phase === "error") {
    const error = ["cli_login_required", "cli_unavailable", "cli_limit", "invalid_document_answer", "command_timeout"].includes(String(body.error)) ? String(body.error) : "document_failed";
    return update(data, document, { ...q, status: "failed", error, updatedAt: stamp, leaseUntil: undefined });
  }
  if (body.phase !== "result") throw new Error("invalid_document_result");
  const snapshot = document.sheet!.snapshots.find(s => s.id === q.snapshotId)!;
  return update(data, document, { ...q, status: "completed", updatedAt: stamp, leaseUntil: undefined, answer: parseDocumentAnswer(body.answer, snapshot) });
}
