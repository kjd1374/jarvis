import type { Space, WorkspaceData } from "../workspace/types";
import { scopeWorkspace } from "../workspace/transfer";
async function json(response: Response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "서버 연결을 확인해주세요.");
  return body;
}
export async function cloudStatus() {
  return json(await fetch("/api/workspace/status", { cache: "no-store" }));
}
export async function pullCloud(
  space: Space,
): Promise<{ data: WorkspaceData; revision: number }> {
  return json(
    await fetch(`/api/workspace?space=${space}`, { cache: "no-store" }),
  );
}
export async function pushCloud(
  space: Space,
  data: WorkspaceData,
  revision: number,
): Promise<{ revision: number }> {
  return json(
    await fetch("/api/workspace", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        space,
        revision,
        data: scopeWorkspace(data, space),
      }),
    }),
  );
}
export async function downloadCloudFile(
  space: Space,
  id: string,
): Promise<Blob> {
  const response = await fetch(
    `/api/workspace/files?space=${space}&id=${encodeURIComponent(id)}`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    const result = await response.json();
    throw new Error(result.error ?? "서버 원본을 찾을 수 없습니다.");
  }
  return response.blob();
}
export async function uploadCloudFile(space: Space, id: string, blob: Blob) {
  return json(
    await fetch(
      `/api/workspace/files?space=${space}&id=${encodeURIComponent(id)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: blob,
      },
    ),
  );
}
