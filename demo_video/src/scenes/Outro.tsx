// outro (111.64–118.47): the ending rhymes with the opening. Where the hook had the BREAKING NEWS bug
// top-left and huge left-side type ("GM RECALLED / EVERY / CHEVY BOLT") on a cold plate, the outro has
// a calm, warm broadcast strip with the subtitle, the mark + "catalyst" landing big in the same hero
// slot, and the team line word by word in spoken order.
import type { Timeline } from "../core";
import { norm } from "../core";
import { clamp01, fxT, inOut, prog, sceneOf, sp, wobble } from "../state";
import { C, FONT, MONO, SAFE, SPRING, SPRING_POP, SPRING_SOFT } from "../theme";
import { Bloom, CatMark } from "./scienceMark";

const F = 176; // "catalyst" size; the lockup keeps the official proportions (design/logo wordmark)
const M = F / 0.6875; // mark box
const LX = 108; // mark box left: the whisker tips sit just inside the hero slot's left edge
const LY = 452 - M / 2; // the lockup is centred on the hook's hero line (y ≈ 470) less a touch for the team line
const TEXT_X = LX + 1.25 * M;
const BASE = LY + (47 / 64) * M;
const TEAM_Y = 612;
const STRIP_Y = 84;

function wordAfter(tl: Timeline, scene: string, word: string, after = 0) {
  return tl.words.find((w) => w.scene === scene && w.start >= after - 1e-3 && norm(w.text) === norm(word))?.start;
}

// the banner slot, calm and warm: an orange tab, the strip wipes open with the subtitle, a thin rule follows
function Strip({ t, t0, text }: { t: number; t0: number; text: string }) {
  if (t < t0 - 0.05 || !text) return null;
  const tab = sp(t, t0 - 0.04, SPRING_POP);
  const open = sp(t, t0 + 0.06, SPRING);
  const rule = sp(t, t0 + 0.16, SPRING_SOFT);
  const H = 54;
  // the dot breathes (the hook's LIVE dot pulsed; this one is at rest)
  const dot = 0.75 + 0.25 * Math.sin((t - t0) * 2.2);
  return (
    <div style={{ position: "absolute", left: SAFE.x, top: STRIP_Y, height: H, display: "flex", alignItems: "stretch" }}>
      <div style={{ width: 8, background: C.orange, transformOrigin: "50% 50%", transform: `scaleY(${Math.max(0, tab)})`, boxShadow: `0 0 18px rgba(255,122,47,${0.45 * clamp01(tab)})` }} />
      <div style={{ position: "relative", clipPath: `inset(-20px ${(1 - clamp01(open)) * 100}% -20px 0)` }}>
        <div
          style={{
            height: H,
            display: "flex",
            alignItems: "center",
            gap: 16,
            padding: "0 26px 0 22px",
            background: "linear-gradient(90deg, rgba(14,15,18,0.9), rgba(14,15,18,0.78))",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08), 0 18px 50px -18px rgba(0,0,0,0.7)",
            font: `520 22px/1 ${MONO}`,
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            color: C.cream,
            whiteSpace: "nowrap",
            transform: `translateX(${(1 - clamp01(open)) * -24}px)`,
          }}
        >
          <span style={{ width: 9, height: 9, borderRadius: 5, background: C.orange, opacity: dot, boxShadow: `0 0 10px rgba(255,122,47,${0.6 * dot})`, flex: "none" }} />
          {text}
        </div>
        <div style={{ position: "absolute", left: 0, bottom: -1, height: 2, width: `${clamp01(rule) * 100}%`, background: `linear-gradient(90deg, ${C.orange}, rgba(255,122,47,0.25))` }} />
      </div>
    </div>
  );
}

export function Outro({ tl, t }: { tl: Timeline; t: number }) {
  const sc = sceneOf(tl, "outro");
  if (!sc || t < sc.start - 0.2) return null;
  const tLogo = fxT(tl, "logo") ?? sc.start + 0.6;
  const tName = wordAfter(tl, "outro", "Catalyst", sc.start) ?? tLogo + 0.1;
  const tSub = fxT(tl, "subtitle") ?? tName + 0.65;
  const tTeam = fxT(tl, "team") ?? tSub + 1.3;
  const tBlink = fxT(tl, "blink") ?? Infinity;
  const teamWords = ["Made", "by", ...String(sc.spec.team ?? "").split(/\s+/).filter(Boolean)];
  let after = tTeam - 0.2;
  const teamT = teamWords.map((w, i) => {
    const ts = wordAfter(tl, "outro", w, after) ?? tTeam + i * 0.3;
    after = ts + 0.01;
    return ts;
  });

  // a slow push across the whole hold, so the end card is never frozen
  const push = prog(t, tLogo, sc.end - tLogo, (x) => x);
  const camS = 1 + 0.02 * push;
  const camX = -8 * push;

  // ---- the mark: draws itself (as it did on "I'm Catalyst"), fills, opens its eyes ----
  const t0 = Math.min(tLogo, tName - 0.2);
  const draw = prog(t, t0, 0.3, inOut);
  const tFill = t0 + 0.24;
  const fill = sp(t, tFill, SPRING_POP);
  const eyes = sp(t, t0 + 0.34, SPRING_POP);
  const whisk = prog(t, t0 + 0.3, 0.3);
  const land = sp(t, t0 - 0.05, SPRING_POP);
  const pop = 1 + 0.05 * wobble(t, tFill, 2.4, 6);
  // a slow blink with the cat (it closes fast, holds, and opens slowly), a beat behind it
  const bT = t - (tBlink + 0.1);
  const blink = bT < 0 ? 0 : bT < 0.1 ? bT / 0.1 : bT < 0.22 ? 1 : bT < 0.5 ? 1 - (bT - 0.22) / 0.28 : 0;
  const bloom = clamp01(fill) * (0.32 + 0.5 * Math.exp(-Math.max(0, t - tFill) * 2) + 0.05 * Math.sin(t * 1.7));
  const ms = M * (0.86 + 0.14 * clamp01(land)) * pop;

  // ---- "catalyst": letter by letter, like the hook's words ----
  const letters = "catalyst".split("");
  // the team line, each word on its spoken word
  const scrim = prog(t, sc.start + 0.2, 0.9);

  return (
    <>
      {/* the fire's light comes back calm: a low warm glow from the lower right, where the cat curls up */}
      <div style={{ position: "absolute", inset: 0, opacity: scrim * (0.9 + 0.1 * Math.sin(t * 1.3)), mixBlendMode: "screen", background: "radial-gradient(ellipse 60% 62% at 76% 92%, rgba(255,122,47,0.2) 0%, rgba(255,110,40,0.08) 45%, transparent 75%)" }} />
      {/* a soft dark pool behind the type so it reads on the warm plate */}
      <div style={{ position: "absolute", inset: 0, opacity: scrim, background: "radial-gradient(ellipse 62% 64% at 26% 46%, rgba(8,9,11,0.58) 0%, rgba(8,9,11,0.3) 45%, transparent 75%)" }} />
      <div style={{ position: "absolute", inset: 0, transformOrigin: `${SAFE.x}px 470px`, transform: `translateX(${camX}px) scale(${camS})` }}>
        <Strip t={t} t0={tSub} text={String(sc.spec.subtitle ?? "")} />
        {t >= t0 ? (
          <>
            <Bloom x={LX + M / 2} y={LY + M * 0.52} r={M * 1.1} a={bloom} />
            <div style={{ position: "absolute", left: LX + M / 2 - ms / 2, top: LY + M / 2 - ms / 2, width: ms, height: ms }}>
              <CatMark size={ms} s={{ draw, fill, eyes, whisk, blink, pen: 1 - prog(t, t0 + 0.26, 0.1) }} stroke={2.4} />
            </div>
          </>
        ) : null}
        <div style={{ position: "absolute", left: TEXT_X, top: BASE - F, height: F * 1.2, display: "flex", alignItems: "baseline", font: `640 ${F}px/1 ${FONT}`, letterSpacing: "-0.045em", color: C.textStrong, whiteSpace: "nowrap" }}>
          {letters.map((ch, i) => {
            const a = sp(t, tName + 0.02 + i * 0.036, SPRING_POP);
            return (
              <span
                key={i}
                style={{
                  display: "inline-block",
                  lineHeight: `${F}px`,
                  opacity: clamp01(a * 1.8),
                  transform: `translateY(${(1 - a) * F * 0.42}px) scale(${1.06 - 0.06 * a})`,
                  filter: a < 0.98 ? `blur(${(1 - clamp01(a)) * 9}px)` : undefined,
                  textShadow: "0 6px 40px rgba(0,0,0,0.55)",
                }}
              >
                {ch}
              </span>
            );
          })}
        </div>
        <div style={{ position: "absolute", left: SAFE.x + 30, top: TEAM_Y, display: "flex", gap: 14, alignItems: "baseline", font: `560 46px/1 ${FONT}`, letterSpacing: "-0.02em", whiteSpace: "nowrap" }}>
          {teamWords.map((w, i) => {
            const a = sp(t, teamT[i] - 0.03, SPRING_POP);
            return (
              <span
                key={i}
                style={{
                  display: "inline-block",
                  color: i < 2 ? C.muted : C.textStrong,
                  fontWeight: i < 2 ? 450 : 600,
                  opacity: clamp01(a * 1.8),
                  transform: `translateY(${(1 - a) * 20}px)`,
                  filter: a < 0.98 ? `blur(${(1 - clamp01(a)) * 6}px)` : undefined,
                  textShadow: "0 4px 24px rgba(0,0,0,0.5)",
                }}
              >
                {w}
              </span>
            );
          })}
        </div>
      </div>
    </>
  );
}

