import type { CSSProperties } from "react";
import { useId } from "react";
import { Img, staticFile } from "remotion";
import type { Timeline } from "../core";
import { clamp01, fxBeat, fxT, inOut, lerp, plateToScreen, plateXf, prog, sp, springAt, wobble } from "../state";
import { C, MONO, SPRING, SPRING_POP, glass, lbl } from "../theme";
import { Bloom, CatMark } from "./scienceMark";
import { Fire } from "./scienceFire";
import { Needles } from "./scienceMetal";

// ---------- "I'm Catalyst": the mark draws itself big and centred, then travels up and leaves ----------
function IntroMark({ tl, t }: { tl: Timeline; t: number }) {
  const t0 = fxT(tl, "mark");
  if (t0 == null || t < t0) return null;
  const tCar = fxT(tl, "car") ?? t0 + 1.05;
  const hero = tl.beats.find((b) => b.bg === "hero-grey");
  const tOut = (hero?.t ?? t0 + 4) - 0.32;
  const out = prog(t, tOut, 0.42, inOut);
  if (out >= 1) return null;
  const draw = prog(t, t0, 0.58, inOut);
  const tFill = t0 + 0.46;
  const fill = sp(t, tFill, SPRING_POP);
  const eyes = sp(t, t0 + 0.6, SPRING_POP);
  const whisk = prog(t, t0 + 0.52, 0.32);
  // it clicks into place when it fills: a small scale pop that rings out
  const pop = 1 + 0.06 * wobble(t, tFill, 2.4, 6);
  const mv = sp(t, tCar - 0.1, SPRING);
  const size = lerp(300, 60, mv) * pop * (1 - 0.35 * out);
  const x = 960;
  const y = lerp(450, 96, mv) - 10 * out;
  const bloom = clamp01(fill) * (0.45 + 0.55 * Math.exp(-Math.max(0, t - tFill) * 2.2)) * lerp(1, 0.55, mv) * (1 - out);
  // a breath of drawing light before the fill (the pen glows as it travels)
  const pen = 1 - prog(t, t0 + 0.5, 0.15);
  return (
    <>
      <Bloom x={x} y={y + size * 0.05} r={size * 1.25} a={bloom} />
      <div style={{ position: "absolute", left: x - size / 2, top: y - size / 2, width: size, height: size, opacity: 1 - out, filter: out > 0.02 ? `blur(${out * 4}px)` : undefined }}>
        <CatMark size={size} s={{ draw, fill, eyes, whisk, pen }} stroke={2.6} />
      </div>
    </>
  );
}

// ---------- the dive: car -> pack -> cell -> anode -> micrograph ----------
const P: [number, number] = [963.1, 595];
const ZMAX = 620;
const NS = { vectorEffect: "non-scaling-stroke" as const };
const fill: CSSProperties = { position: "absolute", left: 0, top: 0, width: 1920, height: 1080 };

// The bright grey plate exactly as Background draws it in "hero-grey" (same Ken Burns, filter, grid,
// vignette and caption scrim), so when the anode window fills the frame it *is* the next background.
function PlateReplica({ tl, t }: { tl: Timeline; t: number }) {
  const { k, dx, dy } = plateXf(tl, t);
  return (
    <>
      <div style={{ ...fill, transform: `translate(${dx}px, ${dy}px) scale(${k})`, filter: "brightness(0.92)" }}>
        <Img src={staticFile("bg/micro_grey.jpg")} style={{ ...fill, objectFit: "cover" }} onError={() => undefined} />
      </div>
      <div style={{ ...fill, backgroundImage: `linear-gradient(${C.grid} 1px, transparent 1px), linear-gradient(90deg, ${C.grid} 1px, transparent 1px)`, backgroundSize: "32px 32px" }} />
      <div style={{ ...fill, background: "radial-gradient(ellipse 75% 70% at 50% 45%, transparent 45%, rgba(5,6,8,0.78) 100%)" }} />
      <div style={{ ...fill, background: "linear-gradient(0deg, rgba(10,11,13,0.82) 0px, rgba(10,11,13,0.55) 150px, transparent 300px)" }} />
    </>
  );
}

function Dive({ tl, t }: { tl: Timeline; t: number }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const tCar = fxT(tl, "car") ?? Infinity;
  const dv = fxBeat(tl, "dive");
  const tDive = dv?.t ?? Infinity;
  const dur = dv?.dur ?? 3;
  const hero = tl.beats.find((b) => b.bg === "hero-grey");
  // hand over only once the real background has fully become the bright plate (no dip in between)
  const tOut = Math.max((hero?.t ?? tDive + dur) + (hero?.dur ?? 0.55), tDive + dur);
  if (t < tCar) return null;
  const o = 1 - prog(t, tOut, 0.5, inOut);
  if (o <= 0) return null;
  const draw = prog(t, tCar, 1.0, inOut);
  const u = prog(t, tDive, dur, inOut);
  const z = Math.exp(u * Math.log(ZMAX));
  const lz = Math.log(z) / Math.log(ZMAX);
  const ps = [lerp(P[0], 960, u), lerp(P[1], 540, u)];
  const tr = `translate(${ps[0]} ${ps[1]}) scale(${z}) translate(${-P[0]} ${-P[1]})`;
  const ink = "rgba(237,236,232,0.75)";
  const dash = { pathLength: 1, strokeDasharray: 1, strokeDashoffset: 1 - draw };
  const cells = Array.from({ length: 16 }, (_, i) => 740 + i * 26.25 + 2);
  const bell = (a: number, b: number) => clamp01((lz - a) / 0.06) * clamp01((b - lz) / 0.06);
  const toScreen = (wx: number, wy: number): [number, number] => [(wx - P[0]) * z + ps[0], (wy - P[1]) * z + ps[1]];
  const layersIn = clamp01((lz - 0.25) / 0.15);
  // the two electrode layers are windows onto the real plate
  const win = (wy: number, h: number) => {
    const [x0, y0] = toScreen(952.5, wy);
    const [x1, y1] = toScreen(952.5 + 21.25, wy + h);
    const a = Math.max(-2, x0), b = Math.max(-2, y0), c = Math.min(1922, x1), d = Math.min(1082, y1);
    if (c <= a || d <= b) return null;
    return (
      <div key={wy} style={{ ...fill, clipPath: `inset(${b}px ${1920 - c}px ${1080 - d}px ${a}px)`, opacity: layersIn }}>
        <PlateReplica tl={tl} t={t} />
      </div>
    );
  };
  const tag = (text: string, wx: number, wy: number, a: number) => {
    if (a <= 0.01) return null;
    const [sx, sy] = toScreen(wx, wy);
    return (
      <div style={{ position: "absolute", left: sx, top: sy, transform: `translate(-50%, -100%) translateY(${(1 - a) * 6}px)`, opacity: a, ...lbl, fontSize: 15, color: C.text, padding: "8px 14px", borderRadius: 10, ...glass }}>
        {text}
      </div>
    );
  };
  return (
    <div style={{ position: "absolute", inset: 0, opacity: o }}>
      <svg width={1920} height={1080} style={{ position: "absolute", left: 0, top: 0 }}>
        <defs>
          <pattern id={`dots${uid}`} patternUnits="userSpaceOnUse" width="0.34" height="0.3">
            <circle cx="0.1" cy="0.08" r="0.05" fill="rgba(237,236,232,0.07)" />
            <circle cx="0.27" cy="0.23" r="0.035" fill="rgba(237,236,232,0.05)" />
          </pattern>
        </defs>
        <g transform={tr}>
          {/* car */}
          <path d="M520 610 L540 540 Q560 500 640 492 L770 488 Q830 418 905 410 L1080 410 Q1160 414 1222 480 L1340 500 Q1400 512 1405 560 L1408 610 Z" fill="rgba(10,11,13,0.55)" stroke={ink} strokeWidth="2.2" strokeLinejoin="round" {...NS} {...dash} />
          <path d="M800 486 Q845 436 905 430 L1000 430 L1000 486 Z M1020 430 L1075 430 Q1135 434 1180 482 L1020 486 Z" fill="none" stroke="rgba(237,236,232,0.4)" strokeWidth="1.6" {...NS} {...dash} />
          {[660, 1240].map((cx) => (
            <g key={cx}>
              <circle cx={cx} cy={615} r={60} fill={C.bg} stroke={ink} strokeWidth="2.2" {...NS} {...dash} />
              <circle cx={cx} cy={615} r={24} fill="none" stroke="rgba(237,236,232,0.35)" strokeWidth="1.5" {...NS} opacity={draw} />
            </g>
          ))}
          {/* battery pack in the floor */}
          <rect x={740} y={585} width={420} height={20} rx={3} fill="rgba(255,122,47,0.08)" stroke={C.orange} strokeWidth="1.8" {...NS} opacity={prog(t, tCar + 0.6, 0.6)} />
          {cells.map((x, i) => (
            <rect key={i} x={x} y={587} width={22.25} height={16} rx={1.2} fill={i === 8 ? "rgba(10,11,13,0.7)" : "rgba(255,255,255,0.02)"} stroke={i === 8 ? C.orange : "rgba(255,154,92,0.55)"} strokeWidth="1.2" {...NS} opacity={prog(t, tCar + 0.8 + Math.abs(i - 8) * 0.02, 0.5)} />
          ))}
          {/* inside the focus cell: the dark current collectors */}
          <g opacity={layersIn}>
            {[588.6, 597.2].map((y) => (
              <g key={y}>
                <rect x={952.5} y={y} width={21.25} height={2.2} fill="#17181C" stroke="rgba(237,236,232,0.22)" strokeWidth="1" {...NS} />
                <rect x={952.5} y={y} width={21.25} height={2.2} fill={`url(#dots${uid})`} />
              </g>
            ))}
          </g>
        </g>
      </svg>
      {/* the electrode windows sit above the car and cell fills, so the plate inside is never dimmed */}
      {layersIn > 0 ? [win(594, 2), win(600, 2)] : null}
      <svg width={1920} height={1080} style={{ position: "absolute", left: 0, top: 0 }}>
        <g transform={tr} opacity={layersIn}>
          {[591.9, 596.4, 599.8].map((y) => (
            <rect key={y} x={952.5} y={y} width={21.25} height={0.12} fill="rgba(237,236,232,0.2)" />
          ))}
          <rect x={952.5} y={594} width={21.25} height={2} fill="none" stroke={C.orange} strokeWidth="1.2" {...NS} />
          <rect x={952.5} y={600} width={21.25} height={2} fill="none" stroke="rgba(237,236,232,0.3)" strokeWidth="1" {...NS} />
        </g>
      </svg>
      {tag("battery pack", 950, 583, bell(0.12, 0.34))}
      {tag("one cell", 963, 586, bell(0.42, 0.6))}
      {tag("anode", 963, 593.6, bell(0.7, 0.9))}
    </div>
  );
}

// ---------- phase labels pinned to the plate ----------
type Spot = { id: string; text: string; color: string; px: number; py: number; ox: number; oy: number };
const SPOTS: Spot[] = [
  { id: "graphite", text: "Graphite", color: "#B9BBC0", px: 1300, py: 1000, ox: -150, oy: -150 },
  { id: "silicon", text: "Silicon", color: C.si, px: 2152, py: 560, ox: 150, oy: -120 },
  { id: "pore", text: "Pore", color: C.pore, px: 1050, py: 380, ox: -160, oy: 110 },
];

function Labels({ tl, t }: { tl: Timeline; t: number }) {
  const tOut = fxT(tl, "labels-out") ?? Infinity;
  const out = prog(t, tOut, 0.6);
  return (
    <>
      {SPOTS.map((s) => {
        const t0 = fxT(tl, `label-${s.id}`);
        if (t0 == null || t < t0 || out >= 1) return null;
        const a = springAt(t, t0 + 0.15) * (1 - out);
        const ring = sp(t, t0, SPRING_POP);
        const [x, y] = plateToScreen(tl, t, s.px, s.py);
        const lx = x + s.ox, ly = y + s.oy;
        const line = prog(t, t0 + 0.1, 0.5);
        return (
          <div key={s.id} style={{ position: "absolute", inset: 0, opacity: a }}>
            <svg width={1920} height={1080} style={{ position: "absolute", left: 0, top: 0 }}>
              <circle cx={x} cy={y} r={26 * Math.max(0.2, ring)} fill="none" stroke={s.color} strokeWidth="2.5" opacity="0.95" />
              <circle cx={x} cy={y} r={4} fill={s.color} />
              <line x1={x + (s.ox / Math.hypot(s.ox, s.oy)) * 28} y1={y + (s.oy / Math.hypot(s.ox, s.oy)) * 28} x2={lerp(x, lx, line)} y2={lerp(y, ly, line)} stroke={s.color} strokeWidth="2" />
            </svg>
            <div
              style={{
                position: "absolute",
                left: lx,
                top: ly,
                transform: `translate(${s.ox < 0 ? "-100%" : "0"}, -50%) translateY(${(1 - a) * 8}px)`,
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 16px",
                borderRadius: 12,
                ...glass,
                background: "rgba(14,15,18,0.72)",
                ...lbl,
                fontSize: 16,
                color: C.textStrong,
              }}
            >
              <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color }} />
              {s.text}
            </div>
          </div>
        );
      })}
    </>
  );
}

// ---------- one silicon particle swelling on charge ----------
function Swell({ t, t0 }: { t: number; t0: number }) {
  const a = springAt(t, t0) * (1 - prog(t, t0 + 2.5, 0.45));
  if (t < t0 || a <= 0.001) return null;
  const scale = 1.25 - 0.25 * Math.cos(clamp01((t - t0 - 0.2) / 2.4) * Math.PI * 4);
  const flakes = [
    "M10 30 L70 18 L96 44 L40 62 Z", "M180 14 L262 26 L250 64 L170 52 Z", "M8 120 L58 96 L84 150 L20 170 Z",
    "M196 120 L270 104 L274 168 L206 172 Z", "M100 170 L170 160 L178 196 L96 198 Z", "M110 8 L160 6 L150 30 L104 34 Z",
  ];
  return (
    <div style={{ position: "absolute", left: 1490, top: 470, width: 330, padding: "18px 20px 16px", borderRadius: 22, ...glass, background: "rgba(14,15,18,0.7)", opacity: a, transform: `translateY(${(1 - a) * 16}px)` }}>
      <div style={{ ...lbl }}>Silicon on charge</div>
      <svg viewBox="0 0 284 200" width={290} height={204} style={{ marginTop: 10 }}>
        {flakes.map((d, i) => (
          <path key={i} d={d} fill="#6B6E75" stroke="#9A9DA3" strokeWidth="1.5" transform={`translate(${(i % 2 ? 1 : -1) * (scale - 1) * 18} 0)`} />
        ))}
        <g transform={`translate(142 102) scale(${scale})`}>
          <path d="M-34 -10 Q-30 -34 -4 -36 Q26 -36 34 -12 Q40 14 18 30 Q-8 40 -28 24 Q-40 10 -34 -10 Z" fill={C.si} stroke="#FFD2A6" strokeWidth={1.5 / scale} />
        </g>
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", font: `500 15px ${MONO}`, color: C.muted, marginTop: 4 }}>
        <span>empty → full</span>
        <span style={{ color: C.orangeText }}>×{scale.toFixed(2)}</span>
      </div>
    </div>
  );
}

export function Science({ tl, t }: { tl: Timeline; t: number }) {
  const sc = tl.scenes.find((s) => s.id === "science");
  if (!sc || t < sc.start - 0.5 || t > sc.end + 2.5) return null;
  const ts = fxT(tl, "swell");
  return (
    <>
      <Dive tl={tl} t={t} />
      <Labels tl={tl} t={t} />
      {ts != null ? <Swell t={t} t0={ts} /> : null}
      <Needles tl={tl} t={t} />
      <Fire tl={tl} t={t} />
      <IntroMark tl={tl} t={t} />
    </>
  );
}
