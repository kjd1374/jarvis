import { checkOrigin, CloudError, failure, readJson, reply, spaceParam } from "@/lib/cloud/server";
import { authorize, loadSpace } from "@/lib/cloud/server";
import { createHash } from "node:crypto";
import { changeWorkspace } from "@/lib/automation/server";
import { reportProjectWork, requireWorkLease, validateWorkImages } from "@/lib/automation/work";
import { refreshAutomaticRunner } from "@/lib/automation/runner-status";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const body = await readJson(request), space = spaceParam(body.space), stamp = new Date().toISOString();
    if (body.phase === "images") {
      const auth = await authorize(request), { data } = await loadSpace(auth, space);
      const { turn, project } = requireWorkLease(data, space, body, auth.deviceId, stamp);
      validateWorkImages(data, space, project.id, turn.images ?? []);
      const images = [];
      for (const image of turn.images ?? []) {
        const doc = data.documents.find(d => d.id === image.id)!;
        const stored = await auth.client.storage.from("jarvis-workspace-files").download(`${auth.ownerId}/${space}/${image.id}`);
        if (!stored.data) throw new CloudError(409, "work_image_pending", "사진 원본 전송을 기다리고 있습니다.");
        const bytes = Buffer.from(await stored.data.arrayBuffer());
        const valid = doc.mime === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : doc.mime === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
        if (!valid || bytes.length !== doc.size || createHash("sha256").update(bytes).digest("hex") !== image.sha256) throw new CloudError(409, "work_image_changed", "요청에 첨부한 사진 원본을 확인하지 못했습니다.");
        images.push({ ...image, mime: doc.mime, bytes: bytes.toString("base64") });
      }
      return reply({ images });
    }
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
