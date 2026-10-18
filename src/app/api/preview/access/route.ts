import { checkOrigin, CloudError, failure, readJson, reply } from "@/lib/cloud/server";
import { authorizedPreview } from "@/lib/preview/server";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const body = await readJson(request);
    const { auth, turn, preview } = await authorizedPreview(request, body);
    if (turn.executionDevice !== auth.deviceId || body.remoteId !== preview.remoteId || body.url !== preview.url || body.sha !== preview.sha ||
      typeof body.deviceId !== "string" || !/^[a-f0-9-]{36}$/.test(body.deviceId))
      throw new CloudError(403, "preview_access_denied", "이 미리보기를 실행한 기기에서만 접근 상태를 확인할 수 있습니다.");
    const { data, error } = await auth.client.rpc("jarvis_preview_device_allowed", { p_device: body.deviceId });
    if (error) throw new CloudError(503, "preview_access_unavailable", "미리보기 기기 확인을 완료하지 못했습니다.");
    return reply({ allowed: data === true });
  } catch (error) { return failure(error); }
}
