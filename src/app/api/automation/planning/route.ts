import { checkOrigin, CloudError, failure, readJson, reply, spaceParam } from "@/lib/cloud/server";
import { changeWorkspace } from "@/lib/automation/server";
import { reportPlanning } from "@/lib/projects/planning";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const body = await readJson(request), space = spaceParam(body.space), stamp = new Date().toISOString();
    return reply(await changeWorkspace(request, space, (data, deviceId) => {
      try { return { data: reportPlanning(data, space, body, deviceId, stamp), result: { accepted: true } }; }
      catch (error) {
        if (error instanceof Error && error.message === "stale_job") throw new CloudError(409, "stale_job", "기획 요청이 취소·만료되었거나 다른 실행기에 속합니다.");
        throw new CloudError(400, "invalid_planning_result", "기획 결과의 범위·형식을 확인하지 못했습니다.");
      }
    }));
  } catch (error) { return failure(error); }
}
