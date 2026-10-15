import { createClient } from "@/lib/supabase/server";
import { cloudEnabled, reply, authorize } from "@/lib/cloud/server";
export async function GET(request: Request) {
  if (!cloudEnabled())
    return reply({ enabled: false, configured: false, authenticated: false });
  try {
    if (request.headers.get("authorization")?.startsWith("Bearer ")) {
      try {
        const auth = await authorize(request);
        return reply({
          enabled: true,
          configured: true,
          authenticated: true,
          accountId: auth.ownerId,
          deviceId: auth.deviceId,
        });
      } catch {
        return reply({ enabled: true, configured: true, authenticated: false });
      }
    }
    const client = await createClient();
    const { data: auth } = await client.auth.getUser();
    if (!auth.user)
      return reply({ enabled: true, configured: true, authenticated: false });
    const { data, error } = await client.rpc("jarvis_device_status");
    if (error)
      return reply({ enabled: true, configured: false, authenticated: false });
    return reply({
      enabled: true,
      configured: true,
      authenticated: !!data?.owner_id,
      accountId: data?.owner_id ?? undefined,
      deviceId: auth.user.id,
      pairingCode: data?.request_code ?? undefined,
    });
  } catch {
    return reply({ enabled: true, configured: false, authenticated: false });
  }
}
