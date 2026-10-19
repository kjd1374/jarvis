import type { GitHubMonitoring } from "../automation/types";
export type Space = "company" | "personal";
export type TaskStatus = "todo" | "in_progress" | "decision" | "done";
export type Project = {
  setup?: import("../automation/provision").ProjectSetup;
  automation?: import("../automation/work-types").ProjectAutomation;
  id: string;
  space: Space;
  name: string;
  description: string;
  // Legacy addresses are retained for backup compatibility; edit services instead.
  connectionsUnified?: true;
  repositoryUrl?: string;
  serviceUrl?: string;
  currentStatus?: string;
  nextAction?: string;
  createdAt: string;
};
export type Task = {
  sourceSuggestionId?: string;
  sourceMessageId?: string;
  id: string;
  space: Space;
  title: string;
  projectId: string | null;
  status: TaskStatus;
  dueDate: string;
  createdAt: string;
};
export type Conversation = {
  id: string;
  space: Space;
  projectId: string | null;
  title: string;
  createdAt: string;
  updatedAt: string;
};
export type Message = {
  id: string;
  conversationId: string;
  content: string;
  fileIds: string[];
  createdAt: string;
};
export type ContextNote = {
  id: string;
  space: Space;
  projectId: string | null;
  content: string;
  updatedAt: string;
  revision: number;
};
export type ContextRevision = {
  id: string;
  contextId: string;
  content: string;
  createdAt: string;
  revision: number;
};
export type Document = {
  sheet?: import("../sheets/types").SheetDocument;
  sourceUrl?: string;
  id: string;
  space: Space;
  name: string;
  mime: string;
  size: number;
  projectId: string | null;
  taskId: string | null;
  createdAt: string;
};
export type Note = {
  id: string;
  space: Space;
  projectId: string | null;
  content: string;
  createdAt: string;
  updatedAt: string;
};
export type Service = {
  monitoring?: GitHubMonitoring;
  id: string;
  space: Space;
  projectId: string | null;
  name: string;
  webUrl: string;
  repositoryUrl: string;
  connector: "shortcut" | "v4";
  favorite: boolean;
  createdAt: string;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  connectionStatus: "shortcut" | "needs_connection" | "connected" | "error";
  error: string | null;
  failures: number;
  nextRetryAt: string | null;
};
export type SourceRecord = {
  id: string;
  serviceId: string;
  externalId: string;
  space: Space;
  projectId: string | null;
  title: string;
  content: string;
  status: string;
  sourceUrl: string;
  sourceUpdatedAt: string;
  collectedAt: string;
  deletedAt: string | null;
  taskId: string | null;
};
export type RequestStatus =
  | "registered"
  | "queued"
  | "in_progress"
  | "awaiting_review"
  | "completed"
  | "failed";
export type ChangeRequest = {
  id: string;
  space: Space;
  projectId: string | null;
  serviceId: string | null;
  title: string;
  content: string;
  status: RequestStatus;
  approval: "not_requested" | "pending" | "approved" | "rejected";
  verification: string;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
export type SyncEvent = {
  id: string;
  serviceId: string;
  space: Space;
  attemptedAt: string;
  status: "success" | "error";
  code: string;
  received: number;
};
export const requestLabels: Record<RequestStatus, string> = {
  registered: "요청 등록",
  queued: "실행 대기",
  in_progress: "진행 중",
  awaiting_review: "검증 대기",
  completed: "완료",
  failed: "실패",
};
export type WorkspaceData = {
  providerConnections?: import("../automation/providers").ProviderConnections;
  version: 1;
  activeSpace: Space;
  activeProjects: Record<Space, string | null>;
  activeConversations: Record<Space, string | null>;
  projects: Project[];
  tasks: Task[];
  conversations: Conversation[];
  messages: Message[];
  contexts: ContextNote[];
  contextRevisions: ContextRevision[];
  documents: Document[];
  notes: Note[];
  services: Service[];
  sourceRecords: SourceRecord[];
  requests: ChangeRequest[];
  syncEvents: SyncEvent[];
};

export function emptyWorkspace(): WorkspaceData {
  return {
    version: 1,
    activeSpace: "company",
    activeProjects: { company: null, personal: null },
    activeConversations: { company: null, personal: null },
    projects: [],
    tasks: [],
    conversations: [],
    messages: [],
    contexts: [],
    contextRevisions: [],
    documents: [],
    notes: [],
    services: [],
    sourceRecords: [],
    requests: [],
    syncEvents: [],
  };
}

export const spaceLabels: Record<Space, string> = {
  company: "회사",
  personal: "개인",
};
export const statusLabels: Record<TaskStatus, string> = {
  todo: "할 일",
  in_progress: "진행 중",
  decision: "결정 대기",
  done: "완료",
};
export function id() {
  return crypto.randomUUID();
}
export function now() {
  return new Date().toISOString();
}
export function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function dateLabel(value: string) {
  if (!Number.isFinite(Date.parse(value))) return "기준 시각 확인 필요";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}
export function fileSize(value: number) {
  return value >= 1024 * 1024
    ? `${(value / (1024 * 1024)).toFixed(1)} MB`
    : value >= 1024
      ? `${Math.ceil(value / 1024)} KB`
      : `${value} B`;
}

export function assertLinks(
  data: WorkspaceData,
  space: Space,
  projectId: string | null,
  taskId: string | null = null,
) {
  if (
    projectId &&
    !data.projects.some((p) => p.id === projectId && p.space === space)
  )
    throw new Error("같은 영역의 프로젝트를 선택해주세요.");
  if (
    taskId &&
    !data.tasks.some(
      (t) => t.id === taskId && t.space === space && t.projectId === projectId,
    )
  )
    throw new Error("선택한 프로젝트의 업무를 선택해주세요.");
}

export function updateContext(
  data: WorkspaceData,
  space: Space,
  projectId: string | null,
  content: string,
): WorkspaceData {
  assertLinks(data, space, projectId);
  const existing = data.contexts.find(
    (c) => c.space === space && c.projectId === projectId,
  );
  const note: ContextNote = {
    id: existing?.id ?? id(),
    space,
    projectId,
    content,
    updatedAt: now(),
    revision: (existing?.revision ?? 0) + 1,
  };
  return {
    ...data,
    contexts: [...data.contexts.filter((c) => c.id !== note.id), note],
    contextRevisions: [
      ...data.contextRevisions,
      {
        id: id(),
        contextId: note.id,
        content,
        createdAt: note.updatedAt,
        revision: note.revision,
      },
    ],
  };
}
