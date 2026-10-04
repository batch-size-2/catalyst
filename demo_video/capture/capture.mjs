#!/usr/bin/env node
// Screen-capture pipeline for the Catalyst demo video.
//   node capture/capture.mjs [--only name,name] [--clips] [--no-clips]
// Reads ../shots.json, writes public/screens/*.png + manifest.json and public/clips/*.mp4.
// Read-only against the live app: a seatbelt aborts every non-GET except POST /api/verify/*.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { APP, VIEW, launch, newPage, settle, warn, warnings, blocked, posted, centre } from "./lib.mjs";

const D = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SCREENS = path.join(D, "public/screens");
const CLIPS = path.join(D, "public/clips");
const TMP = path.join(D, ".cache/frames");
const MANIFEST = path.join(SCREENS, "manifest.json");
const MAX_H = 6000;
const FPS = 30;

// ---------- args ----------
const argv = process.argv.slice(2);
const onlyArg = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : null;
const only = onlyArg ? new Set(onlyArg.split(",").map((s) => s.trim()).filter(Boolean)) : null;
const clipsOnly = argv.includes("--clips");
const noClips = argv.includes("--no-clips");
const t0 = Date.now();

const spec = JSON.parse(fs.readFileSync(path.join(D, "shots.json"), "utf8"));
fs.mkdirSync(SCREENS, { recursive: true });
fs.mkdirSync(CLIPS, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

// ---------- helpers injected into every page ----------
const HELPERS = `
window.__cap = {
  smallest(root, re) {
    if (!root) return null;
    const rx = new RegExp(re, "i");
    let best = null, area = Infinity;
    for (const el of root.querySelectorAll("*")) {
      const t = (el.innerText || "").trim();
      if (!rx.test(t)) continue;
      const r = el.getBoundingClientRect();
      const a = r.width * r.height;
      if (a > 0 && a < area) { best = el; area = a; }
    }
    return best;
  },
  foldBody(title) {
    const b = [...document.querySelectorAll("button[aria-expanded]")].find((x) => x.innerText.includes(title));
    return b && b.getAttribute("aria-expanded") === "true" ? b.nextElementSibling : null;
  },
  worst() {
    return [...document.querySelectorAll("div.flex.flex-col")].find(
      (d) => /worst case if ignored/i.test(d.firstElementChild?.innerText ?? "") && d.querySelector(":scope > ol"));
  },
  worstSteps() {
    const w = window.__cap.worst();
    return w ? [...w.querySelectorAll(":scope > ol > li")] : [];
  },
};`;

// ---------- utilities ----------
const label = (name) => name.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()); // batchLabel(): Batch_1 -> Batch 1
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
const round1 = (v) => Math.round(v * 10) / 10;

async function getJson(p) {
  const res = await fetch(APP + p);
  if (!res.ok) throw new Error(`GET ${p} -> ${res.status}`);
  return res.json();
}

function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  } catch {
    return { shots: {}, clips: {} };
  }
}

function writeManifest(m) {
  const { app, captured, viewport, sidebar, shots, clips, ...rest } = m;
  fs.writeFileSync(MANIFEST, JSON.stringify({ app, captured, viewport, sidebar, shots, clips, ...rest }, null, 2));
}

/** Box (document CSS px) + trimmed innerText of a spec: Playwright selector or "js:" expression (element or array -> union). */
async function measure(page, id, rawSpec, vars, { quiet = false } = {}) {
  let s = fill(rawSpec, vars);
  let optional = quiet;
  if (s.startsWith("?")) {
    optional = true;
    s = s.slice(1);
  }
  const fn = (v) => {
    const els = (Array.isArray(v) ? v : [v]).filter((e) => e && e.getBoundingClientRect);
    if (!els.length) return null;
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (const e of els) {
      const q = e.getBoundingClientRect();
      if (!q.width && !q.height) continue;
      l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom);
    }
    if (l === Infinity) return null;
    const text = els.map((e) => (e.innerText ?? "").trim() || e.getAttribute?.("aria-label") || "").join("\n")
      .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 400);
    return { x: l + window.scrollX, y: t + window.scrollY, w: r - l, h: b - t, text };
  };
  try {
    let res = null;
    if (s.startsWith("js:")) {
      const h = await page.evaluateHandle(`(() => { try { return (${s.slice(3)}) ?? null; } catch (e) { return null; } })()`);
      res = await h.evaluate(fn);
      await h.dispose();
    } else {
      const loc = page.locator(s);
      if (await loc.count()) res = await loc.first().evaluate(fn);
    }
    if (!res) {
      if (!optional) warn(`highlight "${id}" not found (${s.slice(0, 90)})`);
      return null;
    }
    return { x: round1(res.x), y: round1(res.y), w: round1(res.w), h: round1(res.h), text: res.text };
  } catch (e) {
    if (!optional) warn(`highlight "${id}" failed: ${e.message.split("\n")[0]}`);
    return null;
  }
}

async function measureNav(page) {
  return page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Main"]');
    if (!nav) return { nav: {}, sidebarW: null };
    const items = { identify: "Identify tile", compare: "Compare batch", library: "Library", audit: "Audit log", impact: "Wear & impact", anode: "Anode lab" };
    const out = {};
    const r1 = (v) => Math.round(v * 10) / 10;
    for (const [k, t] of Object.entries(items)) {
      const a = [...nav.querySelectorAll("a")].find((x) => x.innerText.trim().startsWith(t));
      if (a) {
        const r = a.getBoundingClientRect();
        out[k] = { x: r1(r.left + r.width / 2), y: r1(r.top + r.height / 2) };
      }
    }
    const ex = [...nav.children].find((e) => e.innerText.trim().toLowerCase() === "experimental");
    if (ex) {
      const r = ex.getBoundingClientRect();
      out.experimental = { x: r1(r.left), y: r1(r.top), w: r1(r.width), h: r1(r.height) };
    }
    const sb = nav.closest("aside")?.parentElement;
    return { nav: out, sidebarW: sb ? r1(sb.getBoundingClientRect().width) : null };
  });
}

/** Document position of a range input's thumb (16 px thumb assumed). */
async function thumb(page, s) {
  const l = page.locator(s).first();
  if (!(await l.count())) return null;
  return l.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const min = Number(el.min || 0), max = Number(el.max || 100), v = Number(el.value);
    const T = 16;
    const f = max > min ? (v - min) / (max - min) : 0;
    const r1 = (x) => Math.round(x * 10) / 10;
    return { x: r1(r.left + T / 2 + f * (r.width - T) + window.scrollX), y: r1(r.top + r.height / 2 + window.scrollY) };
  });
}

async function first(page, s) {
  const loc = page.locator(s).first();
  return (await loc.count()) ? loc : null;
}

async function parkMouse(page) {
  // an empty spot in the main header, right edge: no hover styles
  await page.mouse.move(VIEW.w - 6, 6);
}

// ---------- named steps ----------
const STEPS = {
  async wait(page, ctx, ms) {
    await page.waitForTimeout(ms);
  },
  async settle(page) {
    await settle(page, 500);
  },
  async click(page, ctx, s) {
    const l = await first(page, fill(s, ctx.vars));
    if (!l) return warn(`step click: "${s}" not found`), false;
    await l.scrollIntoViewIfNeeded();
    await l.click();
    await page.waitForTimeout(400);
  },
  async openFold(page, ctx, title) {
    const b = await first(page, `button[aria-expanded]:has-text("${title}")`);
    if (!b) return warn(`step openFold: fold "${title}" not found`), false;
    if ((await b.getAttribute("aria-expanded")) !== "true") {
      await b.scrollIntoViewIfNeeded();
      await b.click();
    }
    await page.waitForTimeout(500);
  },
  async seg(page, ctx, text) {
    const b = await first(page, `[role=tab]:text-is("${text}")`);
    if (!b) return warn(`step seg: segment "${text}" not found`), false;
    await b.click();
    await page.waitForTimeout(400);
  },
  async scrollIntoView(page, ctx, s, block = "center", margin = 0) {
    const l = await first(page, fill(s, ctx.vars));
    if (!l) return warn(`step scrollIntoView: "${s}" not found`), false;
    await l.evaluate((e, [blk, m]) => {
      e.scrollIntoView({ block: blk, behavior: "instant" });
      if (blk === "end") window.scrollBy({ top: m, behavior: "instant" });
      if (blk === "start") window.scrollBy({ top: -m, behavior: "instant" });
    }, [block, margin]);
    await page.waitForTimeout(300);
  },
  async auditSelect(page, ctx) {
    const want = `${label(ctx.vars.B)} vs ${label(ctx.vars.baseline)}`;
    const rows = page.locator('section.panel:has(h2:text-is("Decision log")) button');
    const n = await rows.count();
    for (let i = 0; i < n; i++) {
      const t = (await rows.nth(i).innerText()).replace(/\s+/g, " ");
      if (t.includes(want) && !/one-off/i.test(t) && /INVESTIGATE/i.test(t)) {
        const before = blocked.length + posted.length;
        await rows.nth(i).click();
        await settle(page, 400);
        if (blocked.length + posted.length !== before) warn("selecting the audit row sent a non-GET request");
        ctx.data.audit_row_selected = t.trim();
        return true;
      }
    }
    warn(`step auditSelect: no decision row "${want}" (INVESTIGATE, default baseline)`);
    return false;
  },
  async verifyAll(page, ctx) {
    const b = await first(page, 'button:has-text("Verify everything")');
    if (!b) return warn("step verifyAll: no Verify everything button"), false;
    const t = Date.now();
    await b.click();
    await page.locator('button:has-text("Verify again")').first().waitFor({ timeout: 120000 }).catch(() => warn("verify did not finish in 120 s"));
    ctx.data.verify_ms = Date.now() - t;
    await settle(page, 500);
  },
  async lawsuit(page, ctx) {
    const b = await first(page, 'section[aria-label="Generate lawsuit"] button');
    if (!b) return warn("step lawsuit: no GENERATE LAWSUIT button"), false;
    const before = blocked.length + posted.length;
    await b.scrollIntoViewIfNeeded();
    await b.click();
    await page.getByText("READY FOR COUNSEL", { exact: false }).first().waitFor({ timeout: 20000 }).catch(() => warn("lawsuit never reached READY FOR COUNSEL"));
    await page.waitForTimeout(1200);
    if (blocked.length + posted.length !== before) warn("GENERATE LAWSUIT sent a non-GET request");
    ctx.data.lawsuit_non_get = blocked.length + posted.length - before;
  },
  /** Hover or pin a "Silicon particle" spot on the identify result. */
  async peekSpot(page, ctx, mode) {
    const spots = page.locator('button[aria-label^="Silicon particle"]');
    const n = await spots.count();
    if (!n) {
      warn('step peekSpot: no "Silicon particle" spots on this page (the drop has no particle data / images)');
      ctx.missing = "spot";
      return false;
    }
    const idx = Math.min(ctx.vars.spotIndex ?? 0, n - 1);
    const spot = spots.nth(idx);
    await page.locator('section[aria-label="Look here first"] > div.relative').first()
      .evaluate((e) => e.scrollIntoView({ block: "center", behavior: "instant" })).catch(() => {});
    await page.waitForTimeout(300);
    await spot.evaluate((e) => (window.__capSpot = e));
    ctx.data.spot = idx + 1;
    ctx.data.spot_label = await spot.getAttribute("aria-label");
    if (mode === "pin") {
      await spot.click();
      await parkMouse(page);
    } else await spot.hover();
    await settle(page, 700);
  },
  /** Hover or pin the batch tile {image} in "The tiles behind it" (whole-tile peek, same inspector). */
  async peekTile(page, ctx, mode) {
    const tile = await first(page, `section[aria-label="The tiles behind it"] button[aria-label^="Tile ${ctx.vars.image}"]`)
      ?? await first(page, 'section[aria-label="The tiles behind it"] button[aria-label^="Tile "]');
    if (!tile) return warn("step peekTile: no tile in 'The tiles behind it'"), (ctx.missing = "tile"), false;
    await tile.evaluate((e) => e.scrollIntoView({ block: "center", behavior: "instant" }));
    await page.waitForTimeout(300);
    await tile.evaluate((e) => (window.__capSpot = e));
    ctx.data.tile = (await tile.getAttribute("aria-label"))?.replace(/:.*/, "");
    if (mode === "pin") {
      await tile.click();
      await parkMouse(page);
    } else await tile.hover();
    await settle(page, 700);
  },
  async inspectorSwitch(page, ctx, text) {
    const sw = await first(page, `aside[aria-label="Region inspector"] [role=switch]:has-text("${text}")`);
    if (!sw) return warn(`step inspectorSwitch: no "${text}" switch in the inspector`), false;
    if (await sw.isDisabled()) return warn(`step inspectorSwitch: "${text}" switch is disabled (tile not measured)`), false;
    await sw.click();
    await settle(page, 600);
    ctx.data[`switch_${text.toLowerCase()}`] = await sw.getAttribute("aria-checked");
  },
  async anodeReady(page, ctx) {
    await page.locator("canvas").first().waitFor({ timeout: 20000 }).catch(() => warn("anode: no canvas"));
    await page.getByText("Packing the blocks", { exact: false }).first().waitFor({ state: "detached", timeout: 30000 }).catch(() => {});
    await page.locator('table:has(td:text-is("Plating margin"))').first().waitFor({ timeout: 30000 }).catch(() => warn("anode: readouts never appeared"));
    await settle(page, 2500);
  },
  /** A fast charge at the URL's C-rate, stopped where the plating readout is on: at 100% the CV taper has
   *  already lifted the margin above 0, so scan the state-of-charge slider and park in the middle of the
   *  range where both batches plate (else where any does). Same state as pausing the charge there. */
  async fastCharge(page, ctx) {
    const slider = page.locator('label:has-text("State of charge") input[type=range]').first();
    const setSoc = (v) => slider.evaluate((el, x) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      set.call(el, String(x));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, v);
    const scan = [];
    for (let i = 0; i <= 100; i += 2) {
      await setSoc(i / 100);
      await page.waitForTimeout(30);
      const cells = await page.locator('tr:has(td:text-is("Plating margin")) td').allInnerTexts();
      scan.push({ soc: i / 100, plates: cells.slice(1).map((c) => /plating/i.test(c)) });
    }
    const pick = (pred) => {
      const hits = scan.filter((r) => pred(r.plates));
      return hits.length ? hits[Math.floor(hits.length / 2)].soc : null;
    };
    const soc = pick((p) => p.length && p.every(Boolean)) ?? pick((p) => p.some(Boolean));
    ctx.data.plating_scan = scan.filter((r) => r.plates.some(Boolean)).map((r) => `${Math.round(r.soc * 100)}%:${r.plates.map((b) => (b ? "P" : "-")).join("")}`).join(" ");
    if (soc == null) {
      warn("fastCharge: no state of charge shows plating at this C-rate");
      await setSoc(1);
    } else {
      await setSoc(soc);
      ctx.data.soc_used = soc;
    }
    await settle(page, 1200);
  },
  /** Camera continuity with anode_rotate: replay its drag (page clock paused), settle fully, then resume real time. */
  async rotateLikeClip(page, ctx, extra = 150) {
    const cb = await measure(page, "block", "canvas", ctx.vars);
    if (!cb) return warn("rotateLikeClip: no canvas"), false;
    const { pre } = await preRollRotate(page, cb);
    for (let i = 0; i < extra; i++) await pre.frame();
    ctx.data.camera = await camState(page);
    ctx.data.camera_note = `anode_rotate's drag replayed, then ${extra} frames of settling (az ${deg(ctx.data.camera.az)}°)`;
    await page.clock.resume();
    page.__capPaused = false;
    await page.waitForTimeout(300);
  },
  async scrollTop(page) {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.waitForTimeout(200);
  },
};

async function runSteps(page, ctx, steps = []) {
  for (const [name, ...args] of steps) {
    const fn = STEPS[name];
    if (!fn) {
      warn(`unknown step ${name}`);
      continue;
    }
    const ok = await fn(page, ctx, ...args);
    if (ok === false && ctx.missing) return false;
  }
  return true;
}

function highlightSpecs(shot) {
  const byName = Object.fromEntries(spec.shots.map((s) => [s.name, s]));
  const own = typeof shot.highlights === "string" ? spec.groups[shot.highlights.slice(1)] : shot.highlights ?? {};
  const base = shot.extends ? highlightSpecs(byName[shot.extends]) : {};
  return { ...base, ...own };
}

// ---------- stills ----------
async function captureShot(browser, shot, ids, manifest) {
  const ctx = { vars: ids, data: {}, missing: null };
  const { context, page, requests } = await newPage(browser, shot.name);
  await page.addInitScript(HELPERS);
  if (shot.clock) await page.clock.install(); // fake timers (time still flows) so steps can step frames deterministically
  const route = fill(shot.route, ids);
  const url = `${APP}/${route}`;
  console.log(`\n--- ${shot.name}  ${url}`);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await settle(page);
    const ok = await runSteps(page, ctx, shot.steps);
    if (!ok && shot.requires) {
      warn(`${shot.name}: skipped (missing ${ctx.missing})`);
      delete manifest.shots[shot.name];
      return;
    }
    if (shot.kind === "page") {
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      await parkMouse(page);
      await page.waitForTimeout(400);
    } else if (!shot.steps?.some(([n]) => /^peek/.test(n))) {
      await parkMouse(page);
    }
    const highlights = {};
    for (const [id, s] of Object.entries(highlightSpecs(shot))) {
      const b = await measure(page, id, s, ids);
      if (b) highlights[id] = b;
    }
    const targets = {};
    for (const t of shot.targets ?? []) {
      if (typeof t === "string") {
        if (highlights[t]) targets[t] = centre(highlights[t]);
        else warn(`target "${t}" has no highlight`);
      } else {
        for (const [id, s] of Object.entries(t)) {
          if (s.startsWith("thumb:")) {
            const p = await thumb(page, s.slice(6));
            if (p) targets[id] = p;
            else warn(`target "${id}" not found`);
            continue;
          }
          const b = await measure(page, id, s, ids);
          if (b) targets[id] = centre(b);
        }
      }
    }
    const { nav, sidebarW } = await measureNav(page);
    const scrollY = await page.evaluate(() => Math.round(window.scrollY));
    const docH = await page.evaluate(() => document.documentElement.scrollHeight);
    const data = { ...ctx.data };
    for (const [k, v] of Object.entries(shot.data ?? {})) {
      if (typeof v === "string" && v.startsWith("@")) data[k] = highlights[v.slice(1)]?.text ?? null;
      else if (typeof v === "string" && v.startsWith("=")) data[k] = fill(v.slice(1), ids);
      else data[k] = typeof v === "string" ? fill(v, ids) : v;
    }
    const measures = requests.filter((r) => /\/api\/measure/.test(r.url));
    if (measures.length) warn(`${shot.name}: page attempted ${measures.length} /api/measure call(s) (blocked by the seatbelt)`);
    data.non_get_requests = requests.filter((r) => r.method !== "GET").map((r) => `${r.method} ${r.url.replace(APP, "")}`);

    const file = `screens/${shot.name}.png`;
    const entry = { kind: shot.kind, file, url: route, w: VIEW.w };
    if (shot.kind === "page") {
      const H = Math.min(docH, MAX_H);
      if (docH > MAX_H) warn(`${shot.name}: page is ${docH}px tall, capped at ${MAX_H}`);
      await page.screenshot({ path: path.join(D, "public", `screens/${shot.name}.vp.png`), animations: "disabled" });
      await page.screenshot({ path: path.join(D, "public", file), fullPage: true, clip: { x: 0, y: 0, width: VIEW.w, height: H }, animations: "disabled" });
      Object.assign(entry, { vp: `screens/${shot.name}.vp.png`, h: H, scrollY: 0 });
      if (docH > MAX_H) data.doc_h = docH;
    } else {
      await page.screenshot({ path: path.join(D, "public", file), animations: "disabled" });
      Object.assign(entry, { h: VIEW.h, scrollY });
    }
    Object.assign(entry, { highlights, targets, nav, data });
    manifest.shots[shot.name] = entry;
    if (sidebarW) manifest.sidebar = { w: sidebarW };
    console.log(`  ok ${file} h=${entry.h} scrollY=${entry.scrollY} highlights=${Object.keys(highlights).length}`);
  } catch (e) {
    warn(`${shot.name}: failed: ${e.message.split("\n")[0]}`);
  } finally {
    await context.close();
  }
}

// ---------- resolve ids ----------
async function resolveIds(browser) {
  const [batches, settings, tiles, drops] = await Promise.all([
    getJson("/api/batches"), getJson("/api/settings"), getJson("/api/tiles"), getJson("/api/attribution"),
  ]);
  const baseline = settings.baseline;
  const ids = { baseline };
  // B: first non-baseline INVESTIGATE batch whose Compare page has a "What moved" section
  const candidates = batches.filter((b) => b.name !== baseline && b.verdict === "INVESTIGATE" && b.has_images).map((b) => b.name);
  for (const name of candidates) {
    const { context, page } = await newPage(browser, `resolve ${name}`);
    await page.goto(`${APP}/#/compare/${encodeURIComponent(name)}`);
    await settle(page, 300);
    const moved = await page.locator('section[aria-label="What moved"]').count();
    await context.close();
    console.log(`  resolve: ${name} -> ${moved ? "properties moved" : "nothing moved"}`);
    if (moved) {
      ids.B = name;
      break;
    }
  }
  if (!ids.B) {
    ids.B = candidates[0] ?? batches.find((b) => b.name !== baseline)?.name;
    warn(`no batch with moved properties; using ${ids.B}`);
  }
  // drop + image: a non-fixture drop; prefer images correctly attributed, high confidence, familiar, no drop tile without KPIs
  const drop = drops.find((d) => !/^example|fixture/i.test(d)) ?? drops[0];
  ids.drop = drop;
  const att = await getJson(`/api/attribution/${encodeURIComponent(drop)}`);
  const score = (im) => {
    const real = tiles.find((t) => t.image_id === im.image_id && !t.batch.startsWith("drop"));
    const measureRisk = tiles.some((t) => t.batch === drop && t.image_id === im.image_id && !t.kpis);
    return (measureRisk ? -100 : 0) + (real && real.batch === im.predicted ? 10 : 0) + (im.unfamiliar === false ? 2 : 0) + (im.confidence ?? 0);
  };
  const best = [...att.images].sort((a, b) => score(b) - score(a))[0];
  ids.image = best.image_id;
  ids.imageBatch = tiles.find((t) => t.image_id === best.image_id && !t.batch.startsWith("drop"))?.batch ?? ids.B;
  ids.spotIndex = 0;
  ids.predicted = best.predicted;
  Object.assign(ids, spec.vars ?? {}); // fixed choices from shots.json (e.g. which spot to peek)
  return ids;
}

// ---------- clips ----------
function encode(name, dir, frames) {
  const out = path.join(CLIPS, `${name}.mp4`);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", path.join(dir, "frame_%04d.png"),
    "-c:v", "libx264", "-crf", "18", "-g", "15", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out]);
  const size = fs.statSync(out).size;
  if (size > 25 * 1024 * 1024) warn(`clip ${name} is ${(size / 1048576).toFixed(1)} MB (> 25 MB)`);
  console.log(`  encoded ${out} ${frames} frames ${(size / 1048576).toFixed(1)} MB`);
  return size;
}

/** Deterministic recorder: the page's clock is paused; each frame advances it 1/30 s and seeks CSS animations to match. */
class Recorder {
  /** dry: step the page exactly like a recording but write no files (camera pre-roll); ms: continue a previous recorder's clock */
  constructor(page, name, { dry = false, ms = 0 } = {}) {
    this.page = page;
    this.name = name;
    this.dry = dry;
    this.dir = path.join(TMP, name);
    if (!dry) {
      fs.rmSync(this.dir, { recursive: true, force: true });
      fs.mkdirSync(this.dir, { recursive: true });
    }
    this.n = 0;
    this.ms = ms; // fake ms since pause
  }
  async pause() {
    if (this.page.__capPaused) return this.syncAnimations();
    const now = await this.page.evaluate(() => Date.now());
    await this.page.clock.pauseAt(now + 50);
    this.page.__capPaused = true;
    await this.syncAnimations();
  }
  async syncAnimations() {
    await this.page.evaluate((ms) => {
      window.__animStart ??= new WeakMap();
      for (const a of document.getAnimations()) {
        if (!window.__animStart.has(a)) window.__animStart.set(a, ms);
        a.pause();
        a.currentTime = Math.max(0, ms - window.__animStart.get(a));
      }
    }, this.ms);
  }
  async step() {
    const next = Math.round(((this.n + 1) * 1000) / FPS);
    const prev = Math.round((this.n * 1000) / FPS);
    await this.page.clock.runFor(next - prev);
    this.ms += next - prev;
    await this.syncAnimations();
  }
  async shot() {
    this.n += 1;
    if (!this.dry) await this.page.screenshot({ path: path.join(this.dir, `frame_${String(this.n).padStart(4, "0")}.png`) });
    return this.n - 1; // index of the frame just written
  }
  /** advance one frame then capture it */
  async frame() {
    await this.step();
    return this.shot();
  }
  dup(times) {
    const last = path.join(this.dir, `frame_${String(this.n).padStart(4, "0")}.png`);
    for (let i = 0; i < times; i++) {
      this.n += 1;
      fs.copyFileSync(last, path.join(this.dir, `frame_${String(this.n).padStart(4, "0")}.png`));
    }
  }
  addFile(file) {
    this.n += 1;
    fs.copyFileSync(file, path.join(this.dir, `frame_${String(this.n).padStart(4, "0")}.png`));
    return this.n - 1;
  }
  finish() {
    const size = encode(this.name, this.dir, this.n);
    return { file: `clips/${this.name}.mp4`, w: VIEW.w, h: VIEW.h, fps: FPS, frames: this.n, duration: Math.round((this.n / FPS) * 1000) / 1000, bytes: size };
  }
}

/** Read-only camera readout: the app's own R3F root for the canvas (same Vite module instance), no state changed. */
async function camState(page) {
  // the module URL comes from the request log (the page's performance API is faked once the clock is installed)
  const url = page.__requests?.map((r) => r.url).find((n) => /react-three_fiber\.js/.test(n));
  if (!url) return null;
  return page.evaluate(async (u) => {
    const m = await import(u);
    const root = m._roots?.get(document.querySelector("canvas"));
    if (!root) return null;
    const st = root.store.getState();
    const c = st.controls;
    const r = (v) => Math.round(v * 1e6) / 1e6;
    return { az: r(c?.getAzimuthalAngle?.() ?? NaN), pol: r(c?.getPolarAngle?.() ?? NaN), pos: st.camera.position.toArray().map(r), target: c?.target?.toArray().map(r) };
  }, url);
}

const deg = (rad) => Math.round((rad * 180) / Math.PI * 1000) / 1000;

/** The anode_rotate drag, step for step (same start point, path, easing, frame count). With a dry recorder it only moves the camera. */
async function dragRotate(page, rec, cb, { onFrame } = {}) {
  const x0 = cb.x + cb.w * 0.5, y0 = cb.y + cb.h * 0.62;
  const dx = Math.round((35 / 360) * cb.h);
  const N = 105; // 3.5 s drag
  const ease = (t) => (1 - Math.cos(Math.PI * t)) / 2; // sine in-out: starts moving sooner than a cubic
  const tick = async () => { const i = await rec.frame(); if (onFrame) await onFrame(i); };
  await rec.pause();
  await page.mouse.move(x0, y0);
  { const i = await rec.shot(); if (onFrame) await onFrame(i); }
  for (let i = 0; i < 8; i++) await tick();
  await page.mouse.down();
  for (let i = 1; i <= N; i++) {
    await page.mouse.move(x0 + dx * ease(i / N), y0 - 6 * ease(i / N));
    await tick();
  }
  await page.mouse.up();
  for (let i = 0; i < 24; i++) await tick(); // damping settles
  return { x0, y0, dx, N };
}

/** Put the camera where anode_rotate ends: replay its drag dry on this page (page clock paused). */
async function preRollRotate(page, cb) {
  const pre = new Recorder(page, "preroll", { dry: true });
  await dragRotate(page, pre, cb);
  return { pre, cam: await camState(page) };
}

async function clipPage(browser, name, route) {
  const { context, page, requests } = await newPage(browser, `clip ${name}`);
  await page.addInitScript(HELPERS);
  await page.clock.install();
  await page.goto(`${APP}/${route}`, { waitUntil: "domcontentloaded" });
  await settle(page);
  return { context, page, requests };
}

async function measureAll(page, specs, ids) {
  const out = {};
  for (const [id, s] of Object.entries(specs)) {
    const b = await measure(page, id, s, ids);
    if (b) out[id] = b;
  }
  return out;
}

const CLIP_FNS = {
  /** Audit: GENERATE LAWSUIT from press to the READY FOR COUNSEL* card, at audit@lawsuit_done's scrollY. */
  async lawsuit(browser, ids, manifest) {
    const route = "#/audit";
    const { context, page, requests } = await clipPage(browser, "lawsuit", route);
    const ctx = { vars: ids, data: {} };
    try {
      await STEPS.auditSelect(page, ctx);
      // the film presses Verify first, so the lawsuit runs in the verified layout (banner + ✓ marks + passport line)
      const postsBefore = posted.length;
      await STEPS.verifyAll(page, ctx);
      const banner = await page.locator('button:has-text("Verify again")').first().evaluate((b) => b.previousElementSibling?.innerText.trim() ?? "").catch(() => "");
      const passportLine = await page.locator('section[aria-label="Batch passport"] dd span.font-semibold').first().innerText().catch(() => "");
      const verifyPosts = posted.slice(postsBefore).map((x) => x.replace(APP, ""));
      if (!/unchanged/.test(banner)) warn(`lawsuit clip: verify banner says "${banner}"`);
      let scrollY = manifest.shots["audit@lawsuit_done"]?.scrollY;
      if (scrollY == null) {
        warn("lawsuit clip: audit@lawsuit_done not captured yet; estimating scrollY");
        scrollY = await page.locator('section[aria-label="Generate lawsuit"]').evaluate((e) => Math.round(e.getBoundingClientRect().bottom + window.scrollY + 300 - window.innerHeight));
      }
      // the card grows while it runs; until then the page may be too short to sit at the final scroll
      const docH = await page.evaluate(() => document.documentElement.scrollHeight);
      if (docH < scrollY + VIEW.h) {
        await page.addStyleTag({ content: `main { padding-bottom: ${scrollY + VIEW.h - docH + 40}px; }` });
        ctx.data.padded = scrollY + VIEW.h - docH + 40;
      }
      await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), scrollY);
      await parkMouse(page);
      await page.waitForTimeout(300);
      const realY = await page.evaluate(() => Math.round(window.scrollY));
      if (realY !== scrollY) warn(`lawsuit clip: scrollY ${realY} instead of ${scrollY}`);
      const highlights = await measureAll(page, { lawsuit: 'section[aria-label="Generate lawsuit"]', lawsuit_btn: 'section[aria-label="Generate lawsuit"] button' }, ids);
      const before = requests.length;
      const rec = new Recorder(page, "lawsuit");
      await rec.pause();
      await rec.shot();
      for (let i = 0; i < 6; i++) await rec.frame(); // ~0.25 s idle (the app's checklist is ~5.4 s; the clip must stay <= 6 s)
      const btn = page.locator('section[aria-label="Generate lawsuit"] button').first();
      const box = await btn.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.up();
      const press = await rec.frame();
      let done = null;
      for (let i = 0; i < 240 && done == null; i++) {
        const idx = await rec.frame();
        const landed = await page.evaluate(() => {
          const card = [...document.querySelectorAll('section[aria-label="Generate lawsuit"] div.animate-rise')].find((d) => /READY FOR COUNSEL/.test(d.innerText));
          if (!card) return false;
          return card.getAnimations().every((a) => a.playState === "finished" || (a.currentTime ?? 0) >= (a.effect?.getComputedTiming().endTime ?? 0));
        });
        if (landed) done = idx;
      }
      if (done == null) warn("lawsuit clip: READY FOR COUNSEL never landed");
      await page.mouse.move(VIEW.w - 6, 6);
      while (rec.n < 180) await rec.frame(); // hold to 6.0 s (~0.4-0.5 s after the card lands)
      const after = requests.slice(before).filter((r) => r.method !== "GET");
      const final = await measureAll(page, { counsel: 'section[aria-label="Generate lawsuit"] div.animate-rise:has-text("READY FOR COUNSEL")', lawsuit_end: 'section[aria-label="Generate lawsuit"]' }, ids);
      const entry = rec.finish();
      if (entry.duration > 6) warn(`lawsuit clip is ${entry.duration}s (> 6 s): the app's own checklist takes ~5 s`);
      return {
        ...entry, url: route, scrollY: realY, highlights: { ...highlights, ...final }, targets: { lawsuit_btn: centre(highlights.lawsuit_btn) },
        events: { press, done }, data: { state: "verified", verify_banner: banner, verify_passport: passportLine, verify_posts_before_recording: verifyPosts },
        notes: `Verified layout: row #0004 selected, "Verify everything" pressed before recording (${verifyPosts.length} POST /api/verify) -> "${banner}". Deterministic (paused page clock, 1/30 s per frame). Non-GET requests during the recording: ${after.length}${ctx.data.padded ? `; main padded by ${ctx.data.padded}px so the final scroll position exists before the card grows` : ""}.`,
      };
    } finally {
      await context.close();
    }
  },

  /** Anode lab: slow eased drag that turns the block ~40°. */
  async anode_rotate(browser, ids) {
    const route = "?soc=0&c=1&cycles=0#/anode";
    const { context, page } = await clipPage(browser, "anode_rotate", route);
    try {
      await STEPS.anodeReady(page, {});
      const highlights = await measureAll(page, spec.groups.anode, ids);
      const cb = highlights.block;
      const rec = new Recorder(page, "anode_rotate");
      const { x0, y0, dx, N } = await dragRotate(page, rec, cb);
      const entry = rec.finish();
      return { ...entry, url: route, scrollY: 0, highlights, targets: { drag_from: { x: x0, y: y0 }, drag_to: { x: x0 + dx, y: y0 - 6 } }, events: { drag_start: 9, drag_end: 9 + N },
        notes: `Eased drag of ${dx}px (~35°, OrbitControls 2π·Δx/height) over ${N} frames, then release; paused page clock.` };
    } finally {
      await context.close();
    }
  },

  /** Anode lab: C-rate at max, press Charge, until plating shows and the charge ends. */
  async anode_charge(browser, ids) {
    const route = "?soc=0&c=8&cycles=0#/anode";
    const { context, page } = await clipPage(browser, "anode_charge", route);
    try {
      await STEPS.anodeReady(page, {});
      const highlights = await measureAll(page, spec.groups.anode, ids);
      // camera continuity: replay anode_rotate's drag first; frame 0 = anode_rotate's last frame (its residual damping
      // of ~0.04° then finishes during this clip, as it would have)
      const { pre, cam: camStart } = await preRollRotate(page, highlights.block);
      const rec = new Recorder(page, "anode_charge", { ms: pre.ms });
      await rec.pause();
      await rec.shot();
      for (let i = 0; i < 8; i++) await rec.frame();
      const btn = page.locator("aside button.pri").first();
      const box = await btn.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.up();
      const press = await rec.frame();
      await page.mouse.move(VIEW.w - 6, 6);
      // stop (Pause) once plating has shown for a while and the charge is past STOP_SOC, so the clip ends on plating
      const STOP_SOC = 0.6;
      let plating = null, ended = null, paused = null;
      for (let i = 0; i < 140 && ended == null && paused == null; i++) {
        const idx = await rec.frame();
        const st = await page.evaluate(() => {
          const row = [...document.querySelectorAll("tr")].find((r) => r.cells[0]?.innerText.trim() === "Plating margin");
          return {
            plating: row ? [...row.cells].slice(1).some((c) => /plating/i.test(c.innerText)) : false,
            stopped: /^Charge at/.test(document.querySelector("aside button.pri")?.innerText.trim() ?? ""),
            soc: Number(document.querySelector('aside input[type=range]')?.value ?? 0),
          };
        });
        if (st.plating && plating == null) plating = idx;
        if (st.stopped) ended = idx;
        else if (plating != null && st.plating && st.soc >= STOP_SOC) {
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.down();
          await page.mouse.up();
          paused = await rec.frame();
          await page.mouse.move(VIEW.w - 6, 6);
        }
      }
      if (plating == null) warn("anode_charge: plating never showed in the readout");
      for (let i = 0; i < 18 && rec.n < 150; i++) await rec.frame();
      const final = await measureAll(page, { plating: 'tr:has(td:text-is("Plating margin"))', soc: 'label:has-text("State of charge")' }, ids);
      const camEnd = await camState(page);
      const entry = rec.finish();
      return { ...entry, url: route, scrollY: 0, highlights: { ...highlights, ...final }, targets: { charge_btn: centre(highlights.charge_btn) }, events: { press, plating, pause: paused, end: ended },
        data: { camera_start: camStart, camera_end: camEnd, camera: "anode_rotate's end angle (drag replayed in this page first)" },
        notes: `Camera: anode_rotate's drag replayed first (az ${deg(camStart.az)}° at frame 0 = anode_rotate's last frame, ${deg(camEnd.az)}° at the end). 8C charge from empty; events.plating = first frame the readout says plating; Pause pressed at events.pause (state of charge >= ${STOP_SOC * 100}%), then held. Paused page clock.` };
    } finally {
      await context.close();
    }
  },

  /** Anode lab: ageing eased 0 -> 800 cycles; last frames from ?cycles=800 (the slider's step can't hit 800). */
  async anode_age(browser, ids) {
    const route = "?soc=0&c=1&cycles=0#/anode";
    const { context, page } = await clipPage(browser, "anode_age", route);
    try {
      await STEPS.anodeReady(page, {});
      const highlights = await measureAll(page, spec.groups.anode, ids);
      const { pre, cam: camStart } = await preRollRotate(page, highlights.block);
      const rec = new Recorder(page, "anode_age", { ms: pre.ms });
      await rec.pause();
      await rec.shot();
      for (let i = 0; i < 6; i++) await rec.frame();
      const N = 90;
      const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
      let lastCycles = 0;
      for (let i = 1; i <= N; i++) {
        const cycles = Math.min(799, 800 * ease(i / N));
        lastCycles = await page.locator('label:has-text("Ageing") input[type=range]').first().evaluate((el, c) => {
          const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
          let t = Math.sqrt(c / 1000);
          t = Math.floor(t / 0.002) * 0.002; // stay on the slider's step grid, at or below the target
          set.call(el, String(t));
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return Math.round(t * t * 1000);
        }, cycles);
        await rec.frame();
      }
      const sliderHint = await page.locator('label:has-text("Ageing")').first().innerText();
      const camSlider = await camState(page);
      // final state exactly at 800 cycles from the URL: a new page, so replay the same drag there and step as many
      // frames as this page has run since its drag (rec.n), so the camera is where it would be here
      const p2 = await clipPage(browser, "anode_age final", "?soc=0&c=1&cycles=800#/anode");
      await STEPS.anodeReady(p2.page, {});
      const roll2 = await preRollRotate(p2.page, highlights.block);
      for (let i = 0; i < rec.n; i++) await roll2.pre.frame();
      const camFinal = await camState(p2.page);
      const finalFile = path.join(TMP, "anode_age_final.png");
      await p2.page.screenshot({ path: finalFile });
      const final = await measureAll(p2.page, { ageing: 'label:has-text("Ageing")', readouts: spec.groups.anode.readouts, block: "canvas" }, ids);
      await p2.context.close();
      const end = rec.addFile(finalFile);
      rec.dup(14);
      const entry = rec.finish();
      return { ...entry, url: route, scrollY: 0, highlights: { ...highlights, ...Object.fromEntries(Object.entries(final).map(([k, v]) => [`${k}_end`, v])) },
        targets: { ageing: centre(highlights.ageing) }, events: { start: 7, end },
        data: { camera_start: camStart, camera_last_slider_frame: camSlider, camera_final_state: camFinal, camera: "anode_rotate's end angle (drag replayed in this page, and again on the cycles=800 page)" },
        notes: `Camera: anode_rotate's drag replayed first (az ${deg(camStart.az)}° at frame 0 = anode_rotate's last frame); the cycles=800 page replays it too (az ${deg(camFinal.az)}° vs ${deg(camSlider.az)}° on the last slider frame). Slider eased 0 -> ${lastCycles} cycles over ${N} frames ("${sliderHint.replace(/\s+/g, " ")}"), then the ?cycles=800 state (frame ${end}) held 0.5 s.` };
    } finally {
      await context.close();
    }
  },

  /** Audit: Verify everything -> ticks; only kept if the re-hash isn't instant. */
  async verify(browser, ids, manifest) {
    const route = "#/audit";
    const { context, page } = await clipPage(browser, "verify", route);
    const ctx = { vars: ids, data: {} };
    try {
      await STEPS.auditSelect(page, ctx);
      await parkMouse(page);
      const highlights = await measureAll(page, spec.groups.audit, ids);
      const rec = new Recorder(page, "verify");
      await rec.pause();
      await rec.shot();
      for (let i = 0; i < 8; i++) await rec.frame();
      const b = page.locator('button:has-text("Verify everything")').first();
      const box = await b.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.up();
      const press = await rec.frame();
      await page.mouse.move(VIEW.w - 6, 6);
      let done = null;
      const t = Date.now();
      // the re-hash is real server work: real time passes between frames, the page clock only moves 1/30 s per frame
      for (let i = 0; i < 150 && done == null; i++) {
        const idx = await rec.frame();
        if (await page.locator('button:has-text("Verify again")').count()) done = idx;
      }
      if (done == null) warn("verify clip: verify did not finish within 150 frames");
      for (let i = 0; i < 20; i++) await rec.frame();
      const final = await measureAll(page, spec.groups.audit_verified, ids);
      const entry = rec.finish();
      return { ...entry, url: route, scrollY: 0, highlights: { ...highlights, ...final }, targets: { verify_btn: centre(highlights.verify_btn) }, events: { press, done },
        notes: `Verify everything (POST /api/verify/* x4, allowed). Server time ${Date.now() - t} ms; spinner frames reflect page-clock time, not server time.` };
    } finally {
      await context.close();
    }
  },
};

// ---------- main ----------
if (argv.includes("--probe-rotate")) {
  // Diagnostics only (no files, no manifest): replay anode_rotate dry and print the camera per clip frame + after.
  const browser = await launch();
  const { context, page } = await clipPage(browser, "probe rotate", "?soc=0&c=1&cycles=0#/anode");
  await STEPS.anodeReady(page, {});
  const cb = await measure(page, "block", "canvas", {});
  const log = [];
  const rec = new Recorder(page, "probe", { dry: true });
  await dragRotate(page, rec, cb, { onFrame: async (i) => log.push([i, await camState(page)]) });
  for (let i = 0; i < 240; i++) { const k = await rec.frame(); log.push([k, await camState(page)]); }
  const end = log.at(-1)[1];
  for (const [i, c] of log) if (i % 6 === 0 || (i >= 110 && i <= 150) || i === 137) console.log(i, deg(c.az), deg(c.pol), `Δaz to settled ${deg(c.az - end.az)}°`);
  console.log("settled", JSON.stringify(end));
  await context.close();
  await browser.close();
  process.exit(0);
}
const manifest = readManifest();
manifest.shots ??= {};
manifest.clips ??= {};
const browser = await launch();
try {
  console.log(`APP ${APP}`);
  const ids = await resolveIds(browser);
  console.log("ids", JSON.stringify(ids));
  manifest.ids = ids;
  if (!clipsOnly) {
    for (const shot of spec.shots) {
      if (only && !only.has(shot.name)) continue;
      await captureShot(browser, shot, ids, manifest);
      Object.assign(manifest, { app: APP, viewport: VIEW });
      if (!only || !manifest.captured) manifest.captured = new Date().toISOString();
      writeManifest(manifest);
    }
  }
  if (!noClips) {
    for (const name of spec.clips) {
      if (only && !only.has(name)) continue;
      // optional clip: only with --only verify or CAPTURE_VERIFY=1
      if (name === "verify" && !only?.has("verify") && process.env.CAPTURE_VERIFY !== "1") continue;
      console.log(`\n=== clip ${name}`);
      try {
        const entry = await CLIP_FNS[name](browser, ids, manifest);
        if (entry) manifest.clips[name] = entry;
      } catch (e) {
        warn(`clip ${name} failed: ${e.message.split("\n")[0]}`);
      }
      writeManifest(manifest);
    }
  }
} finally {
  await browser.close();
  Object.assign(manifest, { app: APP, captured: manifest.captured ?? new Date().toISOString(), viewport: VIEW });
  const summary = { at: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), warnings, blocked, allowed_non_get: posted };
  if (only) manifest.run_partial = { only: [...only], ...summary };
  else manifest.run = summary;
  writeManifest(manifest);
  console.log(`\nDone in ${Math.round((Date.now() - t0) / 1000)} s. ${warnings.length} warning(s).`);
  for (const w of warnings) console.log(`  WARNING: ${w}`);
  console.log(`Seatbelt blocked ${blocked.length} call(s)${blocked.length ? ":\n  " + blocked.join("\n  ") : "."}`);
  console.log(`Allowed non-GET: ${posted.length}${posted.length ? ":\n  " + posted.join("\n  ") : ""}`);
}
