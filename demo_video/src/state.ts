// Everything on screen is a pure function of (timeline, t in seconds). Layers share these
// so the cat's pointer, the camera, the cursor and the window always agree on where things are.
import { Easing, interpolate, spring } from "remotion";
import standins from "../standins.json";
import type { Beat, CatBeat, HL, Pt, ShotM, Timeline } from "./core";
import { CONTENT, FPS, FRAMES, H, SPRING, SPRING_CAT, SPRING_SOFT, W, WIN } from "./theme";

export const calm = Easing.bezier(0.33, 0, 0.15, 1);
export const inOut = Easing.bezier(0.65, 0, 0.35, 1);
export const outBack = Easing.bezier(0.34, 1.45, 0.64, 1);
export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
// eased 0..1 progress through [t0, t0 + dur]; an infinite t0 means "never" (0) or "always" (1)
export const prog = (t: number, t0: number, dur: number, easing = calm) =>
  !Number.isFinite(t0) ? (t0 < 0 ? 1 : 0) : interpolate(t, [t0, t0 + Math.max(dur, 1e-3)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing });
export const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
type SpringCfg = { damping?: number; stiffness?: number; mass?: number };
export const springAt = (t: number, t0: number, cfg: SpringCfg = { damping: 200, stiffness: 80 }) =>
  t < t0 ? 0 : spring({ frame: (t - t0) * FPS, fps: FPS, config: { damping: 200, stiffness: 80, mass: 1, ...cfg } });
export const sp = (t: number, t0: number, cfg: SpringCfg = SPRING) => springAt(t, t0, cfg);
// a damped wobble after an event (settles, takes): 0 at t0, rings and decays
export const wobble = (t: number, t0: number, freq = 3.2, decay = 5) =>
  t < t0 ? 0 : Math.sin((t - t0) * freq * 2 * Math.PI) * Math.exp(-(t - t0) * decay);

export const sceneOf = (tl: Timeline, id: string) => tl.scenes.find((s) => s.id === id);
export const sceneAt = (tl: Timeline, t: number) => tl.scenes.find((s) => t >= s.start && t < s.end) ?? tl.scenes[tl.scenes.length - 1];
export const fxBeat = (tl: Timeline, fx: string) => tl.beats.find((b) => b.fx === fx);
export const fxT = (tl: Timeline, fx: string) => fxBeat(tl, fx)?.t;
export const beatsWith = <K extends keyof Beat>(tl: Timeline, k: K) => tl.beats.filter((b) => k in b);

// ---------- background plate ----------
export type BgParams = { bright: number; color: number; blur: number; edge: number; si: number; pore: number; scrim: number; cool: number; sat: number };
const B0 = { edge: 0, si: 0, pore: 0, scrim: 0, cool: 0, sat: 1 };
export const BG_MODES: Record<string, BgParams> = {
  news: { ...B0, bright: 0.16, color: 0, blur: 2.5, cool: 0.55, sat: 0.6 },
  dark: { ...B0, bright: 0.07, color: 0, blur: 3, cool: 0.4, sat: 0.6 },
  "hero-grey": { ...B0, bright: 0.92, color: 0, blur: 0, scrim: 1 },
  graphite: { ...B0, bright: 0.92, color: 0, blur: 0, edge: 1, scrim: 1 },
  silicon: { ...B0, bright: 0.8, color: 0, blur: 0, edge: 0.2, si: 1, scrim: 1 },
  pore: { ...B0, bright: 0.8, color: 0, blur: 0, si: 0.3, pore: 1, scrim: 1 },
  color: { ...B0, bright: 0.95, color: 1, blur: 0, scrim: 1 },
  ember: { ...B0, bright: 0.42, color: 1, blur: 1.5, scrim: 0.7 },
  app: { ...B0, bright: 0.28, color: 1, blur: 3 },
  lab: { ...B0, bright: 0.26, color: 1, blur: 3, cool: 1, sat: 0.55 },
  outro: { ...B0, bright: 0.5, color: 1, blur: 1.5, scrim: 0.6 },
};

export function bgAt(tl: Timeline, t: number): BgParams {
  const bs = tl.beats.filter((b) => b.bg && BG_MODES[b.bg]);
  let prev = BG_MODES.news;
  let out = prev;
  for (const b of bs) {
    if (b.t > t) break;
    const target = BG_MODES[b.bg!];
    const p = prog(t, b.t, b.dur ?? 1.1, inOut);
    out = Object.fromEntries(Object.keys(target).map((k) => [k, lerp(out[k as keyof BgParams], target[k as keyof BgParams], p)])) as BgParams;
    prev = target;
  }
  void prev;
  return out;
}

// The plate (3200x1800, same aspect as the frame) covers the frame, with a slow Ken Burns.
export function plateXf(tl: Timeline, t: number) {
  const u = t / Math.max(tl.total, 1);
  return { k: 1.06 + 0.09 * u, dx: lerp(30, -30, u), dy: lerp(-14, 14, u) };
}
export function plateToScreen(tl: Timeline, t: number, px: number, py: number): [number, number] {
  const { k, dx, dy } = plateXf(tl, t);
  return [W / 2 + ((px / 3200) * W - W / 2) * k + dx, H / 2 + ((py / 1800) * H - H / 2) * k + dy];
}

// ---------- browser window ----------
const WCX = WIN.x + WIN.w / 2;
const WCY = WIN.y + WIN.h / 2;

function frameAt(tl: Timeline, t: number) {
  let from: { dx: number; scale: number } = FRAMES.center;
  let to: { dx: number; scale: number } = FRAMES.center;
  let t0 = -10;
  for (const b of tl.beats) {
    if (b.t > t) break;
    if (!b.frame) continue;
    const p = sp(b.t, t0, SPRING_SOFT);
    const cur = { dx: lerp(from.dx, to.dx, p), scale: lerp(from.scale, to.scale, p) };
    from = cur;
    to = FRAMES[b.frame];
    t0 = b.t;
  }
  const p = sp(t, t0, SPRING_SOFT);
  return { dx: lerp(from.dx, to.dx, p), scale: lerp(from.scale, to.scale, p), moving: Math.abs(to.dx - from.dx) * (1 - p) };
}

export function windowAt(tl: Timeline, t: number) {
  const tin = tl.beats.find((b) => b.window === "in")?.t ?? Infinity;
  const tout = tl.beats.find((b) => b.window === "out")?.t ?? Infinity;
  const pin = springAt(t, tin, { damping: 18, stiffness: 70 });
  const pout = prog(t, tout, 1.2, inOut);
  const push = pushAt(tl, t);
  const f = frameAt(tl, t);
  const f1 = frameAt(tl, t - 1 / FPS);
  // tilt while travelling: from camera scroll speed and from the window sliding aside
  const c0 = screenAt(tl, t).cam, c1 = screenAt(tl, t - 1 / FPS).cam;
  const vScroll = (c0.scroll - c1.scroll) * FPS;
  const vSlide = (f.dx - f1.dx) * FPS;
  return {
    visible: t >= tin && pout < 1,
    opacity: clamp01(pin * 1.6) * (1 - pout),
    dx: f.dx,
    dy: (1 - pin) * 260 - pout * 30,
    scale: (0.9 + 0.1 * pin) * (1 - 0.22 * pout) * push * f.scale,
    rotX: clamp(vScroll / 520, -5, 5) + (1 - clamp01(pin)) * 14,
    rotY: clamp(-vSlide / 260, -7, 7),
    blur: pout * 6,
    tin,
  };
}
function pushAt(tl: Timeline, t: number) {
  const b = [...tl.beats].reverse().find((x) => x.push && x.t <= t);
  if (!b) return 1;
  const up = sp(t, b.t, SPRING_SOFT);
  const down = sp(t, b.t + (b.dur ?? 2), SPRING_SOFT);
  return 1 + (b.push! - 1) * (up - down);
}
export function winToScreen(tl: Timeline, t: number, x: number, y: number): [number, number] {
  const w = windowAt(tl, t);
  return [WCX + w.dx + (x - WCX) * w.scale, WCY + w.dy + (y - WCY) * w.scale];
}

// ---------- screens: manifest -> stand-ins -> placeholder ----------
export const VW = 1400; // the virtual screen (the app's viewport) in CSS px
export const VH = 780;
export type Box = { x: number; y: number; w: number; h: number };
type StandIn = { file: string; h: number; highlights: Record<string, Box> };
const STANDINS = standins as unknown as { width: number; shots: Record<string, string>; images: Record<string, StandIn> };

export function shotOf(tl: Timeline, name: string | null | undefined): ShotM | null {
  if (!name) return null;
  name = name.split("#")[0]; // "anode_charge#go": the same clip re-triggered
  const m = tl.screens;
  const s = m?.shots[name] ?? m?.clips?.[name];
  if (s) {
    // a state ("audit@verified") inherits the highlights and targets its base shot measured
    const b = name.includes("@") ? m?.shots[baseOf(name)] : undefined;
    return {
      ...s,
      kind: m?.clips?.[name] ? "clip" : s.kind,
      highlights: { ...(b?.highlights ?? {}), ...s.highlights },
      targets: { ...(b?.targets ?? {}), ...(s.targets ?? {}) },
      nav: s.nav ?? b?.nav,
    };
  }
  const img = STANDINS.images[STANDINS.shots[name]];
  if (!img) return null;
  const k = VW / STANDINS.width;
  const hl = Object.fromEntries(Object.entries(img.highlights).map(([id, b]) => [id, { x: b.x * k, y: b.y * k, w: b.w * k, h: b.h * k }]));
  return { kind: "page", file: img.file, w: VW, h: img.h * k, scrollY: 0, highlights: hl, standin: true } as ShotM;
}
export const sidebarW = (tl: Timeline) => tl.screens?.sidebar?.w ?? 236;
const baseOf = (name: string) => name.split("#")[0].split("@")[0];
const hashOf = (s: ShotM | null) => (s?.url ?? "").replace(/^[^#]*/, "").split("?")[0];

// a highlight by id; "a+b" is the union of two (frame a card and its footnote together)
export function hlGet(shot: ShotM | null | undefined, id: string): HL | undefined {
  if (!shot) return undefined;
  if (!id.includes("+")) return shot.highlights[id];
  const bs = id.split("+").map((k) => shot.highlights[k]).filter(Boolean);
  if (!bs.length) return undefined;
  const x0 = Math.min(...bs.map((b) => b.x)), y0 = Math.min(...bs.map((b) => b.y));
  const x1 = Math.max(...bs.map((b) => b.x + b.w)), y1 = Math.max(...bs.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export type Cam = { scroll: number; vx: number; vy: number; s: number };
const CAM0: Cam = { scroll: 0, vx: 0, vy: 0, s: 1 };
const mixCam = (a: Cam, b: Cam, p: number): Cam => ({ scroll: lerp(a.scroll, b.scroll, p), vx: lerp(a.vx, b.vx, p), vy: lerp(a.vy, b.vy, p), s: lerp(a.s, b.s, p) });

export function camTarget(shot: ShotM | null, focus: string | null | undefined, zoom = 1.6, scroll?: number, curScroll = 0, force = false): Cam {
  if (!shot) return CAM0;
  const page = shot.kind === "page";
  const maxScroll = page ? Math.max(0, shot.h - VH) : 0;
  const b = focus ? hlGet(shot, focus) : undefined;
  if (!b) {
    const sc = page ? clamp(scroll ?? curScroll, 0, maxScroll) : shot.scrollY;
    return { scroll: sc, vx: 0, vy: 0, s: 1 };
  }
  const pad = 44;
  const s = force ? zoom : clamp(Math.min(VW / (b.w + 2 * pad), VH / (b.h + 2 * pad)), 1, zoom);
  const vh = VH / s, vw = VW / s;
  const sc = page ? clamp(b.h + 2 * pad > VH ? b.y - pad : b.y + b.h / 2 - VH / 2, 0, maxScroll) : shot.scrollY;
  const by = b.y - sc;
  const vx = clamp(b.x + b.w / 2 - vw / 2, 0, VW - vw);
  const vy = clamp(b.h + 2 * pad > vh && !force ? by - pad / s : by + b.h / 2 - vh / 2, 0, VH - vh);
  return { scroll: sc, vx, vy, s };
}

export type Layer = { name: string; shot: ShotM | null; t0: number; rate: number; from: number; base: ShotM | null };
export type Mark = { id: string; t0: number; out: number };
export type ScreenNow = {
  cur: Layer | null;
  prev: Layer | null;
  prevCam: Cam;
  changeT: number;
  nav: boolean; // the change was a page navigation (cross-fade the whole screen)
  cam: Cam;
  travel: number; // 0..1, how much of a camera move is still to go
  spots: Mark[];
  lifts: Mark[];
  url: string;
};

export function screenAt(tl: Timeline, t: number): ScreenNow {
  let cur = null as Layer | null;
  let prev = null as Layer | null;
  let prevCam = CAM0;
  let changeT = -10;
  let nav = false;
  let from: Cam | null = null;
  let to: Cam = CAM0;
  let camT = -10;
  let focus: string | null = null;
  let zoom = 1.6;
  let force = false;
  let url = "#/compare";
  let lastPage: ShotM | null = null; // the latest page shot of the current page (underlay for viewport states)
  const spots: Mark[] = [];
  const lifts: Mark[] = [];
  const endMarks = (ms: Mark[], at: number) => ms.forEach((m) => (m.out = Math.min(m.out, at)));
  const evalCam = (at: number) => (from ? mixCam(from, to, sp(at, camT)) : to);
  for (const b of tl.beats) {
    if (b.t > t) break;
    if (b.url) url = b.url;
    const name = b.clip ?? b.shot;
    if (name && name !== cur?.name) {
      const shot = shotOf(tl, name);
      const same = !!cur && (baseOf(cur.name) === baseOf(name) || (!!hashOf(shot) && hashOf(shot) === hashOf(cur.shot)));
      prevCam = evalCam(b.t);
      prev = cur;
      changeT = b.t;
      nav = !same;
      if (!same) {
        lastPage = null;
        endMarks(spots, b.t);
        endMarks(lifts, b.t);
      }
      if (shot?.kind === "page") lastPage = shot;
      cur = { name, shot, t0: b.t, rate: b.rate ?? 1, from: b.clipFrom ?? 0, base: lastPage };
      if (shot?.url && !b.url) url = hashOf(shot) || url;
      if (!same) {
        focus = "focus" in b ? (b.focus ?? null) : null;
        zoom = b.zoom ?? 1.6;
        force = !!b.force;
        from = null;
        to = camTarget(shot, focus, zoom, b.scroll, 0, force);
        camT = b.t;
      } else if (!("focus" in b) && b.scroll == null) {
        const c = evalCam(b.t);
        from = c;
        to = camTarget(shot, focus, zoom, undefined, c.scroll, force);
        camT = b.t;
      }
    }
    if ((("focus" in b || b.scroll != null) && !(name && nav && changeT === b.t))) {
      const c = evalCam(b.t);
      focus = b.focus ?? null;
      zoom = b.zoom ?? 1.6;
      force = !!b.force;
      from = c;
      to = camTarget(cur?.shot ?? null, focus, zoom, b.scroll, c.scroll, force);
      camT = b.t;
    }
    if ("spot" in b) {
      endMarks(spots, b.t);
      if (b.spot) spots.push({ id: b.spot, t0: b.t, out: Infinity });
    }
    if ("lift" in b) {
      endMarks(lifts, b.t);
      if (b.lift) lifts.push({ id: b.lift, t0: b.t, out: Infinity });
    }
  }
  const p = from ? sp(t, camT) : 1;
  const base = from ? mixCam(from, to, p) : to;
  // long travels dip the zoom a little mid-flight, like a camera operator pulling back
  const dist = from ? Math.abs(to.scroll - from.scroll) + Math.abs(to.vy - from.vy) * to.s : 0;
  const dip = 1 - Math.min(0.1, dist / 4000) * Math.sin(Math.PI * clamp01(p));
  const cam = { ...base, s: Math.max(1, base.s * dip) };
  if (cam.s < base.s) {
    // keep the dip centred on the same point
    cam.vx = clamp(base.vx + VW / base.s / 2 - VW / cam.s / 2, 0, VW - VW / cam.s);
    cam.vy = clamp(base.vy + VH / base.s / 2 - VH / cam.s / 2, 0, VH - VH / cam.s);
  }
  return {
    cur,
    prev,
    prevCam,
    changeT,
    nav,
    cam,
    travel: 1 - clamp01(p),
    spots: spots.filter((m) => t < m.out + 0.5),
    lifts: lifts.filter((m) => t < m.out + 0.6),
    url,
  };
}

// how fast the window's content moves on screen, in px per frame (camera travel + window slides)
export function motionAt(tl: Timeline, t: number) {
  const a = screenAt(tl, t), b = screenAt(tl, t - 1 / FPS);
  if (!a.cur || !b.cur) return 0;
  const cam = Math.hypot((a.cam.scroll - b.cam.scroll + a.cam.vy - b.cam.vy) * a.cam.s, (a.cam.vx - b.cam.vx) * a.cam.s) + Math.abs(a.cam.s - b.cam.s) * 700;
  const fa = frameAt(tl, t), fb = frameAt(tl, t - 1 / FPS);
  return cam + Math.abs(fa.dx - fb.dx) + Math.abs(fa.scale - fb.scale) * 900;
}

// document CSS px of the current shot -> virtual-screen px (all layers share one scroll)
export const docToV = (cam: Cam, x: number, y: number): [number, number] => [x, y - cam.scroll];
// virtual-screen px -> frame px (camera zoom + window transform)
export function vToScreen(tl: Timeline, t: number, cam: Cam, x: number, y: number): [number, number] {
  return winToScreen(tl, t, CONTENT.x + (x - cam.vx) * cam.s, CONTENT.y + (y - cam.vy) * cam.s);
}
export function hlOf(tl: Timeline, t: number, id: string | null | undefined): HL | undefined {
  if (!id) return undefined;
  const s = screenAt(tl, t);
  return hlGet(s.cur?.shot, id) ?? hlGet(s.cur?.base, id);
}

// A highlight box in frame coordinates (camera + window included), clipped to the content area; or null.
export function hlToScreen(tl: Timeline, t: number, id: string | null | undefined, clip = true): Box | null {
  const box = hlOf(tl, t, id);
  if (!box) return null;
  const { cam } = screenAt(tl, t);
  const [vx0, vy0] = docToV(cam, box.x, box.y);
  const [x0, y0] = vToScreen(tl, t, cam, vx0, vy0);
  const [x1, y1] = vToScreen(tl, t, cam, vx0 + box.w, vy0 + box.h);
  if (!clip) return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  const [cx0, cy0] = winToScreen(tl, t, CONTENT.x + 6, CONTENT.y + 6);
  const [cx1, cy1] = winToScreen(tl, t, CONTENT.x + CONTENT.w - 6, CONTENT.y + CONTENT.h - 6);
  const a = Math.max(x0, cx0), b = Math.max(y0, cy0), c = Math.min(x1, cx1), d = Math.min(y1, cy1);
  return { x: a, y: b, w: Math.max(0, c - a), h: Math.max(0, d - b) };
}

// ---------- the cursor (virtual-screen coordinates, so it zooms with the screen) ----------
// Page targets are kept in document px and ride with the camera's scroll, so a press always lands
// on its element even if the camera is still settling; sidebar targets are fixed on the screen.
type CursorKey = { t: number; p: Pt; fixed: boolean; press: boolean; drag: boolean; scene: string };
function targetOf(tl: Timeline, b: Beat, id: string): { p: Pt; fixed: boolean } | null {
  const s = screenAt(tl, b.t);
  if (id.startsWith("nav:")) {
    const k = id.slice(4);
    const n = s.cur?.shot?.nav?.[k] ?? s.cur?.base?.nav?.[k] ?? s.prev?.shot?.nav?.[k];
    if (!n) return null;
    const h = n as HL;
    return { p: h.w != null ? { x: h.x + h.w / 2, y: h.y + h.h / 2 } : { x: n.x, y: n.y }, fixed: true };
  }
  const [hid, edge] = id.split(":");
  const shot = s.cur?.shot;
  const tg = edge ? undefined : shot?.targets?.[hid] ?? s.cur?.base?.targets?.[hid];
  const hl = shot?.highlights[hid] ?? s.cur?.base?.highlights[hid];
  const ex = hl ? (edge === "right" ? hl.x + hl.w - 8 : edge === "left" ? hl.x + 8 : hl.x + hl.w / 2) : 0;
  const doc = tg ?? (hl ? { x: ex, y: hl.y + hl.h / 2 } : null);
  return doc ? { p: doc, fixed: false } : null;
}
const keyV = (k: CursorKey, cam: Cam): Pt => (k.fixed ? k.p : { x: k.p.x, y: k.p.y - cam.scroll });
let cursorCache: { tl: Timeline; keys: CursorKey[] } | null = null;
export function cursorKeys(tl: Timeline): CursorKey[] {
  if (cursorCache?.tl === tl) return cursorCache.keys;
  const keys: CursorKey[] = [];
  for (const b of tl.beats) {
    const id = b.cursor ?? b.hover;
    if (!id) continue;
    const g = targetOf(tl, b, id);
    if (g) keys.push({ t: b.t, p: g.p, fixed: g.fixed, press: !!b.cursor, drag: !!b.drag, scene: b.scene });
  }
  cursorCache = { tl, keys };
  return keys;
}
export const ARRIVE = 0.2; // the cursor lands this long before its word
export function cursorAt(tl: Timeline, t: number) {
  const keys = cursorKeys(tl);
  const off = tl.beats.filter((b) => "cursor" in b && b.cursor === null).map((b) => b.t);
  const w = windowAt(tl, t);
  if (!keys.length || !w.visible) return null;
  const cam = screenAt(tl, t).cam;
  const nextI = keys.findIndex((k) => k.t > t);
  const i = nextI < 0 ? keys.length : nextI; // keys[i] is the next press
  const prevK = keys[i - 1];
  const next = keys[i];
  const lastOff = off.filter((o) => o <= t).pop() ?? -Infinity;
  const start = (k: CursorKey | undefined) => (k ? k.t - ARRIVE - travelDur(prevOf(keys, k), k) : Infinity);
  const firstShow = keys[0].t - ARRIVE - 0.9;
  if (t < firstShow) return null;
  const P = prevK ? keyV(prevK, cam) : null;
  // hidden after a `cursor: null` beat until the next move starts
  if (lastOff > (prevK?.t ?? -Infinity) && t < start(next) - 0.25) {
    const a = 1 - prog(t, lastOff, 0.3);
    if (a <= 0 || !P) return null;
    return { x: P.x, y: P.y, press: 0, ripple: -1, opacity: a, rot: 0 };
  }
  let x: number, y: number, rot = 0;
  const N = next ? keyV(next, cam) : null;
  const from = P ?? (N ? { x: N.x + 260, y: N.y + 200 } : { x: VW * 0.7, y: VH * 0.8 });
  if (next && N && t >= start(next)) {
    const d = travelDur(prevK, next);
    const u = clamp01((t - start(next)) / d);
    const e = sp(t, start(next), { damping: 16, stiffness: 150, mass: 0.8 }); // slight overshoot
    const mx = (from.x + N.x) / 2, my = (from.y + N.y) / 2;
    const dx = N.x - from.x, dy = N.y - from.y;
    const bend = 0.18 * (dx > 0 ? 1 : -1);
    const cx = mx - dy * bend, cy = my + dx * bend;
    const q = clamp01(e);
    // quadratic bezier for the path, the spring's overshoot carried past the end along the last tangent
    x = (1 - q) * (1 - q) * from.x + 2 * (1 - q) * q * cx + q * q * N.x + (e - q) * (N.x - cx) * 0.6;
    y = (1 - q) * (1 - q) * from.y + 2 * (1 - q) * q * cy + q * q * N.y + (e - q) * (N.y - cy) * 0.6;
    rot = Math.sin(Math.PI * u) * clamp(dx / 90, -8, 8);
  } else {
    x = from.x;
    y = from.y;
  }
  const lastPress = prevK?.press ? prevK.t : -Infinity;
  const pt = t - lastPress;
  let press = pt >= 0 && pt < 0.22 ? Math.sin((pt / 0.22) * Math.PI) : 0;
  // a drag holds the button down from the press until the end of the move
  if (next?.drag && prevK?.press) press = Math.max(press, clamp01(pt / 0.08));
  if (prevK?.drag && t - prevK.t < 0.12) press = Math.max(press, 1 - (t - prevK.t) / 0.12);
  const appear = prog(t, firstShow, 0.35);
  return { x, y, press, ripple: pt >= 0 && pt < 0.6 ? pt / 0.6 : -1, opacity: appear, rot };
}
function prevOf(keys: CursorKey[], k: CursorKey) {
  const i = keys.indexOf(k);
  return i > 0 ? keys[i - 1] : undefined;
}
function travelDur(a: CursorKey | undefined, b: CursorKey) {
  // quick, purposeful moves (≤ 0.6 s), and the cursor dwells ~0.45 s on what it just pressed
  const d = a ? Math.hypot(b.p.x - a.p.x, a.fixed === b.fixed ? b.p.y - a.p.y : 400) : 380;
  const gap = a ? b.t - a.t - ARRIVE : 1;
  if (b.drag) return clamp(gap - 0.05, 0.18, 0.9);
  const want = clamp(0.28 + d / 3000, 0.22, 0.6);
  const dwell = Math.min(0.45, gap * 0.5);
  return clamp(Math.min(want, gap - dwell), 0.15, 0.6);
}

// ---------- the cat ----------
export const CAT_SIZE = 200;
export const CAT_K = CAT_SIZE / 320;
export const CAT_H = 340 * CAT_K;
const ANCHORS: Record<string, { x: number; y: number | "auto"; face: 1 | -1 }> = {
  "off-left": { x: -220, y: 880, face: 1 },
  "left-low": { x: 132, y: 900, face: 1 },
  "left-mid": { x: 132, y: 640, face: 1 },
  left: { x: 132, y: "auto", face: 1 },
  "right-low": { x: 1788, y: 900, face: -1 },
  "right-mid": { x: 1788, y: 640, face: -1 },
  right: { x: 1788, y: "auto", face: -1 },
  "hero-right": { x: 1690, y: 960, face: -1 }, // under the hero type when the window slides left
  outro: { x: 1290, y: 720, face: -1 },
};
export type CatPos = { x: number; y: number; face: number; rot: number; travel: number };
export type CatNow = CatBeat & { pos: CatPos; t0: number; prevLookAt: string | null; lookT: number; itemT: number; visible: boolean };

function anchorPos(tl: Timeline, b: Beat, st: CatBeat) {
  const a = ANCHORS[st.anchor ?? "off-left"] ?? ANCHORS["left-low"];
  let y = a.y === "auto" ? 640 : a.y;
  if (a.y === "auto" && st.lookAt) {
    const box = hlToScreen(tl, b.t + 1.0, st.lookAt);
    // put the pointing paw (198/340 of the height) level with the target's centre
    if (box && box.h > 0) y = box.y + box.h / 2 - 198 * CAT_K + CAT_H;
  }
  return { x: a.x, y: Math.max(330, Math.min(900, y)), face: a.face };
}

export function catAt(tl: Timeline, t: number): CatNow {
  let st: CatBeat = { anchor: "off-left", pose: "float", expression: "happy", item: "none", lookAt: null };
  let from = anchorPos(tl, tl.beats[0], st);
  let to = from;
  let t0 = -10;
  let prevLookAt: string | null = null;
  let lookT = -10;
  let itemT = -10;
  for (const b of tl.beats) {
    if (b.t > t) break;
    if (!b.cat) continue;
    const next = { ...st, ...b.cat };
    if (next.lookAt !== st.lookAt) {
      prevLookAt = st.lookAt ?? null;
      lookT = b.t;
    }
    if (next.item !== st.item) itemT = b.t;
    const target = anchorPos(tl, b, next);
    if (target.x !== to.x || target.y !== to.y || target.face !== to.face) {
      const p0 = springAt(b.t, t0, SPRING_CAT);
      from = { x: lerp(from.x, to.x, p0), y: lerp(from.y, to.y, p0), face: lerp(from.face, to.face, clamp01(p0 * 2.2)) as 1 | -1 };
      to = target;
      t0 = b.t;
    }
    st = next;
  }
  const p = springAt(t, t0, SPRING_CAT);
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  // long trips hop over the window, out of frame at the peak
  const arc = Math.abs(to.x - from.x) > 800 ? Math.max(from.y, to.y) + 80 : Math.min(140, dist * 0.3);
  const u = clamp01(p);
  const x = lerp(from.x, to.x, p);
  const y = lerp(from.y, to.y, p) - Math.sin(Math.PI * u) * arc;
  const face = lerp(from.face, to.face, clamp01(u * 2.2));
  const rot = Math.sin(Math.PI * u) * 9 * Math.sign(to.x - from.x || 0);
  return { ...st, pos: { x, y, face, rot, travel: dist > 1 ? 1 - u : 0 }, t0, prevLookAt, lookT, itemT, visible: st.anchor !== "off-left" || u < 1 };
}

// The acted change around every expression switch: squint + squash before, take + overshoot after.
export function catTakeAt(tl: Timeline, t: number) {
  const changes: { t: number; expr: string; emote?: string | null }[] = [];
  let expr = "happy";
  for (const b of tl.beats) {
    if (!b.cat?.expression || b.cat.expression === expr) continue;
    expr = b.cat.expression;
    changes.push({ t: b.t, expr, emote: b.cat.emote });
  }
  const next = changes.find((c) => c.t >= t);
  const last = [...changes].reverse().find((c) => c.t <= t);
  const pre = next ? clamp01(1 - (next.t - t) / 0.14) : 0; // anticipation: eyes close, body squashes
  const since = last ? t - last.t : 99;
  const post = since < 0.12 ? 1 - since / 0.12 : 0; // eyes reopen
  const take = last ? wobble(t, last.t, 2.6, 5.5) : 0;
  // a slow, content blink (fx "blink"): close 0.2 s, hold 0.3 s, open 0.4 s
  const sb = tl.beats.find((b) => b.fx === "blink" && t >= b.t && t < b.t + 0.9);
  const slow = sb ? (t - sb.t < 0.2 ? (t - sb.t) / 0.2 : t - sb.t < 0.5 ? 1 : 1 - (t - sb.t - 0.5) / 0.4) : 0;
  return {
    blink: 1 - Math.max(0.85 * Math.max(pre, post), 0.97 * inOut(clamp01(slow))),
    sx: 1 + 0.05 * pre - 0.05 * take,
    sy: 1 - 0.07 * pre + 0.08 * take,
    emote: last?.emote && since < 1.3 ? { kind: last.emote, age: since } : null,
  };
}
