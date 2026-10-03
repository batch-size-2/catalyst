import { useId } from "react";
import { staticFile } from "remotion";
import type { Timeline } from "../core";
import { clamp01, fxT, inOut, lerp, plateToScreen, plateXf, prog, springAt } from "../state";
import { C, MONO, glass, lbl } from "../theme";

// ---------- the hexagon mark, drawing itself ----------
const HEX = "M12 38 L15 9 L27 19 L37 19 L49 9 L52 38 L42 55 L22 55 Z";
export function Mark({ t, t0, tOut, size = 60, x = 960, y = 70 }: { t: number; t0: number; tOut: number; size?: number; x?: number; y?: number }) {
  const d = prog(t, t0, 1.1, inOut);
  const f = prog(t, t0 + 0.8, 0.5);
  const o = 1 - prog(t, tOut, 0.6);
  if (t < t0 || o <= 0) return null;
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} style={{ position: "absolute", left: x - size / 2, top: y - size / 2, opacity: o, overflow: "visible" }}>
      <path d={HEX} fill={C.orange} fillOpacity={f} stroke={C.orange} strokeWidth="3" strokeLinejoin="round" pathLength={1} strokeDasharray="1" strokeDashoffset={1 - d} />
      <g opacity={f}>
        <rect x="22.5" y="31" width="5" height="10" rx="2.5" fill={C.bg} />
        <rect x="36.5" y="31" width="5" height="10" rx="2.5" fill={C.bg} />
        <path d="M29.5 45 L34.5 45 L32 48 Z" fill={C.bg} />
      </g>
      <path d="M10 41 L1 38 M10 46 L2 49 M54 41 L63 38 M54 46 L62 49" stroke={C.orange} strokeWidth="2.5" strokeLinecap="round" fill="none" opacity={f} />
    </svg>
  );
}

// ---------- the dive: car -> pack -> cell -> anode -> micrograph ----------
const P: [number, number] = [963.1, 595];
const ZMAX = 620;
const NS = { vectorEffect: "non-scaling-stroke" as const };

function Dive({ tl, t, tCar, tDive, dur, tOut }: { tl: Timeline; t: number; tCar: number; tDive: number; dur: number; tOut: number }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  if (t < tCar) return null;
  const o = 1 - prog(t, tOut, 0.9, inOut);
  if (o <= 0) return null;
  const draw = prog(t, tCar, 1.0, inOut);
  const u = prog(t, tDive, dur, inOut);
  const z = Math.exp(u * Math.log(ZMAX));
  const lz = Math.log(z) / Math.log(ZMAX);
  const ps = [lerp(P[0], 960, u), lerp(P[1], 540, u)];
  const tr = `translate(${ps[0]} ${ps[1]}) scale(${z}) translate(${-P[0]} ${-P[1]})`;
  const ink = "rgba(237,236,232,0.75)";
  const dash = { pathLength: 1, strokeDasharray: 1, strokeDashoffset: 1 - draw };
  // the anode layers are windows onto the real plate (full brightness), so at full zoom they *are* the background
  const { k, dx, dy } = plateXf(tl, t);
  const cells = Array.from({ length: 16 }, (_, i) => 740 + i * 26.25 + 2);
  const bell = (a: number, b: number) => clamp01((lz - a) / 0.06) * clamp01((b - lz) / 0.06);
  const toScreen = (wx: number, wy: number) => [(wx - P[0]) * z + ps[0], (wy - P[1]) * z + ps[1]];
  const tag = (text: string, wx: number, wy: number, a: number) => {
    if (a <= 0.01) return null;
    const [sx, sy] = toScreen(wx, wy);
    return (
      <div style={{ position: "absolute", left: sx, top: sy, transform: "translate(-50%, -100%)", opacity: a, ...lbl, fontSize: 15, color: C.text, padding: "8px 14px", borderRadius: 10, ...glass }}>
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
          <clipPath id={`win${uid}`} clipPathUnits="userSpaceOnUse">
            <rect x={952.5} y={594} width={21.25} height={2} transform={tr} />
            <rect x={952.5} y={600} width={21.25} height={2} transform={tr} />
          </clipPath>
        </defs>
        <g clipPath={`url(#win${uid})`} opacity={clamp01((lz - 0.25) / 0.15)}>
          <image
            href={staticFile("bg/micro_grey.jpg")}
            x={960 - 960 * k + dx}
            y={540 - 540 * k + dy}
            width={1920 * k}
            height={1080 * k}
            preserveAspectRatio="none"
            style={{ filter: "brightness(0.92)" }}
          />
        </g>
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
            <rect key={i} x={x} y={587} width={22.25} height={16} rx={1.2} fill={i === 8 ? "rgba(10,11,13,0.7)" : "rgba(255,255,255,0.02)"} stroke={i === 8 ? C.orange : "rgba(255,154,92,0.55)"} strokeWidth="1.2" {...NS} opacity={prog(t, tCar + 0.8, 0.6)} />
          ))}
          {/* inside the focus cell: anode / separator / cathode layers */}
          <g opacity={clamp01((lz - 0.25) / 0.15)}>
            {[588.6, 597.2].map((y) => (
              <g key={y}>
                <rect x={952.5} y={y} width={21.25} height={2.2} fill="#17181C" stroke="rgba(237,236,232,0.22)" strokeWidth="1" {...NS} />
                <rect x={952.5} y={y} width={21.25} height={2.2} fill={`url(#dots${uid})`} />
              </g>
            ))}
            {[591.9, 596.4, 599.8].map((y) => (
              <rect key={y} x={952.5} y={y} width={21.25} height={0.12} fill="rgba(237,236,232,0.2)" />
            ))}
            <rect x={952.5} y={594} width={21.25} height={2} fill="none" stroke={C.orange} strokeWidth="1.2" {...NS} />
            <rect x={952.5} y={600} width={21.25} height={2} fill="none" stroke="rgba(237,236,232,0.3)" strokeWidth="1" {...NS} />
          </g>
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
        const [x, y] = plateToScreen(tl, t, s.px, s.py);
        const lx = x + s.ox, ly = y + s.oy;
        const line = prog(t, t0 + 0.1, 0.5);
        return (
          <div key={s.id} style={{ position: "absolute", inset: 0, opacity: a }}>
            <svg width={1920} height={1080} style={{ position: "absolute", left: 0, top: 0 }}>
              <circle cx={x} cy={y} r={26} fill="none" stroke={s.color} strokeWidth="2.5" opacity="0.95" />
              <circle cx={x} cy={y} r={4} fill={s.color} />
              <line x1={x + (s.ox / Math.hypot(s.ox, s.oy)) * 28} y1={y + (s.oy / Math.hypot(s.ox, s.oy)) * 28} x2={lerp(x, lx, line)} y2={lerp(y, ly, line)} stroke={s.color} strokeWidth="2" />
            </svg>
            <div
              style={{
                position: "absolute",
                left: lx,
                top: ly,
                transform: `translate(${s.ox < 0 ? "-100%" : "0"}, -50%)`,
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
  const tCar = fxT(tl, "car") ?? Infinity;
  const dive = tl.beats.find((b) => b.fx === "dive");
  const tHero = tl.beats.find((b) => b.bg === "hero-grey")?.t ?? Infinity;
  const ts = fxT(tl, "swell");
  return (
    <>
      <Dive tl={tl} t={t} tCar={tCar} tDive={dive?.t ?? Infinity} dur={dive?.dur ?? 3} tOut={tHero} />
      <Labels tl={tl} t={t} />
      {ts != null ? <Swell t={t} t0={ts} /> : null}
      <Mark t={t} t0={fxT(tl, "mark") ?? Infinity} tOut={fxT(tl, "mark-out") ?? Infinity} />
    </>
  );
}
