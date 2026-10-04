// "lithium can plate out as metal ... short": silver lithium dendrites grow down from the top edge
// (self-drawing, seeded, tapered, metallic), accelerating; on "short" a 2-3 frame arc discharge
// jumps from the longest needle's tip, then the needles glow hot and fade into the fire.
// Pure function of t: the geometry is built once from a fixed seed.
import { useId } from "react";
import type { Timeline } from "../core";
import { clamp01, fxBeat, fxT, prog } from "../state";
import { FPS } from "../theme";

type P = [number, number];
type Needle = {
  pts: P[];
  cum: number[];
  len: number;
  w0: number; // half-width at the root when fully grown
  parent: number; // -1 for trunks
  s0: number; // arc length on the parent where it sprouts
  k: number; // growth speed relative to the parent
  ts: number; // trunks: growth start (fraction of the beat)
  te: number; // trunks: growth end (fraction of the beat)
  depth: number;
};

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DOWN = Math.PI / 2;

function walk(r: () => number, x: number, y: number, ang: number, len: number, seg: number, kink: number, pull: number): P[] {
  const pts: P[] = [[x, y]];
  let a = ang, L = 0;
  while (L < len) {
    // mostly straight, with an occasional crystalline kink; a gentle pull back towards "down"
    if (r() < 0.35) a += (r() - 0.5) * kink;
    a += (DOWN - a) * pull;
    const step = Math.min(len - L, seg * (0.75 + 0.5 * r()));
    x += Math.cos(a) * step;
    y += Math.sin(a) * step;
    L += step;
    pts.push([x, y]);
  }
  return pts;
}
const cumOf = (pts: P[]) => pts.reduce<number[]>((acc, p, i) => (acc.push(i ? acc[i - 1] + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), acc), []);
function pointAt(n: Needle, s: number): { p: P; i: number; dir: number } {
  const { pts, cum } = n;
  let i = 1;
  while (i < pts.length - 1 && cum[i] < s) i++;
  const a = pts[i - 1], b = pts[i];
  const seg = cum[i] - cum[i - 1] || 1;
  const k = clamp01((s - cum[i - 1]) / seg);
  return { p: [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k], i, dir: Math.atan2(b[1] - a[1], b[0] - a[0]) };
}

// the forest: 12 trunks across the top edge (the longest just right of centre), side branches, spikes
// and a few short stubs in between, so the plating reads as a crust of metal, not as cracks.
// irregular spacing and lengths (clusters and gaps), so it reads as growth, not as a fence
const TRUNKS: { x: number; len: number; w: number; ts: number; te: number; lean: number }[] = [
  { x: 70, len: 300, w: 6.4, ts: 0.1, te: 0.98, lean: 0.06 },
  { x: 205, len: 150, w: 5.0, ts: 0.3, te: 0.95, lean: -0.1 },
  { x: 330, len: 420, w: 7.2, ts: 0.0, te: 0.99, lean: 0.04 },
  { x: 560, len: 250, w: 6.0, ts: 0.2, te: 0.97, lean: -0.08 },
  { x: 650, len: 470, w: 7.6, ts: 0.05, te: 1.0, lean: 0.07 },
  { x: 860, len: 180, w: 5.2, ts: 0.26, te: 0.96, lean: 0.12 },
  { x: 1010, len: 610, w: 8.6, ts: 0.0, te: 1.0, lean: -0.02 }, // the one that shorts
  { x: 1120, len: 280, w: 6.2, ts: 0.16, te: 0.98, lean: 0.14 },
  { x: 1365, len: 500, w: 7.8, ts: 0.03, te: 1.0, lean: -0.05 },
  { x: 1520, len: 200, w: 5.4, ts: 0.22, te: 0.96, lean: 0.09 },
  { x: 1700, len: 380, w: 7.0, ts: 0.08, te: 0.99, lean: -0.07 },
  { x: 1870, len: 260, w: 6.0, ts: 0.14, te: 0.98, lean: 0.05 },
];
const SHORT_TRUNK = 6;

let FOREST: { ns: Needle[]; trunks: number[] } | null = null;
function forest() {
  if (FOREST) return FOREST;
  const r = mulberry(20210824);
  const out: Needle[] = [];
  const trunks: number[] = [];
  const add = (n: Omit<Needle, "cum" | "len"> & { len?: number }) => {
    const cum = cumOf(n.pts);
    out.push({ ...n, cum, len: cum[cum.length - 1] });
    return out.length - 1;
  };
  // crystalline: side branches leave at a consistent ~50 degrees, alternating, longest near the root
  // (a fir-tree silhouette), straight, each with a few short spikes of its own
  const branchOut = (pi: number, depth: number) => {
    const par = out[pi];
    const spacing = depth === 1 ? 62 : 20;
    let side = r() < 0.5 ? 1 : -1;
    for (let s = par.len * (depth === 1 ? 0.14 : 0.3) + r() * spacing * 0.5; s < par.len * (depth === 1 ? 0.82 : 0.8); s += spacing * (0.75 + 0.5 * r())) {
      if (depth === 2 && r() < 0.35) continue;
      const { p, dir } = pointAt(par, s);
      const rem = par.len - s;
      const L = depth === 1 ? Math.min(150, rem * (0.3 + 0.16 * r())) : Math.min(26, rem * (0.35 + 0.3 * r()));
      if (L < (depth === 1 ? 30 : 9)) continue;
      const ang = dir + side * (0.82 + 0.14 * r());
      side = -side;
      const w = par.w0 * Math.pow(1 - s / par.len, 0.62) * 0.62;
      const pts = walk(r, p[0], p[1], ang, L, depth === 1 ? 22 : 12, 0.08, 0);
      const bi = add({ pts, w0: Math.max(1.1, w), parent: pi, s0: s, k: depth === 1 ? 0.55 + 0.2 * r() : 0.8, ts: 0, te: 0, depth });
      if (depth === 1 && L > 50) branchOut(bi, 2);
    }
  };
  for (const tr of TRUNKS) {
    const ang = DOWN + tr.lean + (r() - 0.5) * 0.06;
    const pts = walk(r, tr.x + (r() - 0.5) * 24, -16, ang, tr.len + 16, 30, 0.12, 0.03);
    const ti = add({ pts, w0: tr.w, parent: -1, s0: 0, k: 1, ts: tr.ts, te: tr.te, depth: 0 });
    trunks.push(ti);
    branchOut(ti, 1);
  }
  // short spikes between the trunks (the plating crust bristles)
  for (let i = 0; i < 14; i++) {
    const x = 130 + i * 128 + (r() - 0.5) * 110;
    const L = 44 + r() * 70;
    const pts = walk(r, x, -10, DOWN + (r() - 0.5) * 0.4, L, 14, 0.12, 0);
    // these plate out first: by "metal" the top edge is already bristling with silver
    add({ pts, w0: 3.4 + r() * 1.8, parent: -1, s0: 0, k: 1, ts: r() * 0.1, te: 0.34 + r() * 0.2, depth: 0 });
  }
  FOREST = { ns: out, trunks };
  return FOREST;
}

// grown length of every needle at beat fraction u (0..1): a visible start, then accelerating
function grown(ns: Needle[], u: number): number[] {
  const g: number[] = new Array(ns.length).fill(0);
  ns.forEach((n, i) => {
    if (n.parent < 0) {
      const v = clamp01((u - n.ts) / (n.te - n.ts));
      g[i] = n.len * (0.38 * v + 0.62 * Math.pow(v, 2.5));
    } else {
      g[i] = Math.min(n.len, Math.max(0, (g[n.parent] - n.s0) * n.k));
    }
  });
  return g;
}

// tapered outline of a needle grown to length g (pointed tip, thicker root as it matures)
function outline(n: Needle, g: number, scale = 1, offset = 0): string | null {
  if (g < 1.5) return null;
  const { pts, cum } = n;
  const ps: P[] = [];
  const ss: number[] = [];
  for (let i = 0; i < pts.length && cum[i] < g; i++) {
    ps.push(pts[i]);
    ss.push(cum[i]);
  }
  ps.push(pointAt(n, g).p);
  ss.push(g);
  if (ps.length < 2) return null;
  const mature = 0.45 + 0.55 * clamp01(g / n.len);
  const w = n.w0 * mature * scale;
  const L: P[] = [], R: P[] = [];
  for (let i = 0; i < ps.length - 1; i++) {
    const a = ps[Math.max(0, i - 1)], b = ps[i + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const d = Math.hypot(dx, dy) || 1;
    const nx = -dy / d, ny = dx / d;
    const hw = Math.max(0.3, w * Math.pow(1 - ss[i] / g, 0.62));
    const ox = nx * offset * hw, oy = ny * offset * hw;
    L.push([ps[i][0] + nx * hw + ox, ps[i][1] + ny * hw + oy]);
    R.push([ps[i][0] - nx * hw + ox, ps[i][1] - ny * hw + oy]);
  }
  const tip = ps[ps.length - 1];
  const f = (p: P) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
  return `M${L.map(f).join(" L")} L${f(tip)} L${R.reverse().map(f).join(" L")} Z`;
}

// ---------- the arc: midpoint-displacement discharge, re-drawn every frame ----------
function bolt(seed: number, a: P, b: P, rough: number): P[] {
  const r = mulberry(seed);
  let pts: P[] = [a, b];
  for (let lv = 0; lv < 6; lv++) {
    const next: P[] = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1], q = pts[i];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const nx = -(q[1] - p[1]) / (len || 1), ny = (q[0] - p[0]) / (len || 1);
      const off = (r() - 0.5) * len * rough;
      next.push([(p[0] + q[0]) / 2 + nx * off, (p[1] + q[1]) / 2 + ny * off], q);
    }
    pts = next;
  }
  return pts;
}
const poly = (ps: P[]) => ps.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");

function arcEnd(seed: number, tip: P): P {
  const r = mulberry(seed * 7 + 3);
  return [tip[0] + (r() - 0.35) * 70, tip[1] + 250 + r() * 40];
}
function arcPaths(seed: number, tip: P): string[] {
  const r = mulberry(seed * 7 + 3);
  const end: P = [tip[0] + (r() - 0.35) * 70, tip[1] + 250 + r() * 40];
  const main = bolt(seed, tip, end, 0.42);
  const paths = [poly(main)];
  for (let k = 0; k < 3; k++) {
    const i = 8 + Math.floor(r() * (main.length - 20));
    const from = main[i];
    const ang = DOWN + (r() < 0.5 ? -1 : 1) * (0.5 + r() * 0.6);
    const L = 50 + r() * 90;
    paths.push(poly(bolt(seed + 11 * (k + 1), from, [from[0] + Math.cos(ang) * L, from[1] + Math.sin(ang) * L], 0.5)));
  }
  return paths;
}

export function Needles({ tl, t }: { tl: Timeline; t: number }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const nb = fxBeat(tl, "needles");
  if (!nb || t < nb.t - 0.05) return null;
  const tArc = fxT(tl, "arc") ?? nb.t + (nb.dur ?? 2.3) + 0.08;
  const tFire = fxT(tl, "fire") ?? tArc + 1.2;
  // the growth window runs from the beat to the arc, so the longest needle bottoms out on "short"
  const T0 = nb.t, T1 = tArc;
  const fadeOut = prog(t, tFire - 0.35, 0.9);
  if (fadeOut >= 1) return null;
  const u = clamp01((t - T0) / (T1 - T0));
  const { ns, trunks } = forest();
  const g = grown(ns, u);
  const f = Math.round(t * FPS);
  const fArc = Math.ceil(tArc * FPS - 1e-6); // first frame at/after the word: the same frame the global shake starts
  const k = f - fArc;
  const sinceArc = t - fArc / FPS;
  // heat after the short: white-hot for a frame, then orange, cooling over ~1 s
  const hot = k >= 0 ? (k <= 1 ? 1 : 0.95 * Math.exp(-(sinceArc - 0.066) / 0.6)) : 0;
  const white = k === 0 ? 0.9 : k === 1 ? 0.5 : 0;
  const cool = clamp01((sinceArc - 0.07) / 0.9);
  const heatCol = `rgb(${Math.round(255 - 95 * cool)},${Math.round(176 - 130 * cool)},${Math.round(104 - 76 * cool)})`;
  const char = k >= 0 ? 0.62 * prog(t, tArc + 0.15, 0.9) : 0;
  // the crust along the top edge thickens as the metal plates out
  const crust = Math.pow(clamp01(u / 0.3), 0.7) * (0.55 + 0.45 * u);
  const r = mulberry(77);
  const crustPts: P[] = [];
  for (let x = -40; x <= 1960; x += 32) crustPts.push([x, (9 + 14 * r() + 6 * Math.sin(x / 130)) * crust]);
  const crustD = `M-40 -20 L${crustPts.map((p) => `${p[0]} ${p[1].toFixed(1)}`).join(" L")} L1960 -20 Z`;
  const main = ns.map((n, i) => outline(n, g[i]));
  // round-rod shading: a dark flank on the right, a bright ridge on the left (light from the upper left)
  const flank = ns.map((n, i) => (n.depth < 2 ? outline(n, g[i], 0.45, -0.8) : null));
  const ridge = ns.map((n, i) => (n.depth < 2 ? outline(n, g[i], 0.3, 0.85) : null));
  // the trunk tips that are still growing glow softly (cool white), brighter as they speed up
  const tips: { p: P; a: number; r: number }[] = [];
  trunks.forEach((i) => {
    const n = ns[i];
    if (g[i] < 4 || g[i] >= n.len - 0.5 || u >= 1) return;
    tips.push({ p: pointAt(n, g[i]).p, a: 0.3 + 0.4 * u, r: 6 + 4 * u });
  });
  const st = trunks[SHORT_TRUNK];
  const shortTip = pointAt(ns[st], g[st]).p;
  const sheen = (t - T0) * 120;
  const scrim = prog(t, T0 - 0.2, 0.9) * (1 - fadeOut);
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {/* the light drops a little from the top so the silver reads against the bright plate */}
      <div style={{ position: "absolute", inset: 0, opacity: scrim, background: "linear-gradient(180deg, rgba(6,8,12,0.62) 0%, rgba(6,8,12,0.34) 32%, rgba(6,8,12,0.08) 62%, transparent 78%)" }} />
      <svg width={1920} height={1080} style={{ position: "absolute", left: 0, top: 0, opacity: 1 - fadeOut }}>
        <defs>
          <linearGradient id={`metal${uid}`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="230" y2="150" spreadMethod="repeat" gradientTransform={`translate(${sheen} 0)`}>
            <stop offset="0" stopColor="#8D97A5" />
            <stop offset="0.2" stopColor="#E6ECF3" />
            <stop offset="0.32" stopColor="#AEB8C5" />
            <stop offset="0.56" stopColor="#F7FAFF" />
            <stop offset="0.72" stopColor="#9EA8B6" />
            <stop offset="1" stopColor="#8D97A5" />
          </linearGradient>
          <radialGradient id={`tip${uid}`}>
            <stop offset="0" stopColor="#F4F9FF" stopOpacity="1" />
            <stop offset="0.35" stopColor="#BFD9FF" stopOpacity="0.45" />
            <stop offset="1" stopColor="#9CC4FF" stopOpacity="0" />
          </radialGradient>
          <filter id={`sh${uid}`} x="-10%" y="-10%" width="120%" height="120%">
            <feGaussianBlur stdDeviation="2.6" />
          </filter>
          <filter id={`glow${uid}`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
        </defs>
        {/* contact shadow: lifts the metal off the plate */}
        <g filter={`url(#sh${uid})`} transform="translate(3 6)" opacity="0.6" fill="#04060A">
          <path d={crustD} />
          {main.map((d, i) => (d ? <path key={i} d={d} /> : null))}
        </g>
        <path d={crustD} fill={`url(#metal${uid})`} stroke="rgba(14,18,26,0.75)" strokeWidth="1" />
        <g fill={`url(#metal${uid})`} stroke="rgba(12,16,24,0.8)" strokeWidth="1.2" strokeLinejoin="round">
          {main.map((d, i) => (d ? <path key={i} d={d} /> : null))}
        </g>
        <g fill="#454E5B" opacity="0.6">
          {flank.map((d, i) => (d ? <path key={i} d={d} /> : null))}
        </g>
        <g fill="#FFFFFF" opacity="0.8">
          {ridge.map((d, i) => (d ? <path key={i} d={d} /> : null))}
        </g>
        {k >= 0 ? (
          <g>
            {/* after the short the metal is white-hot for a frame, then glows orange, cools to dull red and chars */}
            <g fill="#1A1716" opacity={char}>
              {main.map((d, i) => (d ? <path key={i} d={d} /> : null))}
            </g>
            {hot > 0.005 ? (
              <>
                <g fill={white > 0 ? "#FFFFFF" : heatCol} opacity={white > 0 ? white : hot * 0.72}>
                  {main.map((d, i) => (d ? <path key={i} d={d} /> : null))}
                </g>
                <g filter={`url(#glow${uid})`} fill={white > 0 ? "#DCEBFF" : "#FF6A1E"} opacity={hot} style={{ mixBlendMode: "screen" }}>
                  {main.map((d, i) => (d ? <path key={i} d={d} /> : null))}
                </g>
              </>
            ) : null}
          </g>
        ) : null}
        {tips.map((tp, i) => (
          <circle key={i} cx={tp.p[0]} cy={tp.p[1]} r={tp.r} fill={`url(#tip${uid})`} opacity={tp.a * (1 - fadeOut)} style={{ mixBlendMode: "screen" }} />
        ))}
      </svg>
      <Arc k={k} sinceArc={sinceArc} fArc={fArc} tip={shortTip} uid={uid} />
    </div>
  );
}

function Arc({ k, sinceArc, fArc, tip, uid }: { k: number; sinceArc: number; fArc: number; tip: P; uid: string }) {
  if (k < 0 || sinceArc > 1.2) return null;
  const bright = k === 0 ? 1 : k === 1 ? 0.78 : k === 2 ? 0.42 : 0;
  // afterglow: the first frame's path lingers on the eye as a faint violet trace
  const trace = k >= 3 ? 0.4 * Math.exp(-(k - 3) / 2.2) : 0;
  const paths = bright > 0 ? arcPaths(fArc + k, tip) : trace > 0.01 ? arcPaths(fArc, tip) : [];
  const flash = k === 0 ? 0.62 : k === 1 ? 0.26 : k === 2 ? 0.08 : 0;
  const end = arcEnd(fArc + Math.min(k, 2), tip);
  const bloom = k <= 2 ? [1, 0.85, 0.6][k] : 0.55 * Math.exp(-(sinceArc - 0.1) / 0.35);
  return (
    <>
      {flash > 0 ? <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 90% 90% at 53% 50%, #F4F8FF 0%, #DCE9FF 55%, #BCD3F5 100%)", opacity: flash, mixBlendMode: "screen" }} /> : null}
      <svg width={1920} height={1080} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
        <defs>
          <filter id={`ab${uid}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
          <radialGradient id={`bl${uid}`}>
            <stop offset="0" stopColor="#FFFFFF" stopOpacity="1" />
            <stop offset="0.2" stopColor="#D6E8FF" stopOpacity="0.75" />
            <stop offset="0.55" stopColor="#7FB2FF" stopOpacity="0.22" />
            <stop offset="1" stopColor="#5C8FE0" stopOpacity="0" />
          </radialGradient>
        </defs>
        {bloom > 0.01 ? <circle cx={tip[0]} cy={tip[1]} r={k <= 2 ? 150 : 90} fill={`url(#bl${uid})`} opacity={bloom} style={{ mixBlendMode: "screen" }} /> : null}
        {/* where it lands: the short closes the circuit */}
        {bright > 0 ? <circle cx={end[0]} cy={end[1]} r={70} fill={`url(#bl${uid})`} opacity={bright * 0.8} style={{ mixBlendMode: "screen" }} /> : null}
        {bright > 0 ? (
          <g fill="none" strokeLinecap="round" strokeLinejoin="round">
            {/* normal blend: on the bright plate a screen glow would vanish; the blue has to read */}
            <g filter={`url(#ab${uid})`} stroke="#4F8DFF" opacity={0.7 * bright}>
              {paths.map((d, i) => <path key={i} d={d} strokeWidth={i ? 12 : 24} />)}
            </g>
            <g stroke="#CFE5FF" opacity={bright}>
              {paths.map((d, i) => <path key={i} d={d} strokeWidth={i ? 3.4 : 7} />)}
            </g>
            <g stroke="#FFFFFF" opacity={bright}>
              {paths.map((d, i) => <path key={i} d={d} strokeWidth={i ? 1.4 : 3} />)}
            </g>
          </g>
        ) : trace > 0.01 ? (
          <g fill="none" stroke="#9C8CFF" strokeLinecap="round" strokeLinejoin="round" opacity={trace} filter={`url(#ab${uid})`} style={{ mixBlendMode: "screen" }}>
            {paths.map((d, i) => <path key={i} d={d} strokeWidth={i ? 3 : 6} />)}
          </g>
        ) : null}
      </svg>
    </>
  );
}
