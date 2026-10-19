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
    return reply({
      revision: await saveSpace(auth, space, value, Number(body.revision)),
    });
  } catch (error) {
    return failure(error);
  }
}
