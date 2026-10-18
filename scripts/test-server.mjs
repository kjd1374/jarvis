// Build only application sources in a disposable directory: never copy .env*,
// .vercel, uploads, credentials, or a developer's browser profile.
import { cp, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";

const root = resolve(import.meta.dirname, "..");
const app = await mkdtemp(join(tmpdir(), "jarvis-e2e-"));
await mkdir(join(root, "test-results"), { recursive: true });
const log = createWriteStream(join(root, "test-results/server.log"));
const env = {
  PATH: process.env.PATH,
  SystemRoot: process.env.SystemRoot,
  TMPDIR: tmpdir(),
  NODE_ENV: "production",
  NEXT_TELEMETRY_DISABLED: "1",
  NEXT_PUBLIC_SUPABASE_URL: "",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
};
if (process.argv.includes("--local-cloud")) {
  const testUrl = process.env.JARVIS_TEST_SUPABASE_URL;
  if (
    testUrl !== "http://127.0.0.1:54321" ||
    !process.env.JARVIS_TEST_SUPABASE_KEY
  )
    throw new Error(
      "Cloud tests require the dedicated local Supabase endpoint",
    );
  env.NEXT_PUBLIC_SUPABASE_URL = testUrl;
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
    process.env.JARVIS_TEST_SUPABASE_KEY;
  env.JARVIS_CLOUD_STORAGE_ENABLED = "true";
  env.JARVIS_APP_ORIGIN = "http://127.0.0.1:4317";
  env.JARVIS_PREVIEW_SIGNING_KEY = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
}
let child;
let closing = false;
async function cleanup(code = 0) {
  if (closing) return;
  closing = true;
  if (child && child.exitCode === null && child.signalCode === null) {
    await new Promise((resolve) => {
      child.once("close", resolve);
      child.kill("SIGTERM");
    });
  }
  await rm(app, { recursive: true, force: true });
  await new Promise((resolve) => log.end(resolve));
  process.exit(code);
}
process.on("SIGTERM", () => void cleanup());
process.on("SIGINT", () => void cleanup());
async function run(args) {
  return new Promise((resolve, reject) => {
    child = spawn(
      process.execPath,
      [join(root, "node_modules/next/dist/bin/next"), ...args],
      {
        cwd: app,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    for (const stream of [child.stdout, child.stderr]) {
      stream.on("data", (chunk) => {
        log.write(chunk);
        process.stdout.write(chunk);
      });
    }
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`Test server exited: ${code}`)),
    );
  });
}
try {
  for (const file of [
    "src",
    "public",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "next.config.ts",
  ]) {
    await cp(join(root, file), join(app, file), { recursive: true });
  }
  await symlink(
    join(root, "node_modules"),
    join(app, "node_modules"),
    "junction",
  );
  // Webpack supports the shared dependency symlink outside this temporary app.
  await run(["build", "--webpack"]);
  await run(["start", "--hostname", "127.0.0.1", "--port", "4317"]);
  await cleanup();
} catch (error) {
  if (!closing) {
    console.error(error);
    await cleanup(1);
  }
}
