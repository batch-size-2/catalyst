// Shared helpers for the capture pipeline: browser + seatbelt, settle, measuring.
import { chromium } from "playwright-core";

export const APP = (process.env.APP_URL ?? "http://localhost:5174").replace(/\/$/, "");
export const VIEW = { w: 1400, h: 780, dpr: 2 };

export const blocked = []; // every non-GET the seatbelt refused
export const posted = []; // allowed non-GETs (verify only)
export const warnings = [];

export function warn(msg) {
  warnings.push(msg);
  console.log(`WARNING: ${msg}`);
}

/** The seatbelt: abort every non-GET except POST /api/verify/*. Not a mock: allowed requests go to the live app. */
export async function seatbelt(target, label = "") {
  await target.route("**/*", (r) => {
    const q = r.request();
    const m = q.method();
    if (m !== "GET" && !(m === "POST" && /\/api\/verify\//.test(q.url()))) {
      const line = `${m} ${q.url()}${label ? ` [${label}]` : ""}`;
      blocked.push(line);
      console.log(`BLOCKED ${line}`);
      return r.abort();
    }
    if (m !== "GET") posted.push(`${m} ${q.url()}${label ? ` [${label}]` : ""}`);
    return r.continue();
  });
}

export async function launch() {
  return chromium.launch({ channel: "chrome", headless: true, args: ["--hide-scrollbars"] });
}

/** A fresh context + page with the seatbelt on both, and a request log. */
export async function newPage(browser, label = "", opts = {}) {
  const context = await browser.newContext({
    viewport: { width: VIEW.w, height: VIEW.h },
    deviceScaleFactor: VIEW.dpr,
    colorScheme: "dark",
    reducedMotion: opts.reducedMotion ?? "no-preference",
  });
  await seatbelt(context, label);
  const page = await context.newPage();
  await seatbelt(page, label);
  const requests = [];
  page.on("request", (q) => requests.push({ method: q.method(), url: q.url(), t: Date.now() }));
  page.__requests = requests;
  page.on("pageerror", (e) => console.log(`  pageerror: ${e.message}`));
  return { context, page, requests };
}

/** network idle + fonts + all <img> complete + a little time for entrance animations. */
export async function settle(page, extra = 800) {
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => warn(`networkidle timeout on ${page.url()}`));
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await page
    .waitForFunction(() => [...document.images].every((i) => i.complete), null, { timeout: 15000 })
    .catch(() => warn(`images still loading on ${page.url()}`));
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(extra);
}

/** Document-space box of the first match of a locator (or null + warning). */
export async function box(locator, id, { warnMissing = true, textLimit = 400 } = {}) {
  try {
    const n = await locator.count();
    if (!n) {
      if (warnMissing) warn(`highlight "${id}" not found`);
      return null;
    }
    const el = locator.first();
    return await el.evaluate((node, lim) => {
      const r = node.getBoundingClientRect();
      const text = (node.innerText ?? node.getAttribute("aria-label") ?? "").replace(/\s+\n/g, "\n").trim().slice(0, lim);
      return {
        x: Math.round((r.left + window.scrollX) * 10) / 10,
        y: Math.round((r.top + window.scrollY) * 10) / 10,
        w: Math.round(r.width * 10) / 10,
        h: Math.round(r.height * 10) / 10,
        text: text || node.getAttribute("aria-label") || "",
      };
    }, textLimit);
  } catch (e) {
    if (warnMissing) warn(`highlight "${id}" failed: ${e.message.split("\n")[0]}`);
    return null;
  }
}

export const centre = (b) => (b ? { x: Math.round((b.x + b.w / 2) * 10) / 10, y: Math.round((b.y + b.h / 2) * 10) / 10 } : null);
