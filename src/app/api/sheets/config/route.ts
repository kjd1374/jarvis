import { authorize, failure, reply } from "@/lib/cloud/server";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    await authorize(request);
    // These three identifiers are intentionally public. No OAuth client secret is used.
    const clientId = process.env.GOOGLE_CLIENT_ID ?? "";
    const apiKey = process.env.GOOGLE_BROWSER_API_KEY ?? "";
    const projectNumber = process.env.GOOGLE_PROJECT_NUMBER ?? "";
    const configured = /^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId) && /^AIza[a-zA-Z0-9_-]+$/.test(apiKey) && /^[0-9]+$/.test(projectNumber);
    return reply(configured ? { configured, clientId, apiKey, projectNumber } : { configured: false });
  } catch (error) { return failure(error); }
}
