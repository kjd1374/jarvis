import { authorize, cloudEnabled, failure, reply } from "@/lib/cloud/server";
export async function GET(request: Request) {
  if (!cloudEnabled())
    return reply({
      available: false,
      authenticated: false,
      reason: "서버 저장 스키마와 계정 연결 승인이 필요합니다.",
      code: "cloud_disabled",
    });
  try {
    const auth = await authorize(request);
    return reply({
      available: true,
      authenticated: true,
      accountId: auth.ownerId,
    });
  } catch (error) {
    return failure(error);
  }
}
