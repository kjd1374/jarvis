export type Space = "company" | "personal";
export type TaskStatus = "todo" | "in_progress" | "decision" | "done";
export type Project = {
  id: string;
  space: Space;
  name: string;
  description: string;
  createdAt: string;
};
export type Task = {
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
  id: string;
  space: Space;
  name: string;
  mime: string;
  size: number;
  projectId: string | null;
  taskId: string | null;
  createdAt: string;
};
export type WorkspaceData = {
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
