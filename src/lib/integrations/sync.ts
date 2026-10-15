import { id, type Space, type WorkspaceData } from "../workspace/types";
import { normalizeWorkspace } from "../workspace/validation";

export type ConnectorItem = {
  externalId: string;
  title: string;
  content: string;
  status: string;
  sourceUrl: string;
  sourceUpdatedAt: string;
};
export type ConnectorResult = {
  mode: "full" | "delta";
  complete: boolean;
  items: ConnectorItem[];
  deletedIds: string[];
};
export type SyncOutcome =
  | { ok: true; result: ConnectorResult }
  | {
      ok: false;
      code: "unavailable" | "needs_connection" | "invalid_response";
    };
export interface ReadConnector {
  readonly id: string;
  readonly canExecute: false;
  read(input: {
    serviceId: string;
    space: Space;
    projectId: string | null;
  }): Promise<ConnectorResult>;
}
export function applySync(
  data: WorkspaceData,
  serviceId: string,
  space: Space,
  outcome: SyncOutcome,
  stamp: string,
): WorkspaceData {
  const service = data.services.find(
    (s) => s.id === serviceId && s.space === space,
  );
  if (!service) throw new Error("이 영역의 서비스를 찾을 수 없습니다.");
  let result = data;
  let code: string = outcome.ok ? "ok" : outcome.code;
  let received = 0;
  if (outcome.ok) {
    try {
      const batch = outcome.result;
      if (
        !batch.complete ||
        !Array.isArray(batch.items) ||
        !Array.isArray(batch.deletedIds) ||
        !["full", "delta"].includes(batch.mode)
      )
        throw new Error("Incomplete response");
      const items = batch.items.map(
        ({
          externalId,
          title,
          content,
          status,
          sourceUrl,
          sourceUpdatedAt,
        }) => ({
          externalId,
          title,
          content,
          status,
          sourceUrl,
          sourceUpdatedAt,
        }),
      );
      const externalIds = new Set<string>();
      for (const item of items) {
        if (
          !item.externalId ||
          externalIds.has(item.externalId) ||
          !Number.isFinite(Date.parse(item.sourceUpdatedAt)) ||
          typeof item.content !== "string" ||
          typeof item.title !== "string" ||
          typeof item.status !== "string"
        )
          throw new Error("Invalid response");
        externalIds.add(item.externalId);
        const url = new URL(item.sourceUrl);
        if (
          !["https:", "http:"].includes(url.protocol) ||
          url.username ||
          url.password
        )
          throw new Error("Invalid source URL");
      }
      if (
        batch.deletedIds.some(
          (key) => typeof key !== "string" || externalIds.has(key),
        )
      )
        throw new Error("Conflicting deletion");
      const records = data.sourceRecords.map((row) => {
        if (row.serviceId !== serviceId || row.space !== space) return row;
        const item = items.find((i) => i.externalId === row.externalId);
        if (
          item &&
          Date.parse(item.sourceUpdatedAt) < Date.parse(row.sourceUpdatedAt)
        )
          return row;
        if (item)
          return {
            ...row,
            ...item,
            sourceUpdatedAt: item.sourceUpdatedAt,
            collectedAt: stamp,
            deletedAt: null,
          };
        if (
          batch.deletedIds.includes(row.externalId) ||
          (batch.mode === "full" && !externalIds.has(row.externalId))
        )
          return { ...row, deletedAt: stamp, collectedAt: stamp };
        return row;
      });
      for (const item of items)
        if (
          !records.some(
            (r) =>
              r.serviceId === serviceId && r.externalId === item.externalId,
          )
        )
          records.push({
            ...item,
            id: `source:${JSON.stringify([serviceId, item.externalId])}`,
            serviceId,
            space,
            projectId: service.projectId,
            collectedAt: stamp,
            deletedAt: null,
            taskId: null,
          });
      received = batch.items.length;
      result = normalizeWorkspace({
        ...data,
        sourceRecords: records,
        services: data.services.map((s) =>
          s.id === serviceId
            ? {
                ...s,
                connectionStatus: "connected",
                lastSuccessAt: stamp,
                lastAttemptAt: stamp,
                failures: 0,
                error: null,
                nextRetryAt: null,
              }
            : s,
        ),
      });
    } catch {
      code = "invalid_response";
    }
  }
  const success = code === "ok";
  if (!success) {
    result = {
      ...data,
      services: data.services.map((s) =>
        s.id === serviceId
          ? {
              ...s,
              connectionStatus:
                code === "needs_connection" ? "needs_connection" : "error",
              lastAttemptAt: stamp,
              error:
                code === "needs_connection"
                  ? "읽기 연결 정보와 인증이 필요합니다."
                  : "수집에 실패했습니다. 마지막 정상 자료를 유지합니다.",
              failures: s.failures + 1,
              nextRetryAt: new Date(
                Date.parse(stamp) +
                  Math.min(900_000, 30_000 * 2 ** Math.min(s.failures, 5)),
              ).toISOString(),
            }
          : s,
      ),
    };
  }
  return {
    ...result,
    syncEvents: [
      ...result.syncEvents,
      {
        id: id(),
        serviceId,
        space,
        attemptedAt: stamp,
        status: success ? ("success" as const) : ("error" as const),
        code,
        received: success ? received : 0,
      },
    ].slice(-200),
  };
}
