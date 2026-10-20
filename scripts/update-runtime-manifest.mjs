import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { VERSION } from "../public/jarvis-runner.mjs";
const files = {};
for (const name of ["jarvis-runner.mjs", "jarvis-preview.mjs", "jarvis-development.mjs", "jarvis-stream-transport.mjs", "jarvis-remote-preview.mjs", "jarvis-preview-auth.mjs", "jarvis-preview-cli.mjs", "jarvis-provision.mjs", "jarvis-supervisor.mjs", "jarvis-mac.mjs"]) {
  files[name] = createHash("sha256").update(await readFile(new URL(`../public/${name}`, import.meta.url))).digest("hex");
}
await writeFile(new URL("../public/jarvis-runtime.json", import.meta.url), JSON.stringify({ version: VERSION, files }, null, 2) + "\n");
