import { authorize, failure, loadSpace, readJson, reply, spaceParam } from "@/lib/cloud/server";
import { saveProvider } from "@/lib/automation/providers";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try { const space = spaceParam(new URL(request.url).searchParams.get("space")); const { data } = await loadSpace(await authorize(request), space);
    return reply({ connections: Object.fromEntries(Object.entries(data.providerConnections?.[space] ?? {}).map(([k, v]) => [k, { label: v.label, updatedAt: v.updatedAt }])) });
  } catch (e) { return failure(e); }
}
export async function POST(request: Request) {
  try { const body = await readJson(request); return reply(await saveProvider(request, spaceParam(body.space), body)); } catch (e) { return failure(e); }
}
