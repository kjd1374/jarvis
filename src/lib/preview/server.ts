import "server-only";
import { authorize, CloudError, loadSpace, spaceParam } from "@/lib/cloud/server";
import { currentPreviewTurn } from "@/lib/automation/work";
import { repositoryFor } from "@/lib/automation/state";
import { issuePreviewTicket, previewOrigin, ticketPublicKey } from "../../../public/jarvis-preview-auth.mjs";

export function previewSigningKey() {
  const key = process.env.JARVIS_PREVIEW_SIGNING_KEY;
  if (!key) throw new CloudError(503, "preview_unconfigured", "원격 미리보기 연결을 준비하고 있습니다. 잠시 후 다시 시도해주세요.");
  return key;
}
export function previewPublicKey() { return ticketPublicKey(previewSigningKey()); }

export async function authorizedPreview(request: Request, input: Record<string, unknown>) {
  const auth = await authorize(request), space = spaceParam(input.space);
  if (typeof input.projectId !== "string" || typeof input.turnId !== "string")
    throw new CloudError(400, "preview_scope_required", "화면을 열 프로젝트를 선택해주세요.");
  const { data } = await loadSpace(auth, space);
  const project = data.projects.find(p => p.space === space && p.id === input.projectId);
  const turn = project?.automation?.turns.find(t => t.id === input.turnId);
  const service = data.services.find(s => s.space === space && s.projectId === project?.id && s.id === turn?.serviceId);
  const preview = turn?.result?.preview;
  const latest = project && turn && currentPreviewTurn(project, turn.serviceId, turn.repository);
  if (!project || !turn || !service || repositoryFor(service) !== turn.repository || turn.status !== "completed" ||
    latest?.id !== turn.id || preview?.kind !== "remote" || preview.state !== "ready" || !preview.remoteId || !previewOrigin(preview.url))
    throw new CloudError(404, "preview_unavailable", "현재 프로젝트의 미리보기를 다시 준비해주세요.");
  if (!preview.expiresAt || Date.parse(preview.expiresAt) <= Date.now())
    throw new CloudError(410, "preview_expired", "미리보기 시간이 만료됐습니다. 프로젝트에서 화면 준비를 다시 눌러주세요.");
  return { auth, project, turn, preview, space };
}

export function viewerTicket(context: Awaited<ReturnType<typeof authorizedPreview>>, embed = false) {
  const { auth, project, turn, preview, space } = context;
  return issuePreviewTicket(previewSigningKey(), {
    iss: process.env.JARVIS_APP_ORIGIN,
    aud: preview.remoteId, origin: previewOrigin(preview.url), sub: auth.deviceId,
    space, projectId: project.id, turnId: turn.id, sha: preview.sha, ...(embed ? { embed: true } : {}),
  });
}
