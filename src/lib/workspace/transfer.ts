import { type WorkspaceData, type Space, emptyWorkspace } from "./types";
import { collections, normalizeWorkspace } from "./validation";

export function mergeWorkspace(
  currentValue: unknown,
  incomingValue: unknown,
  preferIncoming = false,
): { data: WorkspaceData; added: number; conflicts: number } {
  const current = normalizeWorkspace(currentValue);
  const incoming = normalizeWorkspace(incomingValue);
  const data = { ...current };
  let added = 0;
  let conflicts = 0;
  for (const key of collections) {
    const existing = current[key] as { id: string; space?: Space }[];
    const incomingRows = incoming[key] as { id: string; space?: Space }[];
    const merged = [...existing];
    for (const row of incomingRows) {
      const prior = existing.find((r) => r.id === row.id);
      if (prior) {
        if (prior.space !== row.space)
          throw new Error(
            "영역이 다른 같은 ID가 있습니다. 기존 데이터는 유지됩니다.",
          );
        if (JSON.stringify(prior) !== JSON.stringify(row)) {
          conflicts++;
          if (preferIncoming)
            merged[merged.findIndex((r) => r.id === row.id)] = row;
        }
      } else {
        merged.push(row);
        added++;
      }
    }
    Object.assign(data, { [key]: merged });
  }
  return { data: normalizeWorkspace(data), added, conflicts };
}
export function scopeWorkspace(
  input: WorkspaceData,
  space: Space,
  projectId?: string,
): WorkspaceData {
  const data = normalizeWorkspace(input);
  const scoped = emptyWorkspace();
  scoped.activeSpace = space;
  scoped.activeProjects[space] = data.activeProjects[space];
  scoped.activeConversations[space] = data.activeConversations[space];
  const allowed = (r: { space: Space; projectId?: string | null }) =>
    r.space === space && (projectId === undefined || r.projectId === projectId);
  scoped.projects = data.projects.filter(
    (r) => r.space === space && (projectId === undefined || r.id === projectId),
  );
  for (const key of [
    "tasks",
    "conversations",
    "contexts",
    "documents",
    "notes",
    "services",
    "sourceRecords",
    "requests",
  ] as const)
    Object.assign(scoped, { [key]: data[key].filter(allowed) });
  scoped.messages = data.messages.filter((m) =>
    scoped.conversations.some((c) => c.id === m.conversationId),
  );
  scoped.contextRevisions = data.contextRevisions.filter((r) =>
    scoped.contexts.some((c) => c.id === r.contextId),
  );
  scoped.syncEvents = data.syncEvents.filter(
    (e) =>
      e.space === space && scoped.services.some((s) => s.id === e.serviceId),
  );
  if (projectId !== undefined)
    scoped.activeProjects[space] = scoped.projects[0]?.id ?? null;
  if (
    !scoped.conversations.some(
      (c) => c.id === scoped.activeConversations[space],
    )
  )
    scoped.activeConversations[space] = null;
  return scoped;
}
