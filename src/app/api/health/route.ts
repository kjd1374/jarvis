export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    status: "ok",
    service: "jarvis",
    supabaseConfigured: Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    ),
  });
}
