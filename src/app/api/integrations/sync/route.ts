import {
  authorize,
  checkOrigin,
  failure,
  loadSpace,
  readJson,
  reply,
  saveSpace,
  spaceParam,
  CloudError,
} from "@/lib/cloud/server";
import { applySync, type SyncOutcome } from "@/lib/integrations/sync";
import { connectorFor } from "@/lib/integrations/registry";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const body = await readJson(request);
    const space = spaceParam(body.space);
    const auth = await authorize(request);
    const snapshot = await loadSpace(auth, space);
    const service = snapshot.data.services.find(
      (s) => s.id === body.serviceId && s.space === space,
    );
    if (!service)
      throw new CloudError(
        404,
        "service_missing",
        "이 영역의 서비스를 서버에서 찾을 수 없습니다. 서비스 등록 정보를 먼저 동기화해주세요.",
      );
    if (service.connector === "shortcut")
      throw new CloudError(
        409,
        "shortcut_only",
        "바로가기에는 데이터 수집 기능이 없습니다.",
      );
    const connector = connectorFor(service);
    let outcome: SyncOutcome;
    if (!connector) outcome = { ok: false, code: "needs_connection" };
    else {
      try {
        outcome = {
          ok: true,
          result: await connector.read({
            serviceId: service.id,
            space,
            projectId: service.projectId,
          }),
        };
      } catch {
        outcome = { ok: false, code: "unavailable" };
      }
    }
    const data = applySync(
      snapshot.data,
      service.id,
      space,
      outcome,
      new Date().toISOString(),
    );
    const revision = await saveSpace(auth, space, data, snapshot.revision);
    return reply({
      data,
      revision,
      connected:
        data.services.find((s) => s.id === service.id)?.connectionStatus ===
        "connected",
    });
  } catch (error) {
    return failure(error);
  }
}
