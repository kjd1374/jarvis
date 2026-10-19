import "server-only";
import { openProvider, sealProvider } from "./provider-vault.mjs";
import { authorize, checkOrigin, CloudError, loadSpace, saveSpace } from "../cloud/server";
import type { Space, WorkspaceData } from "../workspace/types";
export type ProviderConnection = { sealed: string; label: string; updatedAt: string };
export type ProviderConnections = Partial<Record<Space, Partial<Record<"vercel" | "supabase", ProviderConnection>>>>;
export function credentialsFor(data: WorkspaceData, ownerId: string, space: Space) {
  const connections = data.providerConnections?.[space];
  return Object.fromEntries(Object.entries(connections ?? {}).map(([provider, record]) => [provider, openProvider(record.sealed, process.env.JARVIS_PREVIEW_SIGNING_KEY, ownerId, space, provider)]));
}
export async function saveProvider(request: Request, space: Space, body: Record<string, unknown>) {
  checkOrigin(request);
  const auth = await authorize(request);
  const provider = body.provider;
  if (provider !== "vercel" && provider !== "supabase") throw new CloudError(400, "invalid_provider", "연결할 서비스를 선택해주세요.");
  let connection: ProviderConnection | undefined;
  if (body.action !== "disconnect") {
    if (typeof body.token !== "string" || body.token.length < 16 || body.token.length > 2000 || /\s/.test(body.token)) throw new CloudError(400, "invalid_provider_credential", "서비스의 접근 토큰을 입력해주세요.");
    let organization = typeof body.organization === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(body.organization) ? body.organization : undefined;
    const path = provider === "vercel" ? organization ? `/v2/teams/${organization}` : "/v2/user" : "/v1/organizations";
    const response = await fetch((provider === "vercel" ? "https://api.vercel.com" : "https://api.supabase.com") + path, { headers: { Authorization: `Bearer ${body.token}` }, redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new CloudError(400, "provider_auth_failed", "서비스 접근 권한을 확인하지 못했습니다. 토큰과 조직을 확인해주세요.");
    let account = await response.json();
    if (provider === "vercel" && !organization && account.user?.defaultTeamId && account.user?.billing?.plan !== "hobby") {
      organization = account.user.defaultTeamId;
      if (typeof organization !== "string" || !/^team_[a-zA-Z0-9]+$/.test(organization)) throw new CloudError(400, "provider_plan_required", "Vercel 팀 ID를 확인해주세요.");
      const team = await fetch(`https://api.vercel.com/v2/teams/${organization}`, { headers: { Authorization: `Bearer ${body.token}` }, redirect: "error", signal: AbortSignal.timeout(15_000) });
      if (!team.ok) throw new CloudError(400, "provider_auth_failed", "Vercel 기본 팀의 접근 권한을 확인해주세요.");
      account = await team.json();
    }
    if (provider === "supabase" && (!organization || !Array.isArray(account) || !account.some(o => o.id === organization || o.slug === organization))) throw new CloudError(400, "provider_org_required", "이 계정에서 사용할 Supabase 조직 ID를 입력해주세요.");
    if (provider === "supabase") {
      organization = account.find((o: { id: string; slug?: string }) => o.id === organization || o.slug === organization).slug ?? organization;
      const orgResponse = await fetch(`https://api.supabase.com/v1/organizations/${organization}`, { headers: { Authorization: `Bearer ${body.token}` }, redirect: "error", signal: AbortSignal.timeout(15_000) });
      if (!orgResponse.ok || (await orgResponse.json()).plan !== "free") throw new CloudError(400, "provider_plan_required", "자동 준비에는 무료 Supabase 조직이 필요합니다. 조직의 요금제를 확인해주세요.");
    }
    // Automatic setup may only use the configured free Vercel scope, never a paid team by inference.
    if (provider === "vercel" && (account.team ?? account.user ?? account)?.billing?.plan !== "hobby") throw new CloudError(400, "provider_plan_required", "자동 준비에는 무료 Hobby 범위가 필요합니다. 유료 조직은 자동 연결하지 않습니다.");
    connection = { sealed: sealProvider({ token: body.token, ...(organization ? { organization } : {}) }, process.env.JARVIS_PREVIEW_SIGNING_KEY, auth.ownerId, space, provider), label: provider === "vercel" ? "Vercel 연결됨" : "Supabase 연결됨", updatedAt: new Date().toISOString() };
  }
  for (let i = 0; i < 3; i++) {
    const snapshot = await loadSpace(auth, space), current = { ...snapshot.data.providerConnections?.[space] };
    if (connection) current[provider] = connection; else delete current[provider];
    try { await saveSpace(auth, space, { ...snapshot.data, providerConnections: { [space]: current } }, snapshot.revision); return { connected: !!connection }; }
    catch (e) { if (!(e instanceof CloudError) || e.status !== 409 || i === 2) throw e; }
  }
}
