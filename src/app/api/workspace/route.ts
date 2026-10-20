import { randomUUID } from "node:crypto";
import {
  authorize,
  checkOrigin,
  failure,
  loadSpace,
  readJson,
  reply,
  saveSpace,
  scopedPayload,
  spaceParam,
  CloudError,
} from "@/lib/cloud/server";
import { scopeWorkspace } from "@/lib/workspace/transfer";
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const space = spaceParam(url.searchParams.get("space"));
    const auth = await authorize(request);
    const result = await loadSpace(auth, space);
    const projectId = url.searchParams.get("projectId");
    return reply({
      ...result,
      data: projectId
        ? scopeWorkspace(result.data, space, projectId)
        : result.data,
    });
  } catch (error) {
    return failure(error);
  }
}
export async function PUT(request: Request) {
  try {
    checkOrigin(request);
    const body = await readJson(request);
    const space = spaceParam(body.space);
    if (!Number.isSafeInteger(body.revision) || Number(body.revision) < 0)
      throw new CloudError(
        400,
        "revision_required",
        "확인한 서버 버전이 필요합니다.",
      );
    const value = scopedPayload(body.data, space);
    const auth = await authorize(request);
    const current = await loadSpace(auth, space);
    value.providerConnections = current.data.providerConnections;
    // Release leases, resource IDs and verification are server-authored. A stale
    // browser save/import cannot replay a deployment or forge its completion.
    value.projects = value.projects.map(p => {
      const release = current.data.projects.find(r => r.id === p.id)?.release;
      const imported = p.release?.status === "interrupted" && p.release.error === "imported_request_review";
      return { ...p, release: imported && release && ["queued", "running"].includes(release.status) ? {
        ...release, status: "interrupted" as const, error: "imported_request_review", executionId: randomUUID(), leaseToken: undefined, leaseUntil: undefined, updatedAt: new Date().toISOString(),
      } : release };
    });
    return reply({
      revision: await saveSpace(auth, space, value, Number(body.revision)),
    });
  } catch (error) {
    return failure(error);
  }
}
