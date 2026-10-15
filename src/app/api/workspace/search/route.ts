import {
  authorize,
  failure,
  loadSpace,
  reply,
  spaceParam,
} from "@/lib/cloud/server";
import { buildGrounding } from "@/lib/workspace/search";
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const space = spaceParam(url.searchParams.get("space"));
    const auth = await authorize(request);
    const result = await loadSpace(auth, space);
    return reply(
      buildGrounding(result.data, {
        space,
        projectId: url.searchParams.get("projectId") ?? undefined,
        query: (url.searchParams.get("q") ?? "").slice(0, 1000),
      }),
    );
  } catch (error) {
    return failure(error);
  }
}
