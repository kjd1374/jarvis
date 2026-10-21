import { credentialsFor } from "@/lib/automation/providers";
import { claimSetup } from "@/lib/automation/provision";
import { claimPlanning } from "@/lib/projects/planning";
import { checkOrigin, CloudError, failure, readJson, reply, spaceParam } from "@/lib/cloud/server";
import { changeWorkspace } from "@/lib/automation/server";
import { claimProjectWork } from "@/lib/automation/work";
import { claimInspection } from "@/lib/automation/state";
import { claimDocumentQuestion } from "@/lib/sheets/questions";
import { observeWorkRunner, runnerProjectIds } from "@/lib/automation/runner-status";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const body = await readJson(request);
    const space = spaceParam(body.space);
    if (!Array.isArray(body.projectIds) || body.projectIds.length === 0 || body.projectIds.length > 20 ||
        body.projectIds.some(id => id !== null && (typeof id !== "string" || id.length > 200)) || !["codex", "claude"].includes(String(body.provider)) ||
        body.projectScope !== undefined && body.projectScope !== "space" && body.projectScope !== "selected")
      throw new CloudError(400, "scope_required", "실행기에서 조회할 영역·프로젝트와 구독 CLI를 지정해주세요.");
    const requestedProjects = body.projectIds as (string | null)[];
    const provider = body.provider as "codex" | "claude";
    const supportsWork = body.workVersion === 1 && provider === "codex";
    const projectScope = supportsWork && body.projectScope !== "selected" ? "space" : "selected";
    const stamp = new Date().toISOString();
    const result = await changeWorkspace(request, space, (data, deviceId, ownerId) => {
      let projects: (string | null)[];
      try { projects = runnerProjectIds(data, space, requestedProjects, projectScope); }
      catch { throw new CloudError(400, "mixed_scope", "이 영역의 프로젝트만 실행기에 연결할 수 있습니다."); }
      const original = data;
      if (supportsWork) data = observeWorkRunner(data, { space, projectIds: projects, projectScope }, body, stamp);
      if (supportsWork && body.planningVersion === 1) {
        const planning = claimPlanning(data, { space, projectIds: projects, deviceId, runnerVersion: typeof body.runnerVersion === "string" ? body.runnerVersion : undefined }, stamp);
        data = planning.data;
        if (planning.job) return { data, result: { job: planning.job } };
      }
      if (body.documentVersion === 1 && provider === "codex") {
        const document = claimDocumentQuestion(data, { space, projectIds: projects, deviceId }, stamp);
        data = document.data;
        if (document.job) return { data, result: { job: document.job } };
      }
      if (supportsWork && body.provisionVersion === 1) {
        const setup = claimSetup(data, { space, projectIds: projects, deviceId, development: body.developmentVersion === 1 }, stamp);
        data = setup.data;
        if (setup.job) return { data, result: { job: { ...setup.job, credentials: credentialsFor(data, ownerId, space) } } };
      }
      if (supportsWork) {
        const work = claimProjectWork(data, { space, projectIds: projects, deviceId, runnerVersion: typeof body.runnerVersion === "string" ? body.runnerVersion : undefined, previews: body.previewVersion === 1, remoteWork: body.remoteWorkVersion === 1, previewCli: body.previewCliVersion === 1, previewLocal: body.previewLocalVersion === 1, managedWork: body.provisionVersion === 1, development: body.developmentVersion === 1 }, stamp);
        data = work.data;
        if (work.job || work.waitingForUpdate) return { data, result: { job: work.job } };
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
