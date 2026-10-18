import { checkOrigin, CloudError, failure, readJson, reply, spaceParam } from "@/lib/cloud/server";
import { changeWorkspace } from "@/lib/automation/server";
import { requireLease } from "@/lib/automation/state";
import { refreshAutomaticRunner } from "@/lib/automation/runner-status";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const body = await readJson(request);
    const space = spaceParam(body.space);
    const stamp = new Date().toISOString();
    return reply(await changeWorkspace(request, space, (data, deviceId) => {
      const service = data.services.find(s => s.id === body.serviceId && s.space === space);
      if (!service) throw new CloudError(404, "service_missing", "이 영역의 연결을 찾을 수 없습니다.");
      try { requireLease(service, body.jobId, deviceId, stamp); }
      catch { throw new CloudError(409, "stale_job", "실행 요청이 만료되었습니다."); }
      const next = { ...data, services: data.services.map(s => s.id === service.id ? { ...s, monitoring: { ...s.monitoring!, runnerSeenAt: stamp, job: { ...s.monitoring!.job!,
        leaseUntil: new Date(Date.parse(stamp) + 10 * 60_000).toISOString() } } } : s) };
      return { data: refreshAutomaticRunner(next, space, service.id, stamp), result: { alive: true } };
    }));
  } catch (error) { return failure(error); }
}
