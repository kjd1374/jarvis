import "server-only";
import { createClient as supabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import {
  normalizeWorkspace,
  validSpace,
  collections,
} from "@/lib/workspace/validation";
import { scopeWorkspace } from "@/lib/workspace/transfer";
import {
  emptyWorkspace,
  type Space,
  type WorkspaceData,
} from "@/lib/workspace/types";

export class CloudError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function cloudEnabled() {
  return process.env.JARVIS_CLOUD_STORAGE_ENABLED === "true";
}
export function reply(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      Vary: "Cookie, Authorization",
    },
  });
}
export function failure(error: unknown) {
  return error instanceof CloudError
    ? reply({ error: error.message, code: error.code }, error.status)
    : reply(
        {
          error: "서버 저장을 처리하지 못했습니다. 기존 자료는 유지됩니다.",
          code: "storage_unavailable",
        },
        503,
      );
}
export function spaceParam(value: unknown): Space {
  if (!validSpace(value))
    throw new CloudError(
      400,
      "scope_required",
      "회사 또는 개인 영역을 명시해주세요.",
    );
  return value;
}
export async function boundedBody(
  request: Request,
  limit: number,
): Promise<Uint8Array> {
  if (Number(request.headers.get("content-length") ?? 0) > limit)
    throw new CloudError(
      413,
      "too_large",
      "요청 크기가 허용 범위를 초과했습니다.",
    );
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new CloudError(
          413,
          "too_large",
          "요청 크기가 허용 범위를 초과했습니다.",
        );
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}
export async function readJson(
  request: Request,
): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new CloudError(415, "json_required", "JSON 요청이 필요합니다.");
  if (Number(request.headers.get("content-length") ?? 0) > 4_000_000)
    throw new CloudError(413, "too_large", "메타데이터가 너무 큽니다.");
  const text = new TextDecoder().decode(await boundedBody(request, 4_000_000));
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error();
    return body;
  } catch {
    throw new CloudError(400, "invalid_json", "요청 형식이 올바르지 않습니다.");
  }
}
export function checkOrigin(request: Request, allowBearer = true) {
  if (
    allowBearer &&
    request.headers.get("authorization")?.startsWith("Bearer ")
  )
    return;
  const origin = request.headers.get("origin");
  const expectedOrigin =
    process.env.JARVIS_APP_ORIGIN || new URL(request.url).origin;
  if (!origin || origin !== expectedOrigin)
    throw new CloudError(403, "origin_denied", "같은 앱에서 요청해주세요.");
}
export async function authorize(request: Request) {
  if (!cloudEnabled())
    throw new CloudError(
      503,
      "cloud_disabled",
      "서버 저장은 운영 스키마와 계정 연결 승인 후 활성화할 수 있습니다.",
    );
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  )
    throw new CloudError(
      503,
      "cloud_unconfigured",
      "서버 저장 설정이 필요합니다.",
    );
  const bearer = request.headers.get("authorization");
  const client = bearer?.startsWith("Bearer ")
    ? supabaseClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
        {
          global: { headers: { Authorization: bearer } },
          auth: { persistSession: false, autoRefreshToken: false },
        },
      )
    : await createClient();
  const { data, error } = await client.auth.getUser(
    bearer?.startsWith("Bearer ") ? bearer.slice(7) : undefined,
  );
  if (error || !data.user)
    throw new CloudError(
      401,
      "authentication_required",
      "이 기기의 서버 연결이 필요합니다. 설정에서 기기 확인을 진행해주세요.",
    );
  const { data: device, error: deviceError } = await client.rpc(
    "jarvis_device_status",
  );
  if (deviceError || !device?.owner_id)
    throw new CloudError(
      403,
      "device_required",
      "이 브라우저를 내 기기로 확인해야 서버 기록에 접근할 수 있습니다.",
    );
  return { client, ownerId: device.owner_id as string, deviceId: data.user.id };
}
export function scopedPayload(input: unknown, space: Space): WorkspaceData {
  let value: WorkspaceData;
  try {
    value = normalizeWorkspace(input);
  } catch (error) {
    throw new CloudError(
      400,
      "invalid_payload",
      error instanceof Error ? error.message : "기록 형식 오류",
    );
  }
  if (value.activeSpace !== space)
    throw new CloudError(400, "mixed_scope", "영역이 일치하지 않습니다.");
  if (Object.keys(value.providerConnections ?? {}).some(key => key !== space)) throw new CloudError(400, "mixed_scope", "다른 영역의 서비스 연결을 함께 저장할 수 없습니다.");
  for (const key of collections)
    for (const row of value[key])
      if ("space" in row && row.space !== space)
        throw new CloudError(
          400,
          "mixed_scope",
          "다른 영역의 자료를 함께 저장할 수 없습니다.",
        );
  return scopeWorkspace(value, space);
}
export async function loadSpace(
  auth: Awaited<ReturnType<typeof authorize>>,
  space: Space,
) {
  const { data, error } = await auth.client
    .from("jarvis_spaces")
    .select("data,revision,updated_at")
    .eq("owner_id", auth.ownerId)
    .eq("space", space)
    .maybeSingle();
  if (error)
    throw new CloudError(
      503,
      "schema_unavailable",
      "서버 저장 테이블에 접근하지 못했습니다. 로컬 자료는 유지됩니다.",
    );
  if (!data) {
    const empty = emptyWorkspace();
    empty.activeSpace = space;
    return { data: empty, revision: 0, updatedAt: null };
  }
  return {
    data: scopedPayload(data.data, space),
    revision: Number(data.revision),
    updatedAt: data.updated_at as string,
  };
}
export async function saveSpace(
  auth: Awaited<ReturnType<typeof authorize>>,
  space: Space,
  value: WorkspaceData,
  revision: number,
) {
  const { data, error } = await auth.client.rpc("jarvis_save_space", {
    p_space: space,
    p_data: scopedPayload(value, space),
    p_expected_revision: revision,
  });
  if (error) {
    if (error.message.includes("revision_conflict"))
      throw new CloudError(
        409,
        "revision_conflict",
        "다른 기기에서 자료가 변경되었습니다. 서버 자료를 먼저 확인하고 병합해주세요.",
      );
    throw new CloudError(
      503,
      "save_failed",
      "서버에 저장하지 못했습니다. 이 기기의 기록은 유지됩니다.",
    );
  }
  return Number(data);
}
