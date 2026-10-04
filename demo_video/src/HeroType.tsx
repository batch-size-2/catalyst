// Big kinetic type at hero moments: each word lands on its spoken word (from public/audio/*.json),
// composed into the clean side of the frame. The captions skip those words (core.ts).
import type { Beat, HeroWord, Timeline } from "./core";
import { clamp01, prog, sp } from "./state";
import { C, FONT, MONO, SAFE, SPRING_POP } from "./theme";

const TONES: Record<string, string> = { investigate: C.investigate, orange: C.orangeText, accept: C.accept, reject: C.reject, si: C.si, pore: C.pore };

function fmtCount(w: HeroWord, p: number) {
  const c = w.count!;
  const v = c.to * p;
  const d = c.decimals ?? 0;
  let s = v.toFixed(d);
  if (c.sep) s = Math.round(v).toLocaleString("en-US");
  return `${c.prefix ?? ""}${s}${c.suffix ?? ""}`;
}

function Hero({ b, t }: { b: Beat; t: number }) {
  const h = b.hero!;
  const times = b.heroTimes ?? [];
  const end = b.heroEnd ?? b.t + 2;
  const size = h.size ?? 118;
  const side = h.side ?? "left";
  const out = prog(t, end, 0.45);
  if (t < (times[0] ?? b.t) - 0.12 || out >= 1) return null;
  const lines: { w: HeroWord; i: number }[][] = [[]];
  h.words.forEach((w, i) => {
    lines[lines.length - 1].push({ w, i });
    if (w.br) lines.push([]);
  });
  const tone = h.tone ? TONES[h.tone] ?? h.tone : C.textStrong;
  const left = side === "left" ? SAFE.x + 30 : side === "right" ? 1176 : 0;
  const width = side === "left" ? 900 : side === "right" ? 1824 - 1176 : 1920;
  const lineH = size * 0.98;
  const top = 470 - (lines.length * lineH) / 2 + (h.kicker ? 20 : 0);
  return (
    <div style={{ position: "absolute", left, top, width, textAlign: side === "center" ? "center" : "left" }}>
      {h.kicker ? (
        <div style={{ font: `600 20px ${MONO}`, letterSpacing: "0.16em", color: C.orangeText, marginBottom: 18, opacity: clamp01(sp(t, (times[0] ?? b.t) - 0.1, SPRING_POP)) * (1 - out) }}>
          {h.kicker}
        </div>
      ) : null}
      {lines.map((ln, li) => (
        <div key={li} style={{ height: lineH, whiteSpace: "nowrap", display: "flex", gap: size * 0.26, justifyContent: side === "center" ? "center" : "flex-start", alignItems: "baseline" }}>
          {ln.map(({ w, i }) => {
            const t0 = times[i] ?? b.t + i * 0.25;
            const a = sp(t, t0 - 0.03, SPRING_POP);
            const o = prog(t, end + i * 0.04, 0.38);
            if (t < t0 - 0.05) return <span key={i} style={{ opacity: 0, font: `750 ${size}px/1 ${FONT}` }}>{w.count ? fmtCount(w, 1) : w.text}</span>;
            const nextT = times[i + 1] ?? t0 + 0.8;
            const cp = w.count ? prog(t, t0, Math.max(0.3, nextT - t0), (x) => 1 - Math.pow(1 - x, 3)) : 1;
            const color = w.color ? TONES[w.color] ?? w.color : tone;
            const mark = w.mark ? prog(t, t0 + 0.28, 0.4) : 0;
            return (
              <span
                key={i}
                style={{
                  position: "relative",
                  display: "inline-block",
                  font: `750 ${size}px/1 ${FONT}`,
                  fontVariantNumeric: "tabular-nums",
                  letterSpacing: "-0.045em",
                  color,
                  opacity: clamp01(a * 1.8) * (1 - o),
                  transform: `translateY(${(1 - a) * size * 0.42 - o * 26}px) scale(${1.06 - 0.06 * a})`,
                  filter: a < 0.98 ? `blur(${(1 - a) * 9}px)` : undefined,
                  textShadow: "0 6px 40px rgba(0,0,0,0.55)",
                }}
              >
                {mark > 0 ? (
                  <span style={{ position: "absolute", left: -6, bottom: size * 0.04, height: size * 0.2, width: `calc(${mark * 100}% + 12px)`, background: C.orange, opacity: 0.85, borderRadius: 4, zIndex: -1 }} />
                ) : null}
                {w.count ? fmtCount(w, cp) : w.text}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function HeroType({ tl, t }: { tl: Timeline; t: number }) {
  return (
    <>
      {tl.beats.filter((b) => b.hero).map((b, i) => (
        <Hero key={i} b={b} t={t} />
      ))}
    </>
  );
}

// true while a hero is on screen (the captions step aside)
export function heroActive(tl: Timeline, t: number) {
  return tl.beats.some((b) => b.hero && t >= (b.heroTimes?.[0] ?? b.t) - 0.1 && t < (b.heroEnd ?? b.t) + 0.2);
}
