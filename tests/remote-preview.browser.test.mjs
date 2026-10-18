import test from "node:test";
import assert from "node:assert/strict";
import { fixture, appOrigin, remoteUrl, expected } from "./support/remote-preview.mjs";
import { withPreviewHttps } from "./support/preview-https.mjs";

test("two browsers use real HTTPS redirects and host cookies: approved viewer interacts; copied link and revoked viewer are denied", async () => fixture(async f => withPreviewHttps(f, async browser => {
    const authorized = await browser.newContext({ ignoreHTTPSErrors: true }), other = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await authorized.newPage(); await page.goto(appOrigin, { waitUntil: "commit" });
    await page.waitForURL(remoteUrl);
    assert.equal(await page.locator("h1").textContent(), "Synthetic remote preview");
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForFunction(() => document.querySelector("output").textContent === "1");
    assert(!(await page.evaluate(() => document.cookie)).includes("jarvis-preview"));
    assert.equal(new URL(page.url()).origin, expected.origin);
    await page.reload(); assert.equal(await page.locator("h1").textContent(), "Synthetic remote preview");
    const unauthenticated = await other.newPage(); assert.equal((await unauthenticated.goto(remoteUrl)).status(), 403);
    f.revoke(); f.advance(10_001); assert.equal((await page.reload()).status(), 403);
})));
