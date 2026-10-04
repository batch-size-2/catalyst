// Review images: each shot downscaled with its highlight boxes (red) and targets (cyan) drawn on it.
//   node capture/review.mjs [name,name]  -> review/check/capture/<name>.jpg
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const D = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.join(D, "review/check/capture");
fs.mkdirSync(OUT, { recursive: true });
const m = JSON.parse(fs.readFileSync(path.join(D, "public/screens/manifest.json"), "utf8"));
const want = process.argv[2] ? new Set(process.argv[2].split(",")) : null;

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1000, height: 600 }, deviceScaleFactor: 1 });
await context.route("**/*", (r) => (r.request().url().startsWith("file:") ? r.continue() : r.abort()));
const page = await context.newPage();
for (const [name, s] of Object.entries(m.shots)) {
  if (want && !want.has(name)) continue;
  const W = s.kind === "page" ? 760 : 1100;
  const k = W / s.w;
  const off = s.kind === "viewport" ? s.scrollY : 0; // viewport files start at scrollY
  const boxes = Object.entries(s.highlights ?? {}).map(([id, b], i) => {
    const hue = (i * 47) % 360;
    return `<div style="position:absolute;left:${b.x * k}px;top:${(b.y - off) * k}px;width:${b.w * k}px;height:${b.h * k}px;border:2px solid hsl(${hue} 100% 55%);box-sizing:border-box"><span style="position:absolute;left:0;top:0;background:hsl(${hue} 100% 40%);color:#fff;font:bold 10px sans-serif;padding:0 2px;white-space:nowrap">${id}</span></div>`;
  });
  const dots = Object.entries(s.targets ?? {}).map(([id, t]) =>
    `<div style="position:absolute;left:${t.x * k - 5}px;top:${(t.y - off) * k - 5}px;width:10px;height:10px;border-radius:5px;background:cyan;border:2px solid #000" title="${id}"></div>`);
  const navDots = Object.entries(s.nav ?? {}).map(([id, t]) =>
    `<div style="position:absolute;left:${t.x * k - 3}px;top:${t.y * k - 3}px;width:6px;height:6px;background:lime"></div>`);
  const H = s.h * k;
  const html = `<html><body style="margin:0;background:#222"><div style="position:relative;width:${W}px;height:${H}px">
    <img src="file://${path.join(D, "public", s.file)}" style="width:${W}px;height:${H}px;display:block">
    ${boxes.join("")}${dots.join("")}${navDots.join("")}</div></body></html>`;
  const tmp = path.join(D, ".cache/review.html");
  fs.writeFileSync(tmp, html);
  await page.setViewportSize({ width: W, height: Math.max(100, Math.ceil(H)) });
  await page.goto(`file://${tmp}`);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  await page.screenshot({ path: path.join(OUT, `${name.replace("@", "_at_")}.jpg`), type: "jpeg", quality: 72, fullPage: true });
  console.log(`review ${name}`);
}
await browser.close();
