import { checkOrigin, CloudError, failure, readJson, reply, spaceParam } from "@/lib/cloud/server";
import { changeWorkspace } from "@/lib/automation/server";
import { claimProjectWork } from "@/lib/automation/work";
import { claimInspection } from "@/lib/automation/state";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const body = await readJson(request);
    const space = spaceParam(body.space);
    if (!Array.isArray(body.projectIds) || body.projectIds.length === 0 || body.projectIds.length > 20 ||
        body.projectIds.some(id => id !== null && (typeof id !== "string" || id.length > 200)) || !["codex", "claude"].includes(String(body.provider)))
      throw new CloudError(400, "scope_required", "실행기에서 조회할 영역·프로젝트와 구독 CLI를 지정해주세요.");
    const projects = body.projectIds as (string | null)[];
    const provider = body.provider as "codex" | "claude";
    const stamp = new Date().toISOString();
    const result = await changeWorkspace(request, space, (data, deviceId) => {
      if (projects.some(id => id !== null && !data.projects.some(p => p.id === id && p.space === space)))
        throw new CloudError(400, "mixed_scope", "이 영역의 프로젝트만 실행기에 연결할 수 있습니다.");
      const original = data;
      const supportsWork = body.workVersion === 1 && provider === "codex";
      if (supportsWork) {
        data = { ...data, services: data.services.map(s => s.space === space && projects.includes(s.projectId) && s.monitoring &&
          (!s.monitoring.runnerSeenAt || Date.parse(stamp) - Date.parse(s.monitoring.runnerSeenAt) >= 60_000) ? { ...s, monitoring: { ...s.monitoring, runnerSeenAt: stamp, runnerVersion: "2.0.0" } } : s) };
        const work = claimProjectWork(data, { space, projectIds: projects, deviceId }, stamp);
        data = work.data;
        if (work.job) return { data, result: { job: work.job } };
      }
      const claimed = claimInspection(data, { space, projectIds: projects, provider, deviceId }, stamp);
      if (!claimed) return { data: JSON.stringify(data) === JSON.stringify(original) ? original : data, result: { job: null } };
      const s = claimed.service;
      return { data: claimed.data, result: { job: {
        id: s.monitoring!.job!.id, serviceId: s.id, space, projectId: s.projectId,
        repository: s.monitoring!.repository, provider,
        previousInspection: s.monitoring!.inspection, previousWebLinks: s.monitoring!.webLinks ?? [],
        previousSourceIds: data.sourceRecords.filter(r => r.serviceId === s.id && r.space === space && !r.deletedAt).map(r => r.externalId).slice(0, 5000),
      } } };
    });
    return reply(result);
  } catch (error) { return failure(error); }
}
