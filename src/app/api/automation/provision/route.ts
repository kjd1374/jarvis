import { checkOrigin, CloudError, failure, readJson, reply, spaceParam } from "@/lib/cloud/server";
import { changeWorkspace } from "@/lib/automation/server";
import { reportSetup } from "@/lib/automation/provision";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const body = await readJson(request), space = spaceParam(body.space), stamp = new Date().toISOString();
    return reply(await changeWorkspace(request, space, (data, deviceId) => {
      try { return { data: reportSetup(data, space, body, deviceId, stamp), result: { accepted: true } }; }
      catch (e) { throw new CloudError(e instanceof Error && e.message === "stale_job" ? 409 : 400, "setup_report_rejected", "프로젝트 준비 요청의 범위·상태를 확인해주세요."); }
    }));
  } catch (e) { return failure(e); }
}
