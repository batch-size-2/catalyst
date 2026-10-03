import type { CSSProperties } from "react";
import type { Timeline } from "../core";
import { clamp01, fxT, prog, sceneOf, springAt } from "../state";
import { C, FONT, MONO, glass, lbl } from "../theme";

export type Card = {
  kicker: string;
  fact: string;
  detail: string;
  source: string;
  figure?: { prefix: string; value: number; decimals: number; suffix: string; label: string };
};

const CAR = "M6 24 L10 15 Q14 8 26 8 L44 8 Q52 8 58 14 L66 16 Q70 17 70 22 L70 25 L6 25 Z";

function Cars({ t, t0, out }: { t: number; t0: number; out: number }) {
  const cols = 15, rows = 6;
  const cars = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const cx = c * 128 + (r % 2) * 64 + 20;
      const cy = r * 132 + 90;
      // fill in from the centre outwards, like a spreading recall; fade towards the edges
      const d = Math.hypot(c - (cols - 1) / 2, (r - (rows - 1) / 2) * 1.6);
      const edge = Math.max(0, 1 - Math.hypot((cx - 960) / 1100, (cy - 470) / 560));
      const a = prog(t, t0 + d * 0.07, 0.6) * Math.min(1, edge * 2.2);
      if (a <= 0) continue;
      cars.push(
        <g key={i} transform={`translate(${cx} ${cy})`} opacity={a * (1 - out)}>
          <path d={CAR} fill="none" stroke="rgba(237,236,232,0.16)" strokeWidth="2" strokeLinejoin="round" />
          <circle cx="20" cy="25" r="6" fill={C.bg} stroke="rgba(237,236,232,0.16)" strokeWidth="2" />
          <circle cx="56" cy="25" r="6" fill={C.bg} stroke="rgba(237,236,232,0.16)" strokeWidth="2" />
        </g>,
      );
    }
  }
  return (
    <svg width={1920} height={1080} style={{ position: "absolute", left: 0, top: 0 }}>
      {cars}
    </svg>
  );
}

export function FactCard({ card, t, countT, style }: { card: Card; t: number; countT?: number; style?: CSSProperties }) {
  const f = card.figure;
  const cp = countT != null ? prog(t, countT, 1.1) : 0;
  const shown = countT != null && t >= countT;
  return (
    <div
      style={{
        position: "absolute",
        left: 960 - 440,
        width: 880,
        padding: "34px 44px 30px",
        borderRadius: 26,
        ...glass,
        background: "linear-gradient(180deg, rgba(36,37,42,0.9), rgba(17,18,21,0.94))",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.14), 0 40px 90px -30px rgba(0,0,0,0.9)",
        ...style,
      }}
    >
      <div style={{ ...lbl, display: "flex", alignItems: "center", gap: 10, color: C.muted }}>
        <span style={{ width: 8, height: 8, borderRadius: 4, background: C.reject }} />
        {card.kicker}
      </div>
      <div style={{ font: `600 46px/1.12 ${FONT}`, letterSpacing: "-0.025em", color: C.textStrong, marginTop: 16 }}>{card.fact}</div>
      {f ? (
        <div style={{ height: shown ? 92 * clamp01(cp * 2.5) : 0, overflow: "hidden", opacity: clamp01(cp * 3), marginTop: shown ? 14 * clamp01(cp * 2.5) : 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 18 }}>
            <span style={{ font: `500 68px ${MONO}`, letterSpacing: "-0.03em", color: C.orangeText }}>
              {f.prefix}
              {(f.value * cp).toFixed(f.decimals)}
              {f.suffix}
            </span>
            <span style={{ ...lbl }}>{f.label}</span>
          </div>
        </div>
      ) : null}
      <div style={{ font: `400 26px ${FONT}`, color: C.muted, marginTop: 10 }}>{card.detail}</div>
      <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "22px 0 14px" }} />
      <div style={{ font: `400 15px ${MONO}`, color: C.faint, letterSpacing: "0.02em" }}>Source: {card.source}</div>
    </div>
  );
}

export function News({ tl, t }: { tl: Timeline; t: number }) {
  const cards = (sceneOf(tl, "news")?.spec.cards ?? []) as Card[];
  const t1 = fxT(tl, "card1") ?? 1;
  const t2 = fxT(tl, "card2") ?? Infinity;
  const t3 = fxT(tl, "card3") ?? Infinity;
  const tc = fxT(tl, "count");
  const tOut = fxT(tl, "cards-out") ?? Infinity;
  const out = prog(t, tOut, 0.9);
  if (out >= 1) return null;
  const s1 = springAt(t, t1);
  const s2 = springAt(t, t2);
  const s3 = springAt(t, t3);
  // card 1 steps back when card 2 lands on top of it; card 3 peeks out behind both
  const card = (z: number, s: number, top: number, scale: number, opacity: number, blur: number) => ({
    top,
    opacity: s * opacity * (1 - out),
    transform: `translateX(${-out * 260}px) translateY(${(1 - s) * 50}px) scale(${scale * (0.97 + 0.03 * s)})`,
    transformOrigin: "50% 0%",
    filter: blur > 0.05 ? `blur(${blur}px)` : undefined,
    zIndex: z,
  });
  return (
    <>
      <Cars t={t} t0={fxT(tl, "cars") ?? t1} out={out} />
      {cards[2] ? <FactCard card={cards[2]} t={t} style={card(10, s3, 70, 0.86, 0.38, 1.5)} /> : null}
      {cards[0] ? <FactCard card={cards[0]} t={t} countT={tc} style={card(11, s1, 290 - 140 * s2, 1 - 0.05 * s2, 1 - 0.3 * s2, s2 * 0.6)} /> : null}
      {cards[1] ? <FactCard card={cards[1]} t={t} style={card(12, s2, 410, 1, 1, 0)} /> : null}
    </>
  );
}
