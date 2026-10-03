// Everything on screen is a pure function of (timeline, t in seconds). Layers share these
// so the cat's pointer, the camera and the window always agree on where things are.
import { Easing, interpolate, spring } from "remotion";
import standins from "../standins.json";
import type { Beat, CatBeat, Timeline } from "./core";
import { CONTENT, FPS, H, W, WIN } from "./theme";

export const calm = Easing.bezier(0.33, 0, 0.15, 1);
export const inOut = Easing.bezier(0.65, 0, 0.35, 1);
export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const prog = (t: number, t0: number, dur: number, easing = calm) =>
  interpolate(t, [t0, t0 + Math.max(dur, 1e-3)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing });
export const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
export const springAt = (t: number, t0: number, cfg: { damping?: number; stiffness?: number; mass?: number } = {}) =>
  t < t0 ? 0 : spring({ frame: (t - t0) * FPS, fps: FPS, config: { damping: 200, stiffness: 80, mass: 1, ...cfg } });

export const sceneOf = (tl: Timeline, id: string) => tl.scenes.find((s) => s.id === id);
export const fxBeat = (tl: Timeline, fx: string) => tl.beats.find((b) => b.fx === fx);
export const fxT = (tl: Timeline, fx: string) => fxBeat(tl, fx)?.t;

// ---------- background plate ----------
export type BgParams = { bright: number; color: number; blur: number; edge: number; si: number; pore: number; scrim: number };
export const BG_MODES: Record<string, BgParams> = {
  news: { bright: 0.14, color: 0, blur: 3, edge: 0, si: 0, pore: 0, scrim: 0 },
  "hero-grey": { bright: 0.92, color: 0, blur: 0, edge: 0, si: 0, pore: 0, scrim: 1 },
  graphite: { bright: 0.92, color: 0, blur: 0, edge: 1, si: 0, pore: 0, scrim: 1 },
  silicon: { bright: 0.8, color: 0, blur: 0, edge: 0.2, si: 1, pore: 0, scrim: 1 },
  pore: { bright: 0.8, color: 0, blur: 0, edge: 0, si: 0.3, pore: 1, scrim: 1 },
  color: { bright: 0.95, color: 1, blur: 0, edge: 0, si: 0, pore: 0, scrim: 1 },
  app: { bright: 0.3, color: 1, blur: 3, edge: 0, si: 0, pore: 0, scrim: 0 },
  outro: { bright: 0.5, color: 1, blur: 1.5, edge: 0, si: 0, pore: 0, scrim: 0.6 },
};

export function bgAt(tl: Timeline, t: number): BgParams {
  const bs = tl.beats.filter((b) => b.bg && BG_MODES[b.bg]);
  let prev = BG_MODES.news;
  let out = prev;
  for (const b of bs) {
    if (b.t > t) break;
    const target = BG_MODES[b.bg!];
    const p = prog(t, b.t, b.dur ?? 1.1, inOut);
    out = Object.fromEntries(Object.keys(target).map((k) => [k, lerp(prev[k as keyof BgParams], target[k as keyof BgParams], p)])) as BgParams;
    prev = target;
  }
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
export function windowAt(tl: Timeline, t: number) {
  const tin = tl.beats.find((b) => b.window === "in")?.t ?? Infinity;
  const tout = tl.beats.find((b) => b.window === "out")?.t ?? Infinity;
  const pin = springAt(t, tin, { damping: 200, stiffness: 60 });
  const pout = prog(t, tout, 1.3, inOut);
  const push = pushAt(tl, t);
  return {
    visible: t >= tin && pout < 1,
    opacity: clamp01(pin * 1.4) * (1 - pout),
    dy: (1 - pin) * 160 - pout * 30,
    scale: (0.96 + 0.04 * pin) * (1 - 0.18 * pout) * push,
    blur: pout * 6,
  };
}
function pushAt(tl: Timeline, t: number) {
  const b = [...tl.beats].reverse().find((x) => x.push && x.t <= t);
  if (!b) return 1;
  const up = prog(t, b.t, 0.9, inOut);
  const down = prog(t, b.t + (b.dur ?? 2), 0.9, inOut);
  return 1 + (b.push! - 1) * (up - down);
}
const WCX = WIN.x + WIN.w / 2;
const WCY = WIN.y + WIN.h / 2;
export function winToScreen(tl: Timeline, t: number, x: number, y: number): [number, number] {
  const w = windowAt(tl, t);
  return [WCX + (x - WCX) * w.scale, WCY + (y - WCY) * w.scale + w.dy];
}

// ---------- screen camera (Phase 1: stand-in screenshots) ----------
export type Box = { x: number; y: number; w: number; h: number };
type Img = { file: string; h: number; highlights: Record<string, Box>; states?: Record<string, { grey: string[] }> };
export const STANDINS = standins as unknown as { width: number; shots: Record<string, string>; images: Record<string, Img> };
export type Cam = { x: number; y: number; s: number };
const S0 = CONTENT.w / STANDINS.width;

export function camFor(imgKey: string, hl?: string | null, zoom = 1, scrollTo?: number): Cam {
  const img = STANDINS.images[imgKey];
  const pageH = img?.h ?? CONTENT.h / S0;
  const box = hl ? img?.highlights[hl] : undefined;
  if (!box) {
    const y = Math.min(Math.max(0, scrollTo ?? 0), Math.max(0, pageH - CONTENT.h / S0));
    return { x: 0, y, s: S0 };
  }
  const fit = Math.min(CONTENT.w / (box.w + 120), CONTENT.h / (box.h + 120));
  const s = Math.max(S0, Math.min(S0 * zoom, fit));
  const vw = CONTENT.w / s;
  const vh = CONTENT.h / s;
  const x = Math.min(Math.max(0, box.x + box.w / 2 - vw / 2), STANDINS.width - vw);
  const y = Math.min(Math.max(0, box.y + box.h / 2 - vh / 2), Math.max(0, pageH - vh));
  return { x, y, s };
}
const lerpCam = (a: Cam, b: Cam, p: number): Cam => ({ x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p), s: lerp(a.s, b.s, p) });

export type ScreenState = {
  img: string | null;
  shot: string | null;
  shotT: number;
  state: string | null;
  stateT: number;
  prevState: string | null;
  cam: Cam;
  prev: { img: string; cam: Cam } | null;
  fade: number; // 0..1 cross-fade from prev to img
  hl: string | null;
  url: string;
};

export function screenAt(tl: Timeline, t: number): ScreenState {
  let img: string | null = null;
  let shot: string | null = null;
  let shotT = 0;
  let state: string | null = null;
  let prevState: string | null = null;
  let stateT = -Infinity;
  let from: Cam | null = null;
  let to: Cam = { x: 0, y: 0, s: S0 };
  let camT = 0;
  let prev: { img: string; cam: Cam } | null = null;
  let hl: string | null = null;
  let url = "#/identify";
  const evalCam = (at: number) => (from ? lerpCam(from, to, prog(at, camT, 1.2, inOut)) : to);
  for (const b of tl.beats) {
    if (b.t > t) break;
    if (b.url) url = b.url;
    let changed = false;
    if (b.shot) {
      const key = STANDINS.shots[b.shot] ?? `missing:${b.shot}`;
      if (key !== img) {
        if (img) prev = { img, cam: evalCam(b.t) };
        img = key;
        shotT = b.t;
        changed = true;
        state = b.state ?? null;
        stateT = -Infinity;
      }
      shot = b.shot;
    }
    if (b.state && !changed && b.state !== state) {
      prevState = state;
      state = b.state;
      stateT = b.t;
    }
    if (img && (changed || "highlight" in b || b.scrollTo != null)) {
      if ("highlight" in b) hl = b.highlight ?? null;
      const target = camFor(img, hl, b.zoom ?? 1, b.scrollTo);
      from = changed ? null : evalCam(b.t);
      to = target;
      camT = b.t;
    }
  }
  // a slow push-in on every shot, so stills never look frozen
  const drift = 1 + 0.025 * clamp01((t - shotT) / 12);
  const base = evalCam(t);
  const cam = { ...base, s: base.s * drift, x: base.x + (CONTENT.w / base.s) * (1 - 1 / drift) / 2, y: base.y + (CONTENT.h / base.s) * (1 - 1 / drift) / 2 };
  return { img, shot, shotT, state, stateT, prevState, cam, prev, fade: prog(t, shotT, 0.8, inOut), hl, url };
}

// A highlight box in frame coordinates (window transform included), or null.
export function hlToScreen(tl: Timeline, t: number, id: string | null | undefined): Box | null {
  if (!id) return null;
  const s = screenAt(tl, t);
  const box = s.img ? STANDINS.images[s.img]?.highlights[id] : undefined;
  if (!box) return null;
  const [x0, y0] = winToScreen(tl, t, CONTENT.x + (box.x - s.cam.x) * s.cam.s, CONTENT.y + (box.y - s.cam.y) * s.cam.s);
  const [x1, y1] = winToScreen(tl, t, CONTENT.x + (box.x + box.w - s.cam.x) * s.cam.s, CONTENT.y + (box.y + box.h - s.cam.y) * s.cam.s);
  // clip to the visible content area
  const cx0 = Math.max(x0, CONTENT.x + 8), cy0 = Math.max(y0, CONTENT.y + 8);
  const cx1 = Math.min(x1, CONTENT.x + CONTENT.w - 8), cy1 = Math.min(y1, CONTENT.y + CONTENT.h - 8);
  return { x: cx0, y: cy0, w: Math.max(0, cx1 - cx0), h: Math.max(0, cy1 - cy0) };
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
  outro: { x: 1545, y: 760, face: -1 },
};
export type CatPos = { x: number; y: number; face: number; rot: number; travel: number };
export type CatNow = CatBeat & { pos: CatPos; t0: number; prevLookAt: string | null; lookT: number; itemT: number; visible: boolean };

function anchorPos(tl: Timeline, b: Beat, st: CatBeat) {
  const a = ANCHORS[st.anchor ?? "off-left"] ?? ANCHORS["left-low"];
  let y = a.y === "auto" ? 640 : a.y;
  if (a.y === "auto" && st.lookAt) {
    const box = hlToScreen(tl, b.t + 1.4, st.lookAt);
    // put the pointing paw (198/340 of the height) level with the target's centre
    if (box) y = box.y + box.h / 2 - 198 * CAT_K + CAT_H;
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
      from = to;
      to = target;
      t0 = b.t;
    }
    st = next;
  }
  const p = springAt(t, t0, { damping: 15, stiffness: 55, mass: 1 });
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

// Callout: the latest callout beat, alive for calloutFor seconds (or until the next one).
export function calloutAt(tl: Timeline, t: number) {
  const cs = tl.beats.filter((b) => "callout" in b);
  for (let i = cs.length - 1; i >= 0; i--) {
    const b = cs[i];
    if (b.t > t) continue;
    if (!b.callout) return null;
    const next = cs[i + 1]?.t ?? Infinity;
    const end = Math.min(b.t + (b.calloutFor ?? 2.4), next);
    if (t > end + 0.35) return null;
    return { text: b.callout, t0: b.t, end, chained: i > 0 && !!cs[i - 1].callout && Math.abs((cs[i - 1].t + (cs[i - 1].calloutFor ?? 2.4)) - b.t) < 0.3 };
  }
  return null;
}
