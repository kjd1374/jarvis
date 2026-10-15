import { unifyProjectConnections } from "./project-connections";
import { emptyWorkspace, type WorkspaceData, type Space } from "./types";

export const collections = [
  "projects",
  "tasks",
  "conversations",
  "messages",
  "contexts",
  "contextRevisions",
  "documents",
  "notes",
  "services",
  "sourceRecords",
  "requests",
  "syncEvents",
] as const;
export type Collection = (typeof collections)[number];
export function validSpace(value: unknown): value is Space {
  return value === "company" || value === "personal";
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown, max = 200_000): value is string {
  return typeof value === "string" && value.length <= max;
}
function timestamp(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
function safeUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("웹 주소를 확인해주세요.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("웹 주소에 비밀값이나 실행 명령을 넣을 수 없습니다.");
  if (
    [...url.searchParams.keys()].some((key) =>
      /token|secret|password|api.?key/i.test(key),
    )
  )
    throw new Error("토큰이 포함된 주소는 저장할 수 없습니다.");
}
export function normalizeWorkspace(value: unknown): WorkspaceData {
  if (value === undefined) return emptyWorkspace();
  if (!object(value) || value.version !== 1)
    throw new Error("지원하지 않는 저장 형식입니다. 기존 기록은 유지됩니다.");
  const data = { ...emptyWorkspace(), ...value } as WorkspaceData;
  if (
    !validSpace(data.activeSpace) ||
    !object(data.activeProjects) ||
    !object(data.activeConversations)
  )
    throw new Error("업무 영역 정보를 확인해주세요.");
  for (const key of collections) {
    const rows = data[key];
    if (!Array.isArray(rows) || rows.length > 100_000)
      throw new Error("저장 목록 형식이 올바르지 않습니다.");
    const ids = new Set<string>();
    for (const row of rows) {
      if (!object(row) || !text(row.id, 2048) || !row.id || ids.has(row.id))
        throw new Error("항목 ID가 비어 있거나 중복되었습니다.");
      ids.add(row.id);
      const dates =
        key === "contexts"
          ? ["updatedAt"]
          : key === "sourceRecords"
            ? ["sourceUpdatedAt", "collectedAt"]
            : key === "syncEvents"
              ? ["attemptedAt"]
              : key === "notes" || key === "conversations" || key === "requests"
                ? ["createdAt", "updatedAt"]
                : ["createdAt"];
      if (
        dates.some(
          (field) => !timestamp((row as Record<string, unknown>)[field]),
        )
      )
        throw new Error("기록의 기준 시각을 확인해주세요.");
      if (
        key !== "messages" &&
        key !== "contextRevisions" &&
        (!("space" in row) || !validSpace(row.space))
      )
        throw new Error("항목의 회사·개인 영역을 확인해주세요.");
      for (const [field, content] of Object.entries(row)) {
        if (/^(apiKey|accessToken|token|password|secret)$/i.test(field))
          throw new Error("비밀값은 업무 기록에 저장할 수 없습니다.");
        if (typeof content === "string" && !text(content))
          throw new Error("저장할 내용이 너무 깁니다.");
        if (
          [
            "createdAt",
            "updatedAt",
            "attemptedAt",
            "sourceUpdatedAt",
            "collectedAt",
          ].includes(field) &&
          !timestamp(content)
        )
          throw new Error("기록의 기준 시각을 확인해주세요.");
        if (
          [
            "lastSuccessAt",
            "lastAttemptAt",
            "nextRetryAt",
            "deletedAt",
            "verifiedAt",
          ].includes(field) &&
          content !== null &&
          !timestamp(content)
        )
          throw new Error("연결·검증 시각을 확인해주세요.");
      }
    }
  }
  for (const space of ["company", "personal"] as const) {
    const project = data.activeProjects[space];
    const conversation = data.activeConversations[space];
    if (
      project !== null &&
      !data.projects.some((p) => p.id === project && p.space === space)
    )
      throw new Error("선택한 프로젝트의 영역을 확인해주세요.");
    if (
      conversation !== null &&
      !data.conversations.some(
        (c) => c.id === conversation && c.space === space,
      )
    )
      throw new Error("선택한 대화의 영역을 확인해주세요.");
  }
  for (const project of data.projects)
    if (
      (project.connectionsUnified !== undefined && project.connectionsUnified !== true) ||
      !text(project.name, 160) ||
      !project.name.trim() ||
      !text(project.description, 10000)
    )
      throw new Error("프로젝트 내용을 확인해주세요.");
  const projectMatches = (id: string | null, space: Space) =>
    id === null || data.projects.some((p) => p.id === id && p.space === space);
  for (const key of [
    "tasks",
    "conversations",
    "contexts",
    "documents",
    "notes",
    "services",
    "sourceRecords",
    "requests",
  ] as const) {
    for (const row of data[key])
      if (!projectMatches(row.projectId, row.space))
        throw new Error("서로 다른 영역의 프로젝트를 연결할 수 없습니다.");
  }
  for (const row of data.messages)
    if (
      !text(row.content, 50_000) ||
      !Array.isArray(row.fileIds) ||
      !data.conversations.some((c) => c.id === row.conversationId)
    )
      throw new Error("대화 연결을 확인해주세요.");
  for (const row of data.messages) {
    const parent = data.conversations.find((c) => c.id === row.conversationId)!;
    if (
      row.fileIds.some(
        (id) =>
          !data.documents.some(
            (d) =>
              d.id === id &&
              d.space === parent.space &&
              (!parent.projectId || d.projectId === parent.projectId),
          ),
      )
    )
      throw new Error("다른 영역·프로젝트 자료를 대화에 전달할 수 없습니다.");
  }
  for (const row of data.contextRevisions)
    if (
      !text(row.content, 100_000) ||
      !data.contexts.some((c) => c.id === row.contextId)
    )
      throw new Error("맥락 수정 이력 연결을 확인해주세요.");
  for (const row of data.notes)
    if (!text(row.content, 50_000) || !row.content.trim())
      throw new Error("메모 내용을 확인해주세요.");
  for (const row of data.tasks)
    if (
      !text(row.title, 500) ||
      !["todo", "in_progress", "decision", "done"].includes(row.status)
    )
      throw new Error("업무 상태를 확인해주세요.");
  for (const row of data.documents) {
    if (
      !text(row.name, 500) ||
      !text(row.mime, 200) ||
      !Number.isSafeInteger(row.size) ||
      row.size < 0 ||
      row.size > 20 * 1024 * 1024
    )
      throw new Error("자료 이름과 크기를 확인해주세요.");
    if (row.sourceUrl) safeUrl(row.sourceUrl);
    if (
      row.taskId &&
      !data.tasks.some(
        (t) =>
          t.id === row.taskId &&
          t.space === row.space &&
          t.projectId === row.projectId,
      )
    )
      throw new Error("자료와 업무의 범위를 확인해주세요.");
  }
  for (const row of data.services) {
    if (
      !text(row.name, 120) ||
      !["shortcut", "v4"].includes(row.connector) ||
      !["shortcut", "needs_connection", "connected", "error"].includes(
        row.connectionStatus,
      )
    )
      throw new Error("서비스 연결 정보를 확인해주세요.");
    if (row.connector === "v4" && row.space !== "company")
      throw new Error("v4는 회사 영역에서만 등록할 수 있습니다.");
    for (const raw of [row.webUrl, row.repositoryUrl]) {
      if (!raw) continue;
      safeUrl(raw);
    }
  }
  const sourceIds = new Set<string>();
  for (const row of data.sourceRecords) {
    const identity = JSON.stringify([row.serviceId, row.externalId]);
    if (sourceIds.has(identity))
      throw new Error("같은 출처 항목을 중복 저장할 수 없습니다.");
    sourceIds.add(identity);
    const service = data.services.find(
      (s) =>
        s.id === row.serviceId &&
        s.space === row.space &&
        s.projectId === row.projectId,
    );
    if (!service || !text(row.externalId, 300) || !text(row.content, 100_000))
      throw new Error("출처 자료의 서비스와 영역을 확인해주세요.");
    safeUrl(row.sourceUrl);
    if (
      row.taskId &&
      !data.tasks.some(
        (t) =>
          t.id === row.taskId &&
          t.space === row.space &&
          t.projectId === row.projectId,
      )
    )
      throw new Error("출처 자료와 업무의 영역을 확인해주세요.");
  }
  for (const row of data.requests) {
    if (
      !text(row.title, 200) ||
      !text(row.content, 20_000) ||
      !text(row.verification, 10_000) ||
      !["not_requested", "pending", "approved", "rejected"].includes(
        row.approval,
      ) ||
      ![
        "registered",
        "queued",
        "in_progress",
        "awaiting_review",
        "completed",
        "failed",
      ].includes(row.status)
    )
      throw new Error("요청 내용을 확인해주세요.");
    if (
      row.serviceId &&
      !data.services.some(
        (s) =>
          s.id === row.serviceId &&
          s.space === row.space &&
          s.projectId === row.projectId,
      )
    )
      throw new Error("요청과 서비스의 범위를 확인해주세요.");
    if (
      row.status === "completed" &&
      (!row.verification.trim() ||
        !row.verifiedAt ||
        row.approval !== "approved")
    )
      throw new Error("검증 기록과 승인이 있어야 완료할 수 있습니다.");
  }
  for (const row of data.syncEvents)
    if (
      !data.services.some(
        (s) => s.id === row.serviceId && s.space === row.space,
      ) ||
      !["success", "error"].includes(row.status) ||
      !Number.isSafeInteger(row.received) ||
      row.received < 0
    )
      throw new Error("동기화 기록의 범위를 확인해주세요.");
  return unifyProjectConnections(data);
}
