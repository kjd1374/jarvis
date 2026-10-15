import {
  authorize,
  checkOrigin,
  failure,
  loadSpace,
  readJson,
  reply,
  spaceParam,
  CloudError,
} from "@/lib/cloud/server";
import { buildGrounding } from "@/lib/workspace/search";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const body = await readJson(request);
    const space = spaceParam(body.space);
    if (typeof body.question !== "string" || body.question.length > 1000)
      throw new CloudError(
        400,
        "invalid_question",
        "질문을 1000자 이내로 입력해주세요.",
      );
    const auth = await authorize(request);
    const snapshot = await loadSpace(auth, space);
    const grounding = buildGrounding(snapshot.data, {
      space,
      projectId:
        typeof body.projectId === "string" ? body.projectId : undefined,
      query: body.question,
    });
    return reply(
      {
        ...grounding,
        code: "ai_not_connected",
        error:
          "실제 AI 모델 연결이 필요합니다. 근거 자료만 조회했으며 답변이나 실행 결과를 생성하지 않았습니다.",
      },
      501,
    );
  } catch (error) {
    return failure(error);
  }
}
