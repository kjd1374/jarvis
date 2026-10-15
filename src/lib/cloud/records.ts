import { type Space, type WorkspaceData } from "../workspace/types";
import { mergeWorkspace, scopeWorkspace } from "../workspace/transfer";
export type SyncState = {
  sequence: number;
  revisions: Record<Space, number>;
  dirty: Record<Space, number | null>;
  uploadedFiles: string[];
};
export const emptySync = (): SyncState => ({
  sequence: 0,
  revisions: { company: 0, personal: 0 },
  dirty: { company: null, personal: null },
  uploadedFiles: [],
});
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function replaceSpace(
  current: WorkspaceData,
  incoming: WorkspaceData,
  space: Space,
): WorkspaceData {
  const other = scopeWorkspace(
    current,
    space === "company" ? "personal" : "company",
  );
  const merged = mergeWorkspace(other, scopeWorkspace(incoming, space)).data;
  merged.activeSpace = current.activeSpace;
  merged.activeProjects[space] = incoming.activeProjects[space];
  merged.activeConversations[space] = incoming.activeConversations[space];
  return merged;
}
