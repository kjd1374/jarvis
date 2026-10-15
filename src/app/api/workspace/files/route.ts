import { createHash } from "node:crypto";
import {
  authorize,
  boundedBody,
  checkOrigin,
  failure,
  loadSpace,
  reply,
  readJson,
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
    if (new URL(request.url).searchParams.get("transfer") === "download") {
      const signed = await auth.client.storage
        .from("jarvis-workspace-files")
        .createSignedUrl(auth.path, 60);
      if (signed.error || !signed.data)
        throw new CloudError(
          404,
          "blob_missing",
          "서버 파일 원본을 찾지 못했습니다.",
        );
      return reply({ url: signed.data.signedUrl });
    }
    if (auth.record.size > 4 * 1024 * 1024)
      throw new CloudError(
        413,
        "direct_transfer_required",
        "큰 파일은 비공개 직접 다운로드를 사용해주세요.",
      );
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
    if (Number(request.headers.get("content-length") ?? 0) > 4 * 1024 * 1024)
      throw new CloudError(
        413,
        "too_large",
        "큰 파일은 비공개 직접 전송을 사용해주세요.",
      );
    const data = Buffer.from(await boundedBody(request, 4 * 1024 * 1024));
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

// Only small authorization/verification messages pass through Vercel. Original
// bytes travel directly to the existing private bucket, avoiding its 4.5 MB
// function payload limit while retaining the application's 20 MB file limit.
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const auth = await target(request);
    const body = await readJson(request);
    if (
      !["upload", "verify"].includes(String(body.action)) ||
      typeof body.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(body.sha256)
    )
      throw new CloudError(
        400,
        "invalid_file",
        "파일 원본 확인 정보를 확인해주세요.",
      );
    if (auth.record.size > 20 * 1024 * 1024)
      throw new CloudError(
        413,
        "too_large",
        "파일당 20 MB까지 보관할 수 있습니다.",
      );
    const bucket = auth.client.storage.from("jarvis-workspace-files");
    const existing = await bucket.download(auth.path);
    if (existing.data) {
      const bytes = Buffer.from(await existing.data.arrayBuffer());
      if (
        bytes.length !== auth.record.size ||
        createHash("sha256").update(bytes).digest("hex") !== body.sha256
      )
        throw new CloudError(
          409,
          "file_conflict",
          "같은 ID의 다른 파일이 있습니다. 기존 원본은 덮어쓰지 않았습니다.",
        );
      return reply({ stored: true });
    }
    if (body.action === "verify")
      throw new CloudError(
        503,
        "file_pending",
        "파일 원본 전송을 확인하지 못했습니다. 이 기기의 원본은 유지됩니다.",
      );
    const signed = await bucket.createSignedUploadUrl(auth.path, {
      upsert: false,
    });
    if (signed.error || !signed.data)
      throw new CloudError(
        503,
        "file_pending",
        "비공개 파일 전송을 준비하지 못했습니다.",
      );
    return reply({
      stored: false,
      path: signed.data.path,
      token: signed.data.token,
      mime: auth.record.mime,
    });
  } catch (error) {
    return failure(error);
  }
}
