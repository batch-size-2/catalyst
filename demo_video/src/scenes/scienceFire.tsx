// "start a fire": warm ember light rising from the bottom of the frame (light, not drawn flames),
// soft heat plumes, a few sparse rising sparks; then "burn-down": the embers die to dark while the
// window rises out of the last of the glow (the fire's warmth hands over to the window's orange edge).
import type { Timeline } from "../core";
import { clamp01, fxT, inOut, prog, sp, winToScreen, windowAt } from "../state";
import { SPRING_POP, SPRING_SOFT, WIN } from "../theme";

const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
// slow, organic intensity wobble (sum of incommensurate sines; deterministic)
const breathe = (t: number) => 1 + 0.055 * Math.sin(t * 6.1) + 0.035 * Math.sin(t * 10.7 + 1.3) + 0.025 * Math.sin(t * 17.3 + 2.1);

// the FIRE word owns the centre (HeroType, ~y 357-582): sparks fade as they near it
const TEXT = { x0: 600, x1: 1320, y0: 330, y1: 610 };

type Spark = { t0: number; x0: number; y0: number; v: number; acc: number; drift: number; sway: number; ph: number; life: number; r: number };
function sparks(tf: number, tStop: number): Spark[] {
  const out: Spark[] = [];
  const n = 26;
  for (let i = 0; i < n; i++) {
    const a = hash(i * 3.17 + 1), b = hash(i * 5.31 + 2), c = hash(i * 7.77 + 3), d = hash(i * 9.13 + 4);
    // spawn times spread over the fire, denser early; positions away from the centre line
    const t0 = tf + 0.05 + Math.pow(i / n, 1.15) * (tStop - tf - 0.05) + (a - 0.5) * 0.08;
    const side = i % 2 ? 1 : -1;
    const x0 = 960 + side * (120 + 760 * Math.pow(b, 0.8));
    out.push({
      t0,
      x0,
      y0: 960 + c * 150,
      v: 190 + 280 * d,
      acc: 40 + 90 * a,
      drift: (b - 0.5) * 70 - side * 20,
      sway: 6 + 16 * c,
      ph: a * 6.28,
      life: 1.0 + 0.9 * hash(i * 2.71 + 5),
      r: 1.6 + 2.8 * Math.pow(hash(i * 4.4 + 6), 1.6),
    });
  }
  return out;
}

function sparkColor(age: number): string {
  // white-gold when fresh, through amber, to a dull red as it dies
  const stops: [number, number[]][] = [[0, [255, 241, 205]], [0.3, [255, 190, 104]], [0.65, [255, 120, 46]], [1, [190, 52, 22]]];
  let i = 1;
  while (i < stops.length - 1 && stops[i][0] < age) i++;
  const [a0, c0] = stops[i - 1], [a1, c1] = stops[i];
  const k = clamp01((age - a0) / (a1 - a0));
  return `rgb(${c0.map((v, j) => Math.round(v + (c1[j] - v) * k)).join(",")})`;
}

export function Fire({ tl, t }: { tl: Timeline; t: number }) {
  const tf = fxT(tl, "fire");
  if (tf == null || t < tf - 0.05) return null;
  const tb = fxT(tl, "burn-down") ?? tf + 1.1;
  if (t > tb + 2.1) return null;
  const rise = sp(t, tf, SPRING_SOFT);
  // burns down slowly at first, so the warmth is still there while the window rises through it
  const die = prog(t, tb, 1.35, inOut);
  const I = Math.max(0, rise * (1 - die)) * breathe(t);
  // the glow climbs as the fire takes, then sinks as it burns down
  const cy = 112 - 18 * rise + 16 * die;
  const w = windowAt(tl, t);
  // the last warmth gathers under the window's lower edge as it rises, then lets go
  let hand = 0;
  let hx = 960, hy = 1200, hw = 900;
  if (w.visible) {
    const [bx, by] = winToScreen(tl, t, WIN.x + WIN.w / 2, WIN.y + WIN.h);
    hx = bx;
    hy = by;
    hw = WIN.w * w.scale * 0.6;
    hand = prog(t, w.tin, 0.3) * (1 - prog(t, w.tin + 0.45, 1.2, inOut));
  }
  const hb = tl.beats.find((b) => b.hero && b.scene === "science");
  const hw0 = hb?.heroTimes?.[0] ?? Infinity;
  const halo = clamp01(sp(t, hw0 - 0.03, SPRING_POP)) * (1 - prog(t, hb?.heroEnd ?? hw0 + 1.1, 0.45)) * breathe(t * 0.7);
  const tStop = tb + 0.15;
  const list = sparks(tf, tStop);
  // three pools of firelight along the bottom edge, each breathing on its own (never one spotlight)
  const pools = [
    { x: 22, w: 34, f: 5.3, ph: 0.4, a: 0.8 },
    { x: 54, w: 42, f: 4.1, ph: 2.2, a: 1.0 },
    { x: 83, w: 32, f: 6.7, ph: 4.1, a: 0.75 },
  ];
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {/* lit from below: the plate goes dark and ember-warm at the top, hot at the bottom edge */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: clamp01(rise) * (1 - die),
          mixBlendMode: "multiply",
          background: `linear-gradient(0deg, rgb(255,196,140) 0%, rgb(232,128,78) ${24 + 8 * rise}%, rgb(120,58,38) ${58 + 6 * rise}%, rgb(58,30,24) 100%)`,
        }}
      />
      {/* the light itself, rising off the bottom edge */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: clamp01(I),
          mixBlendMode: "screen",
          background: `linear-gradient(0deg, rgba(255,150,64,0.58) 0%, rgba(255,104,36,0.30) ${10 + 8 * rise}%, rgba(190,60,20,0.10) ${30 + 10 * rise}%, transparent ${48 + 8 * rise - 10 * die}%)`,
        }}
      />
      {pools.map((p, i) => {
        const a = p.a * clamp01(I) * (0.78 + 0.22 * Math.sin(t * p.f + p.ph) * Math.sin(t * (p.f * 0.43) + p.ph * 2));
        const x = p.x + 2.5 * Math.sin(t * 0.7 + p.ph);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              inset: 0,
              opacity: a,
              mixBlendMode: "screen",
              background: `radial-gradient(ellipse ${p.w}% ${30 + 6 * rise}% at ${x}% ${cy}%, rgba(255,206,140,0.5) 0%, rgba(255,128,48,0.26) 36%, rgba(220,70,20,0.08) 64%, transparent 82%)`,
            }}
          />
        );
      })}
      {/* heat plumes: three soft blooms rising and widening, out of phase */}
      {[0, 1, 2].map((i) => {
        const period = 1.25 + i * 0.2;
        const ph = ((t - tf + i * 0.47) / period) % 1;
        if (t < tf + i * 0.12) return null;
        const x = 960 + [-420, 60, 470][i] + Math.sin(t * 0.9 + i) * 30;
        const y = 1120 - ph * 430;
        const s = 260 + ph * 220;
        const a = Math.sin(Math.PI * ph) * 0.34 * clamp01(I);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x - s,
              top: y - s * 0.6,
              width: 2 * s,
              height: 1.2 * s,
              borderRadius: "50%",
              background: "radial-gradient(ellipse, rgba(255,128,48,0.9) 0%, rgba(255,96,30,0.35) 40%, transparent 70%)",
              opacity: a,
              filter: "blur(28px)",
              mixBlendMode: "screen",
            }}
          />
        );
      })}
      {/* the word is ember-lit: a low warm halo behind it while it's on screen */}
      {halo > 0.01 ? (
        <div style={{ position: "absolute", inset: 0, opacity: halo, mixBlendMode: "screen", background: "radial-gradient(ellipse 30% 17% at 50% 45%, rgba(255,112,36,0.26) 0%, rgba(255,90,30,0.08) 55%, transparent 80%)" }} />
      ) : null}
      {hand > 0.01 ? (
        <div
          style={{
            position: "absolute",
            left: hx - hw,
            top: hy - 200,
            width: 2 * hw,
            height: 400,
            borderRadius: "50%",
            background: "radial-gradient(ellipse, rgba(255,128,52,0.7) 0%, rgba(255,100,34,0.3) 36%, rgba(220,70,20,0.08) 58%, transparent 72%)",
            opacity: hand,
            mixBlendMode: "screen",
            filter: "blur(12px)",
          }}
        />
      ) : null}
      <svg width={1920} height={1080} style={{ position: "absolute", left: 0, top: 0 }}>
        <defs>
          <radialGradient id="sparkGlow">
            <stop offset="0" stopColor="#FFC27A" stopOpacity="0.8" />
            <stop offset="0.4" stopColor="#FF7A2F" stopOpacity="0.25" />
            <stop offset="1" stopColor="#FF5A1E" stopOpacity="0" />
          </radialGradient>
        </defs>
        {list.map((s, i) => {
          const tau = t - s.t0;
          if (tau < 0 || tau > s.life) return null;
          const age = tau / s.life;
          const pos = (q: number): [number, number] => [s.x0 + s.drift * q + s.sway * Math.sin(q * 5.2 + s.ph), s.y0 - s.v * q - 0.5 * s.acc * q * q];
          const [x, y] = pos(tau);
          const [px, py] = pos(Math.max(0, tau - 0.045));
          const inText = clamp01(Math.min(x - TEXT.x0 + 60, TEXT.x1 + 60 - x, y - TEXT.y0 + 60, TEXT.y1 + 60 - y) / 60);
          const a = clamp01(tau / 0.08) * (1 - clamp01((age - 0.55) / 0.45)) * (1 - inText) * (0.8 + 0.2 * Math.sin(t * 23 + i * 1.7));
          if (a <= 0.01) return null;
          const col = sparkColor(age);
          return (
            <g key={i} opacity={a}>
              <circle cx={x} cy={y} r={s.r * 6.5} fill="url(#sparkGlow)" />
              <line x1={px} y1={py} x2={x} y2={y} stroke={col} strokeWidth={s.r * 1.3} strokeLinecap="round" opacity={0.75} />
              <circle cx={x} cy={y} r={s.r * (1 - 0.35 * age)} fill={col} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
