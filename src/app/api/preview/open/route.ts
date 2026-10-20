import { randomBytes } from "node:crypto";
import { boundedBody, CloudError } from "@/lib/cloud/server";
import { authorizedPreview, viewerTicket } from "@/lib/preview/server";

export const runtime = "nodejs";
const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
function page(body: string, status: number, policy: string, embed = false) {
  return new Response(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Jarvis 미리보기</title><style>body{background:#111;color:#eee;font:16px/1.7 system-ui,sans-serif;max-width:38rem;margin:12vh auto;padding:24px}h1{font-size:24px}a{color:#8ec8ff}button{background:#2563eb;color:white;border:0;border-radius:8px;padding:12px 20px;font:inherit;cursor:pointer}</style><body>${body}</body></html>`, {
    // A no-referrer policy turns a cross-origin form POST's Origin into null.
    // Send only the application origin, never the project URL or ticket.
    status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "Referrer-Policy": "strict-origin",
      "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors ${embed ? "'self'" : "'none'"}; ${policy}`, "X-Content-Type-Options": "nosniff" },
  });
}
export async function GET(request: Request) {
  try {
    const context = await authorizedPreview(request, Object.fromEntries(new URL(request.url).searchParams));
    // This is a fixed HTTPS suffix, with no redirects or arbitrary host fetching.
    const response = await fetch(`${context.preview.url}_jarvis/health`, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(7000) });
    const health = new TextDecoder().decode(await boundedBody(new Request("https://health.invalid", { method: "POST", body: response.body, duplex: "half" } as RequestInit), 1024));
    if (!response.ok || health !== context.preview.remoteId) throw new Error("preview_offline");
    const embed = new URL(request.url).searchParams.get("embed") === "1";
    const token = viewerTicket(context, embed), nonce = randomBytes(18).toString("base64"), action = `${context.preview.url}_jarvis/open`;
    return page(`<p>승인된 기기를 확인했습니다. 미리보기를 여는 중입니다.</p><form method="post" action="${escape(action)}"><input type="hidden" name="ticket" value="${escape(token)}"><button type="submit">화면 열기</button></form><script nonce="${nonce}">document.forms[0].submit()</script>`, 200,
      `script-src 'nonce-${nonce}'; form-action ${new URL(action).origin};`, embed);
  } catch (error) {
    const message = error instanceof CloudError ? error.message : "맥미니 미리보기에 연결하지 못했습니다. 맥미니와 실행기를 켜고 프로젝트에서 화면 준비를 다시 눌러주세요.";
    return page(`<h1>미리보기를 열 수 없습니다</h1><p>${escape(message)}</p><a href="/projects">프로젝트로 돌아가기</a>`, error instanceof CloudError ? error.status : 503, "form-action 'none';");
  }
}
