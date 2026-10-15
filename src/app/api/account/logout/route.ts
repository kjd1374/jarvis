import { checkOrigin, reply, failure, CloudError } from "@/lib/cloud/server";
import { createClient } from "@/lib/supabase/server";
export async function POST(request: Request) {
  try {
    checkOrigin(request, false);
    const client = await createClient();
    const revoked = await client.rpc("jarvis_disconnect_device");
    if (revoked.error)
      throw new CloudError(
        503,
        "logout_failed",
        "이 기기의 접근 권한을 해제하지 못했습니다.",
      );
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error)
      throw new CloudError(
        503,
        "logout_failed",
        "계정 연결을 해제하지 못했습니다.",
      );
    return reply({ disconnected: true });
  } catch (error) {
    return failure(error);
  }
}
