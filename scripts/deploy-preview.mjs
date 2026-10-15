// Deploy the current working tree to the existing protected Jarvis preview.
// Uses the official API so cloud proxy-backed credentials work without CLI login.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

export const previewAlias = "jarvis-preview-ai-report.vercel.app";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const statePath = join(root, ".vercel/jarvis-preview.json");
const configFiles = [
  "package.json",
  "package-lock.json",
  "next.config.ts",
  "tsconfig.json",
  "eslint.config.mjs",
  ".node-version",
];
const excludedNames = new Set([
  "uploads",
  "user-data",
  "conversations",
  "browser-profiles",
  "test-results",
  "node_modules",
]);

export async function collectSource(directory) {
  const files = [];
  async function include(path) {
    const info = await lstat(path);
    if (info.isSymbolicLink())
      throw new Error(`Source symlink refused: ${relative(directory, path)}`);
    if (info.isDirectory()) {
      for (const name of (await readdir(path)).sort()) {
        if (name.startsWith(".") || excludedNames.has(name)) continue;
        await include(join(path, name));
      }
    } else if (info.isFile()) {
      const buffer = await readFile(path);
      if (
        /(?:sb_secret_|sbp_|ghp_|vcp_)[A-Za-z0-9_-]{15,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(
          buffer.toString("utf8"),
        )
      )
        throw new Error(
          `Possible credential in source; deployment stopped: ${relative(directory, path)}`,
        );
      files.push({
        file: relative(directory, path).split("\\").join("/"),
        buffer,
      });
    }
  }
  for (const name of configFiles) await include(join(directory, name));
  for (const name of ["src", "public"]) await include(join(directory, name));
  files.sort((a, b) => a.file.localeCompare(b.file, "en"));
  const hash = createHash("sha256");
  for (const file of files)
    hash.update(file.file).update("\0").update(file.buffer).update("\0");
  return {
    files,
    sourceSha256: hash.digest("hex"),
    sourceBytes: files.reduce((sum, file) => sum + file.buffer.length, 0),
  };
}

export function deploymentBody(project, source) {
  if (
    project.name !== "jarvis" ||
    project.link?.type !== "github" ||
    project.link.org !== "kjd1374" ||
    project.link.repo !== "jarvis"
  )
    throw new Error("Unexpected project/repository; refusing deployment");
  // Official API: omitting target with inline files creates a preview. No Git push,
  // gitSource, project setting changes, production target or environment overrides.
  const body = {
    name: project.name,
    project: project.id,
    files: source.files.map(({ file, buffer }) => ({
      file,
      data: buffer.toString("base64"),
      encoding: "base64",
    })),
    meta: {
      jarvisSourceSha256: source.sourceSha256,
      jarvisSourceMode: "working-tree",
    },
  };
  if (Buffer.byteLength(JSON.stringify(body)) > 4_000_000)
    throw new Error(
      "Inline source exceeds 4 MB; use the Vercel file upload workflow",
    );
  return body;
}

export function verifyAliasTarget(alias, projectId, deployment) {
  if (deployment.projectId !== projectId || deployment.target === "production")
    throw new Error(
      "Preview alias must belong to this project's preview, never production",
    );
  if (alias && (alias.alias !== previewAlias || alias.projectId !== projectId))
    throw new Error("Unexpected alias owner/name; refusing alias change");
}

function redact(value) {
  let text = String(value);
  if (process.env.VERCEL_TOKEN)
    text = text.replaceAll(process.env.VERCEL_TOKEN, "[redacted]");
  return text.replace(
    /(?:sb_secret_|sbp_|ghp_|vcp_)[A-Za-z0-9_-]+/g,
    "[redacted]",
  );
}
async function api(teamId, path, method = "GET", body) {
  const url = new URL(path, "https://api.vercel.com");
  if (url.origin !== "https://api.vercel.com")
    throw new Error("Unsupported API origin");
  url.searchParams.set("teamId", teamId);
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.VERCEL_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(45_000),
    redirect: "error",
  });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(
      redact(
        `Vercel HTTP ${response.status}: ${result.error?.code ?? "request_failed"} ${result.error?.message ?? ""}`,
      ).slice(0, 500),
    );
    error.status = response.status;
    throw error;
  }
  return result;
}
async function save(state) {
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify(state, null, 2) + "\n");
}
async function currentAlias(teamId) {
  try {
    return await api(teamId, `/v4/aliases/${previewAlias}`);
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}
async function verifyCurrentAlias(teamId, projectId) {
  const alias = await currentAlias(teamId);
  if (alias) {
    const deployment = await api(
      teamId,
      `/v13/deployments/${alias.deploymentId}`,
    );
    verifyAliasTarget(alias, projectId, deployment);
  }
  return alias;
}
async function run() {
  const flags = new Set(process.argv.slice(2));
  if (
    [...flags].some(
      (flag) => !["--deploy", "--dry-run", "--resume"].includes(flag),
    ) ||
    (flags.has("--dry-run") &&
      (flags.has("--deploy") || flags.has("--resume"))) ||
    (flags.has("--resume") && flags.has("--deploy"))
  )
    throw new Error(
      "Use --dry-run, --deploy, or --resume; production deployment is not supported",
    );
  if (!flags.has("--deploy") && !flags.has("--resume")) {
    const source = await collectSource(root);
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          target: "preview",
          alias: previewAlias,
          sourceSha256: source.sourceSha256,
          fileCount: source.files.length,
          sourceBytes: source.sourceBytes,
          files: source.files.map((file) => file.file),
        },
        null,
        2,
      ),
    );
    return;
  }
  if (!process.env.VERCEL_TOKEN)
    throw new Error(
      "VERCEL_TOKEN is not available in secure environment settings",
    );
  const link = JSON.parse(
    await readFile(join(root, ".vercel/project.json"), "utf8"),
  );
  if (!link.orgId || !link.projectId)
    throw new Error("Existing Vercel project link is required");
  const project = await api(link.orgId, `/v9/projects/${link.projectId}`);
  const previousAlias = await verifyCurrentAlias(link.orgId, project.id);
  let state;
  if (flags.has("--resume")) {
    state = JSON.parse(await readFile(statePath, "utf8"));
    if (state.projectId !== project.id || state.alias !== previewAlias)
      throw new Error("Saved deployment belongs to another project/alias");
  } else {
    execFileSync("npm", ["run", "check"], { cwd: root, stdio: "inherit" });
    const source = await collectSource(root);
    const created = await api(
      link.orgId,
      "/v13/deployments",
      "POST",
      deploymentBody(project, source),
    );
    verifyAliasTarget(null, project.id, created);
    state = {
      projectId: project.id,
      id: created.id,
      url: created.url,
      alias: previewAlias,
      sourceSha256: source.sourceSha256,
      fileCount: source.files.length,
      sourceBytes: source.sourceBytes,
      previousDeploymentId: previousAlias?.deploymentId ?? null,
      readyState: created.readyState,
      createdAt: new Date().toISOString(),
    };
    await save(state);
  }
  let lastState;
  for (let attempt = 0; attempt < 180; attempt++) {
    const deployment = await api(link.orgId, `/v13/deployments/${state.id}`);
    verifyAliasTarget(null, project.id, deployment);
    if (deployment.meta?.jarvisSourceSha256 !== state.sourceSha256)
      throw new Error("Deployment source hash mismatch");
    if (lastState !== deployment.readyState)
      console.log(
        JSON.stringify({
          deploymentId: state.id,
          state: deployment.readyState,
          url: `https://${deployment.url}`,
        }),
      );
    lastState = deployment.readyState;
    state.readyState = deployment.readyState;
    await save(state);
    if (["ERROR", "CANCELED"].includes(deployment.readyState))
      throw new Error(
        redact(
          `Deployment ${deployment.readyState}: ${deployment.errorCode ?? ""} ${deployment.errorMessage ?? ""}. Inspect ${state.id} in Vercel; alias unchanged.`,
        ),
      );
    if (deployment.readyState === "READY") {
      const aliasNow = await verifyCurrentAlias(link.orgId, project.id);
      if (
        aliasNow?.deploymentId !== state.previousDeploymentId &&
        aliasNow?.deploymentId !== state.id
      )
        throw new Error(
          "Preview alias changed during build; refusing to replace newer work",
        );
      if (aliasNow?.deploymentId !== state.id)
        await api(link.orgId, `/v2/deployments/${state.id}/aliases`, "POST", {
          alias: previewAlias,
        });
      const verified = await currentAlias(link.orgId);
      if (verified?.deploymentId !== state.id)
        throw new Error(
          "Alias assignment not confirmed; run --resume after inspection",
        );
      state.stablePreviewUrl = `https://${previewAlias}`;
      state.verifiedAt = new Date().toISOString();
      await save(state);
      console.log(
        JSON.stringify({
          status: "READY",
          url: state.stablePreviewUrl,
          deploymentId: state.id,
          sourceSha256: state.sourceSha256,
          productionChanged: false,
        }),
      );
      return;
    }
    await delay(5000);
  }
  throw new Error(
    "Build still pending; use --resume without creating another deployment",
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  run().catch((error) => {
    console.error(redact(error.message));
    process.exitCode = 1;
  });
