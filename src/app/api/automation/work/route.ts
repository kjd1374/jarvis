import { checkOrigin, CloudError, failure, readJson, reply, spaceParam } from "@/lib/cloud/server";
import { changeWorkspace } from "@/lib/automation/server";
import { reportProjectWork } from "@/lib/automation/work";
import { refreshAutomaticRunner } from "@/lib/automation/runner-status";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const body = await readJson(request), space = spaceParam(body.space), stamp = new Date().toISOString();
    return reply(await changeWorkspace(request, space, (data, deviceId) => {
      const turn = data.projects.find(p => p.id === body.projectId && p.space === space)?.automation?.turns.find(t => t.id === body.jobId);
      // A lost response can be delivered again without duplicating tasks or replaying a write.
      if (body.phase === "result" && turn?.status === "completed") return { data, result: { accepted: true, duplicate: true } };
      try {
        const next = reportProjectWork(data, space, body, deviceId, stamp);
        return { data: body.phase === "heartbeat" ? refreshAutomaticRunner(next, space, turn?.serviceId, stamp) : next, result: { accepted: true } };
      }
      catch (error) {
        if (error instanceof Error && error.message === "stale_job") throw new CloudError(409, "stale_job", "요청이 취소·만료되었거나 저장소가 변경되었습니다.");
        throw new CloudError(400, "invalid_work_result", "실행 결과의 범위·형식을 확인하지 못했습니다.");
      }
    }));
  } catch (error) { return failure(error); }
}
