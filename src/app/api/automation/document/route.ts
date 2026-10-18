import { checkOrigin, CloudError, failure, readJson, reply, spaceParam } from "@/lib/cloud/server";
import { changeWorkspace } from "@/lib/automation/server";
import { reportDocumentQuestion } from "@/lib/sheets/questions";
import { refreshAutomaticRunner } from "@/lib/automation/runner-status";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const body = await readJson(request), space = spaceParam(body.space), stamp = new Date().toISOString();
    return reply(await changeWorkspace(request, space, (data, deviceId) => {
      try {
        const next = reportDocumentQuestion(data, space, body, deviceId, stamp);
        const document = next.documents.find(d => d.space === space && d.id === body.documentId);
        const service = document && next.services.find(s => s.space === space && s.projectId === document.projectId && s.monitoring?.runnerConnection);
        return { data: body.phase === "heartbeat" ? refreshAutomaticRunner(next, space, service?.id, stamp) : next, result: { accepted: true } };
      }
      catch (error) {
        if (error instanceof Error && error.message === "stale_job") throw new CloudError(409, "stale_job", "문답이 취소·만료되었거나 다른 실행기에 속합니다.");
        throw new CloudError(400, "invalid_document_result", "문답 결과의 범위·형식을 확인하지 못했습니다.");
      }
    }));
  } catch (error) { return failure(error); }
}
