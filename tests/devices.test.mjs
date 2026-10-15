import assert from "node:assert/strict";
import test from "node:test";
import { deviceQuery, projectRef, run } from "../scripts/devices.mjs";
test("only the configured public Supabase HTTPS origin is accepted", () => {
  assert.equal(
    projectRef("https://abcdefghijklmnopqrst.supabase.co"),
    "abcdefghijklmnopqrst",
  );
  for (const url of [
    "http://abcdefghijklmnopqrst.supabase.co",
    "https://user:pass@abcdefghijklmnopqrst.supabase.co",
    "https://abcdefghijklmnopqrst.supabase.co.evil.test",
    "https://abcdefghijklmnopqrst.supabase.co/path",
    "https://abcdefghijklmnopqrst.supabase.co?token=x",
  ])
    assert.throws(() => projectRef(url));
});
test("approval cannot interpolate SQL, approve an unspecified device or reactivate a revoked request", () => {
  for (const value of [undefined, "", "abcdefabcdef", "ABC';delete from x;--"])
    assert.throws(() => deviceQuery("--approve", value));
  const query = deviceQuery("--approve", "ABCDEF123456");
  assert.match(query, /request_code='ABCDEF123456'/);
  assert.match(query, /revoked_at is null/);
  assert.match(query, /24 hours/);
  assert.match(query, /approved_at is null/);
});
test("missing credentials stop before network access and failed responses never expose bodies", async () => {
  let calls = 0;
  await assert.rejects(
    run(
      ["--list"],
      { NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co" },
      () => {
        calls++;
      },
    ),
    /secure environment/,
  );
  assert.equal(calls, 0);
  await assert.rejects(
    run(
      ["--list"],
      {
        NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
        SUPABASE_ACCESS_TOKEN: "synthetic-placeholder",
      },
      async () => ({
        ok: false,
        status: 403,
        json: () => {
          throw new Error("Must not read private response");
        },
      }),
    ),
    /HTTP 403/,
  );
});
test("approval reports only one exact pending request and refuses no-match outcomes", async () => {
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    SUPABASE_ACCESS_TOKEN: "synthetic-placeholder",
  };
  await assert.rejects(
    run(["--approve", "ABCDEF123456"], env, async () => ({
      ok: true,
      json: async () => [],
    })),
    /No single pending/,
  );
  const rows = await run(["--approve", "ABCDEF123456"], env, async () => ({
    ok: true,
    json: async () => [
      {
        request_code: "ABCDEF123456",
        approved_at: "2026-10-15T00:00:00Z",
        private_field: "synthetic must not be returned",
      },
    ],
  }));
  assert.equal(rows[0].request_code, "ABCDEF123456");
  assert.equal("private_field" in rows[0], false);
});
