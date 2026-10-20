import { id, now, type Document, type Project } from "../workspace/types";
import type { WorkImage } from "../automation/work-types";
export type ProjectImage = { document: Document; image: WorkImage; blob: Blob };
// Decode and re-encode screenshots: bound pixels/bytes and discard image metadata.
export async function prepareProjectImage(file: File, project: Project): Promise<ProjectImage> {
  if (!file.type.startsWith("image/") || file.size > 20 * 1024 * 1024) throw new Error("사진은 한 장당 20 MB까지 선택할 수 있습니다.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    if (!image.width || !image.height || image.width * image.height > 50_000_000) throw new Error("사진 크기를 확인해주세요.");
    const scale = Math.min(1, 1600 / Math.max(image.width, image.height)), canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d"); if (!context) throw new Error("사진을 준비하지 못했습니다.");
    context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("사진 변환 실패")), "image/jpeg", 0.82));
    if (blob.size > 1_000_000) throw new Error("사진을 작게 잘라 다시 첨부해주세요. 전송용 사진은 1 MB까지 지원합니다.");
    const fileId = id(), bytes = await blob.arrayBuffer();
    const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), value => value.toString(16).padStart(2, "0")).join("");
    return { blob, image: { id: fileId, sha256 }, document: { id: fileId, space: project.space, projectId: project.id, taskId: null, name: file.name.replace(/\.[^.]+$/, "").slice(0, 160) + ".jpg", mime: blob.type, size: blob.size, createdAt: now() } };
  } finally { URL.revokeObjectURL(url); }
}
