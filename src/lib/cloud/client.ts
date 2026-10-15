import type { Space, WorkspaceData } from "../workspace/types";
import { scopeWorkspace } from "../workspace/transfer";
import { getSupabaseConfig } from "../supabase/config";
async function json(response: Response) {
  const body = await response.json();
  if (!response.ok)
    throw new CloudRequestError(
      response.status,
      body.code,
      body.error ?? "서버 연결을 확인해주세요.",
    );
  return body;
}
export class CloudRequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export type AccountStatus = {
  enabled: boolean;
  configured: boolean;
  authenticated: boolean;
  accountId?: string;
  deviceId?: string;
  pairingCode?: string;
};
export async function accountStatus(): Promise<AccountStatus> {
  return json(await fetch("/api/account", { cache: "no-store" }));
}
export async function accountAction(
  action: "device" | "logout",
  body: Record<string, string> = {},
) {
  return json(
    await fetch(`/api/account/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
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
    `/api/workspace/files?space=${space}&id=${encodeURIComponent(id)}&transfer=download`,
    { cache: "no-store" },
  );
  const signed = await json(response);
  if (new URL(signed.url).origin !== new URL(getSupabaseConfig().url).origin)
    throw new Error("파일 저장소 주소가 일치하지 않습니다.");
  const original = await fetch(signed.url, { cache: "no-store" });
  if (!original.ok)
    throw new Error("서버 원본을 내려받지 못했습니다. 다시 시도해주세요.");
  return original.blob();
}
export async function uploadCloudFile(space: Space, id: string, blob: Blob) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await blob.arrayBuffer(),
  );
  const sha256 = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const endpoint = `/api/workspace/files?space=${space}&id=${encodeURIComponent(id)}`;
  const authorize = (action: "upload" | "verify") =>
    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, sha256 }),
    }).then(json);
  const signed = await authorize("upload");
  if (signed.stored) return signed;
  const { createClient } = await import("@supabase/supabase-js");
  const config = getSupabaseConfig();
  const client = createClient(config.url, config.publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  await client.storage
    .from("jarvis-workspace-files")
    .uploadToSignedUrl(signed.path, signed.token, blob, {
      contentType: signed.mime,
      upsert: false,
    });
  // Verify the actual bytes even if only the upload acknowledgement was lost.
  // Temporary signed capabilities stay in memory, never in workspace records.
  return authorize("verify");
}
