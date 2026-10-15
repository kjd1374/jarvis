// Privileged maintenance only; never imported by the web app. Approve only the
// request number confirmed by the user in the current trusted task.
import { pathToFileURL } from "node:url";
export function projectRef(raw) {
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !["", "/"].includes(url.pathname) ||
    url.search ||
    url.hash ||
    !/^[a-z0-9]{20}\.supabase\.co$/.test(url.hostname)
  )
    throw new Error("Use the existing Supabase project's public HTTPS URL.");
  return url.hostname.split(".")[0];
}
export function deviceQuery(action, code) {
  if (action === "--list")
    return "select request_code, created_at, approved_at, revoked_at from public.jarvis_devices order by created_at desc limit 20";
  if (
    action !== "--approve" ||
    typeof code !== "string" ||
    !/^[A-F0-9]{12}$/.test(code)
  )
    throw new Error(
      "Approve requires the exact 12-character device request number confirmed by the user.",
    );
  return `update public.jarvis_devices set approved_at=now() where request_code='${code}' and approved_at is null and revoked_at is null and created_at > now()-interval '24 hours' returning request_code, approved_at`;
}
export async function run(args, env = process.env, transport = fetch) {
  if (args[0] === "--help")
    return {
      usage:
        "node --use-env-proxy --env-file=.env.local scripts/devices.mjs --list | --approve REQUEST_NUMBER",
    };
  const query = deviceQuery(args[0], args[1]);
  const ref = projectRef(env.NEXT_PUBLIC_SUPABASE_URL);
  if (!env.SUPABASE_ACCESS_TOKEN)
    throw new Error(
      "SUPABASE_ACCESS_TOKEN must be supplied through secure environment settings.",
    );
  const response = await transport(
    `https://api.supabase.com/v1/projects/${ref}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    },
  );
  if (!response.ok)
    throw new Error(
      `Device maintenance failed (HTTP ${response.status}); no response body or credentials were logged.`,
    );
  const rows = await response.json();
  if (!Array.isArray(rows) || (args[0] === "--approve" && rows.length !== 1))
    throw new Error(
      "No single pending, unrevoked device within 24 hours matched. Recheck its status; no other device was approved.",
    );
  return rows.map(({ request_code, created_at, approved_at, revoked_at }) => ({
    request_code,
    created_at,
    approved_at,
    revoked_at,
  }));
}
if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  try {
    console.log(JSON.stringify(await run(process.argv.slice(2))));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
