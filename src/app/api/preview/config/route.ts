import { authorize, failure, reply } from "@/lib/cloud/server";
import { previewPublicKey } from "@/lib/preview/server";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try { await authorize(request); return reply({ publicKey: previewPublicKey(), version: 1 }); }
  catch (error) { return failure(error); }
}
