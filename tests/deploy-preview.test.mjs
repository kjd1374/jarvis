import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectSource,
  deploymentBody,
  previewAlias,
  verifyAliasTarget,
} from "../scripts/deploy-preview.mjs";
const project = {
  id: "prj_test",
  name: "jarvis",
  link: { type: "github", org: "kjd1374", repo: "jarvis" },
};
async function fixture(work) {
  const root = await mkdtemp(join(tmpdir(), "jarvis-preview-test-"));
  try {
    for (const name of [
      "src",
      "public",
      ".vercel",
      "test-results",
      "public/uploads",
    ])
      await mkdir(join(root, name), { recursive: true });
    for (const name of [
      "package.json",
      "package-lock.json",
      "next.config.ts",
      "tsconfig.json",
      "eslint.config.mjs",
      ".node-version",
    ])
      await writeFile(join(root, name), "synthetic config");
    await writeFile(join(root, "src/page.tsx"), "uncommitted synthetic UI");
    await writeFile(join(root, "public/icon.svg"), "synthetic icon");
    await work(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("working-tree upload includes current code and excludes credentials and user artifacts", async () =>
  fixture(async (root) => {
    for (const name of [
      ".env.local",
      ".vercel/auth.json",
      "test-results/conversation.json",
      "public/uploads/private.txt",
      "src/.env.local",
    ])
      await writeFile(join(root, name), "must never upload");
    const source = await collectSource(root);
    const names = source.files.map((file) => file.file);
    assert(names.includes("src/page.tsx"));
    assert(names.includes("public/icon.svg"));
    assert(!names.some((name) => /env|auth|private|test-results/.test(name)));
    await writeFile(join(root, "src/page.tsx"), "updated synthetic UI");
    assert.notEqual(
      (await collectSource(root)).sourceSha256,
      source.sourceSha256,
    );
  }));
test("source symlinks and credential-looking content are refused", async () =>
  fixture(async (root) => {
    await symlink(join(root, ".node-version"), join(root, "src/link"));
    await assert.rejects(collectSource(root), /symlink/);
    await rm(join(root, "src/link"));
    await writeFile(join(root, "src/unsafe.ts"), "-----BEGIN PRIVATE KEY-----");
    await assert.rejects(collectSource(root), /credential/);
  }));
test("deployment uses inline current files and never selects Git, production, or setting overrides", () => {
  const source = {
    sourceSha256: "synthetic-hash",
    files: [{ file: "src/page.tsx", buffer: Buffer.from("current code") }],
  };
  const body = deploymentBody(project, source);
  for (const field of [
    "target",
    "gitSource",
    "projectSettings",
    "env",
    "gitMetadata",
  ])
    assert(!(field in body));
  assert.equal(
    Buffer.from(body.files[0].data, "base64").toString(),
    "current code",
  );
  assert.equal(body.meta.jarvisSourceSha256, source.sourceSha256);
  assert.throws(
    () =>
      deploymentBody(
        { ...project, link: { ...project.link, repo: "other" } },
        source,
      ),
    /Unexpected/,
  );
});
test("alias assignment refuses production and another project", () => {
  const alias = { alias: previewAlias, projectId: project.id };
  verifyAliasTarget(alias, project.id, { projectId: project.id, target: null });
  assert.throws(
    () =>
      verifyAliasTarget(alias, project.id, {
        projectId: project.id,
        target: "production",
      }),
    /never production/,
  );
  assert.throws(
    () =>
      verifyAliasTarget({ ...alias, projectId: "other" }, project.id, {
        projectId: project.id,
      }),
    /owner/,
  );
  assert.throws(
    () =>
      verifyAliasTarget(
        { ...alias, alias: "production.vercel.app" },
        project.id,
        { projectId: project.id },
      ),
    /owner/,
  );
});
