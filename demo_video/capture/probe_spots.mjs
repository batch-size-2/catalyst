// Read-only: hover each "Silicon particle" spot on the identify result and save a viewport image per spot
// (review/check/capture/spots/spotN.jpg) to pick the clearest peek.
import fs from "node:fs";
import path from "node:path";
import { launch, newPage, settle, APP, blocked } from "./lib.mjs";

const D = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const out = path.join(D, "review/check/capture/spots");
fs.mkdirSync(out, { recursive: true });
const route = process.argv[2] ?? "#/identify/drop_demo/4ih2ggld";
const browser = await launch();
const { page, context, requests } = await newPage(browser, "probe spots");
await page.goto(`${APP}/${route}`);
await settle(page, 1000);
const spots = page.locator('button[aria-label^="Silicon particle"]');
const n = await spots.count();
console.log("spots", n);
await page.locator('section[aria-label="Look here first"] > div.relative').first().evaluate((e) => e.scrollIntoView({ block: "center", behavior: "instant" }));
for (let i = 0; i < n; i++) {
  await spots.nth(i).hover();
  await settle(page, 600);
  const info = await page.evaluate(() => {
    const t = document.querySelector("[role=tooltip]")?.getBoundingClientRect();
    return { scrollY: window.scrollY, tip: t && { x: t.left, y: t.top, w: t.width, h: t.height } };
  });
  console.log(i + 1, await spots.nth(i).getAttribute("aria-label"), JSON.stringify(info));
  await page.screenshot({ path: path.join(out, `spot${i + 1}.jpg`), type: "jpeg", quality: 70, scale: "css" });
}
console.log("measure requests:", requests.filter((r) => /\/api\/measure/.test(r.url)).length, "blocked:", blocked);
await context.close();
await browser.close();
