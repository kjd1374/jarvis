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

for(const engine of ['chromium','webkit'])test(`signed preview frame or top-level fallback in ${engine}, with no copied-link access`,async()=>fixture(async f=>withPreviewHttps(f,async browser=>{
  const context=await browser.newContext({ignoreHTTPSErrors:true}),page=await context.newPage();
  await page.goto(appOrigin);
  const frame=page.frameLocator('iframe[title="Development app"]');
  if(engine==='webkit') {
    // WebKit blocks third-party cookies: the private app stays closed and the existing signed top-level path works.
    await frame.getByRole('heading',{name:'Jarvis에서 화면을 다시 열어주세요'}).waitFor();
    const popup=context.waitForEvent('page');await page.getByRole('link',{name:'Open top level'}).click();const app=await popup;
    await app.waitForURL(remoteUrl);await app.getByRole('button',{name:'Save',exact:true}).click();await app.waitForFunction(()=>document.querySelector('output').textContent==='1');
  } else {
    await frame.getByRole('heading',{name:'Synthetic remote preview'}).waitFor();
    await frame.getByRole('button',{name:'Save',exact:true}).click();await frame.locator('output').filter({hasText:'1'}).waitFor();
    assert(!(await frame.locator('body').evaluate(()=>document.cookie)).includes('jarvis-embed'));
  }
  assert.equal(new URL(page.url()).origin,appOrigin);
  const other=await browser.newContext({ignoreHTTPSErrors:true});assert.equal((await(await other.newPage()).goto(remoteUrl)).status(),403);await other.close();await context.close();
},{embed:true,engine})));
