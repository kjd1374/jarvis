import { createHash } from "node:crypto";
import {
  authorize,
  boundedBody,
  checkOrigin,
  failure,
  loadSpace,
  reply,
  spaceParam,
  CloudError,
} from "@/lib/cloud/server";
export const runtime = "nodejs";
async function target(request: Request) {
  const url = new URL(request.url);
  const space = spaceParam(url.searchParams.get("space"));
  const id = url.searchParams.get("id");
  if (!id || !/^[\w-]{1,200}$/.test(id))
    throw new CloudError(400, "invalid_file", "파일 ID를 확인해주세요.");
  const auth = await authorize(request);
  const snapshot = await loadSpace(auth, space);
  const record = snapshot.data.documents.find(
    (d) => d.id === id && d.space === space,
  );
  if (!record || record.sourceUrl)
    throw new CloudError(
      404,
      "file_missing",
      "이 영역에 보관한 파일을 찾을 수 없습니다.",
    );
  return { ...auth, record, path: `${auth.ownerId}/${space}/${id}` };
}
export async function GET(request: Request) {
  try {
    const auth = await target(request);
    const { data, error } = await auth.client.storage
      .from("jarvis-workspace-files")
      .download(auth.path);
    if (error || !data)
      throw new CloudError(
        404,
        "blob_missing",
        "서버에 파일 원본이 없습니다. 원래 브라우저에서 파일 내보내기·서버 업로드를 확인해주세요.",
      );
    return new Response(data, {
      headers: {
        "Content-Type": data.type || "application/octet-stream",
        "Cache-Control": "private, no-store",
        Vary: "Cookie, Authorization",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
export async function PUT(request: Request) {
  try {
    checkOrigin(request);
    const auth = await target(request);
    if (Number(request.headers.get("content-length") ?? 0) > 20 * 1024 * 1024)
      throw new CloudError(
        413,
        "too_large",
        "파일당 20 MB까지 보관할 수 있습니다.",
      );
    const data = Buffer.from(await boundedBody(request, 20 * 1024 * 1024));
    if (data.length !== auth.record.size)
      throw new CloudError(
        400,
        "file_size_mismatch",
        "파일 크기가 저장 정보와 다릅니다.",
      );
    const result = await auth.client.storage
      .from("jarvis-workspace-files")
      .upload(auth.path, data, {
        contentType: auth.record.mime || "application/octet-stream",
        upsert: false,
      });
    if (result.error) {
      const existing = await auth.client.storage
        .from("jarvis-workspace-files")
        .download(auth.path);
      if (
        !existing.data ||
        createHash("sha256")
          .update(Buffer.from(await existing.data.arrayBuffer()))
          .digest("hex") !== createHash("sha256").update(data).digest("hex")
      )
        throw new CloudError(
          409,
          "file_conflict",
          "같은 ID의 다른 파일이 있거나 업로드하지 못했습니다. 기존 원본은 덮어쓰지 않았습니다.",
        );
    }
    return reply({ stored: true });
  } catch (error) {
    return failure(error);
  }
}
