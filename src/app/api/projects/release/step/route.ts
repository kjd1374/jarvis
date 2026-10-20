import { readJson, reply, CloudError, failure } from "@/lib/cloud/server";
import { workerRelease } from "@/lib/releases/server";
export const runtime = "nodejs";
export const maxDuration = 120;
export async function POST(request: Request) {
  try { const body=await readJson(request);return reply(await workerRelease(request,body.ticket)); }
  catch { return failure(new CloudError(403,"release_worker_denied","배포 작업 권한이 만료되었거나 현재 요청과 일치하지 않습니다.")); }
}
