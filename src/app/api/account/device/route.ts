import { createClient } from "@/lib/supabase/server";
import {
  checkOrigin,
  cloudEnabled,
  reply,
  failure,
  CloudError,
} from "@/lib/cloud/server";
export async function POST(request: Request) {
  try {
    checkOrigin(request, false);
    if (!cloudEnabled())
      throw new CloudError(
        503,
        "cloud_disabled",
        "서버 저장 연결이 필요합니다.",
      );
    const client = await createClient();
    const { data } = await client.auth.getUser();
    if (!data.user) {
      const { error } = await client.auth.signInAnonymously();
      if (error)
        throw new CloudError(
          503,
          "device_unavailable",
          "이 기기의 연결을 준비하지 못했습니다. 잠시 후 다시 시도해주세요.",
        );
    }
    const { data: device, error } = await client.rpc("jarvis_register_device");
    if (error || !device)
      throw new CloudError(
        503,
        "device_unavailable",
        "기기 연결 설정을 확인해주세요.",
      );
    return reply({ registered: true });
  } catch (error) {
    return failure(error);
  }
}
