import { authorize, checkOrigin, failure, readJson, reply, spaceParam, CloudError } from "@/lib/cloud/server";
import { releaseAction } from "@/lib/releases/server";
export const runtime = "nodejs";
export const maxDuration = 120;
export async function POST(request: Request) {
  try {
    checkOrigin(request); const body=await readJson(request);
    return reply({release:await releaseAction(request,await authorize(request),spaceParam(body.space),body)});
  } catch(e) {
    return failure(e instanceof CloudError ? e : new CloudError(409,"release_rejected",e instanceof Error&&/^[a-z_]{1,100}$/.test(e.message)?e.message:"release_request_failed"));
  }
}
