// news (0–14.58 s), the hook. A broadcast band slams in, docks top-left, and the stories land as
// tilted glass cards stacked in depth on the right, while HeroType owns the left with the big words.
// Everything is a pure function of (tl, t).
import type { CSSProperties } from "react";
import type { Timeline } from "../core";
import { norm } from "../core";
import { calm, clamp01, fxBeat, fxT, inOut, lerp, prog, sceneOf, sp } from "../state";
import { C, FONT, MONO, SPRING, SPRING_POP, SPRING_SOFT } from "../theme";
import { ART_DONE, CardArt, CarRows, type ArtFx, type ArtKind } from "./newsArt";
import { Banner, Credits } from "./newsBanner";

export type Card = {
  kicker: string;
  fact: string;
  detail: string;
  source: string;
  figure?: { prefix: string; value: number; decimals: number; suffix: string; label: string };
};

// ---------- the card ----------
export const CARD_W = 820;
const lines = (s: string) => (s.length > 29 ? 2 : 1);
export const cardH = (c: Card) => 424 + (lines(c.fact) - 1) * 59;
const artOf = (c: Card, i?: number): ArtKind =>
  /phone|note|galaxy|samsung/i.test(c.fact) ? "phone" : /hyundai|kona|ev\b|evs/i.test(c.fact) ? "ev" : i === 1 ? "ev" : i === 2 ? "phone" : "car";

export type CardFx = { art: ArtFx; mark: number; sheen: number; dim: number; focus: number };

export function FactCard({ card, t, style, art, fx }: { card: Card; t: number; countT?: number; style?: CSSProperties; art?: ArtKind; fx?: Partial<CardFx> }) {
  const f: CardFx = { art: { ...ART_DONE, t }, mark: 0, sheen: 1, dim: 0, focus: 0, ...fx };
  const mark = clamp01(f.mark);
  return (
    <div
      style={{
        position: "absolute",
        left: 960 - CARD_W / 2,
        top: 0,
        width: CARD_W,
        height: cardH(card),
        boxSizing: "border-box",
        padding: "30px 40px 32px",
        borderRadius: 28,
        overflow: "hidden",
        // brighter, slightly cool glass so the card separates from the dark plate
        background: "linear-gradient(180deg, rgb(55,57,64) 0%, rgb(39,40,46) 42%, rgb(30,31,36) 100%)",
        border: "1px solid rgba(255,255,255,0.17)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.28), inset 0 0 0 1px rgba(255,255,255,0.03), 0 60px 120px -40px rgba(0,0,0,0.95), 0 20px 44px -20px rgba(0,0,0,0.7)",
        ...style,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, font: `500 17px/1 ${MONO}`, letterSpacing: "0.12em", textTransform: "uppercase", color: C.text2 }}>
        <span style={{ width: 10, height: 10, borderRadius: 5, background: C.reject, boxShadow: `0 0 ${6 + 4 * Math.sin(t * 4)}px rgba(248,113,113,0.6)` }} />
        {card.kicker}
      </div>
      <div
        style={{
          position: "relative",
          marginTop: 18,
          height: 190,
          borderRadius: 16,
          overflow: "hidden",
          background: "rgba(255,255,255,0.035)",
          border: "1px solid rgba(255,255,255,0.08)",
          backgroundImage: "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
          backgroundPosition: "-1px -1px",
        }}
      >
        <div style={{ position: "absolute", left: 0, right: 0, top: -4, bottom: 4 }}>
          <CardArt kind={art ?? artOf(card)} fx={f.art} />
        </div>
      </div>
      <div style={{ marginTop: 22, font: `650 56px/1.06 ${FONT}`, letterSpacing: "-0.032em", color: C.textStrong }}>{card.fact}</div>
      <div style={{ marginTop: 12, font: `500 32px/1.2 ${FONT}`, letterSpacing: "-0.01em" }}>
        <span style={{ position: "relative", display: "inline-block", transformOrigin: "0% 70%", transform: f.focus ? `scale(${1 + 0.1 * f.focus})` : undefined }}>
          {mark > 0.001 ? (
            <span style={{ position: "absolute", left: -7, bottom: 1, height: "42%", width: `calc(${mark * 100}% + 14px)`, background: C.orange, opacity: 0.88, borderRadius: 5, transform: "skewX(-10deg) rotate(-0.7deg)" }} />
          ) : null}
          <span style={{ position: "relative", color: f.focus > 0.5 ? C.textStrong : C.text, fontWeight: 500 + 100 * clamp01(f.focus) }}>{card.detail}</span>
        </span>
      </div>
      {/* a light sweep across the glass when the card lands */}
      {f.sheen > 0.001 && f.sheen < 0.999 ? (
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(105deg, transparent 38%, rgba(255,255,255,0.075) 50%, transparent 62%)", backgroundSize: "260% 100%", backgroundPosition: `${lerp(130, -30, f.sheen)}% 0` }} />
      ) : null}
      {f.dim > 0.005 ? <div style={{ position: "absolute", inset: 0, background: `rgba(10,11,13,${f.dim})` }} /> : null}
    </div>
  );
}

// ---------- 3D stage ----------
type V = { x: number; y: number; z: number; ry: number; rz: number; dim: number; blur: number };
type Cfg = { damping?: number; stiffness?: number; mass?: number };
const V0: V = { x: 0, y: 0, z: 0, ry: 0, rz: 0, dim: 0, blur: 0 };
const KEYS = Object.keys(V0) as (keyof V)[];
// additive springs: each key moves the value from the previous key's target to its own
function track(t: number, v0: V, keys: { t: number; v: Partial<V>; cfg?: Cfg }[]): V {
  const out = { ...v0 };
  let prev = { ...v0 };
  for (const k of keys) {
    const tgt = { ...prev, ...k.v };
    const p = sp(t, k.t, k.cfg ?? SPRING);
    for (const key of KEYS) out[key] += (tgt[key] - prev[key]) * p;
    prev = tgt;
  }
  return out;
}

// The focused card: ~800 px wide on screen, centred near x 1400, right edge inside the safe margin.
const SX = 1378; // the front card's centre x
const SY = 276; // the front card's top
const PERSP = 1700;
const ORIGIN = { x: 1340, y: 520 };
const S0: V = { x: 0, y: 0, z: 0, ry: -19, rz: 0, dim: 0, blur: 0 };
const S1: V = { x: 60, y: -228, z: -480, ry: -23, rz: 0, dim: 0.46, blur: 1.3 };
const S2: V = { x: 150, y: -470, z: -880, ry: -25, rz: 0, dim: 0.42, blur: 1.6 };
const LAND = { damping: 17, stiffness: 115, mass: 1 };
const SLOW = { damping: 7, stiffness: 9, mass: 1 };
const PULL = { damping: 14, stiffness: 20, mass: 1 };
const easeIn = (x: number) => Math.pow(x, 2.3);

const wordT = (tl: Timeline, word: string, after = 0) => tl.words.find((w) => w.scene === "news" && w.start >= after && norm(w.text) === norm(word))?.start;

export function News({ tl, t }: { tl: Timeline; t: number }) {
  const sc = sceneOf(tl, "news");
  const cards = (sc?.spec.cards ?? []) as Card[];
  const tB = fxT(tl, "banner") ?? 0;
  const tY = fxT(tl, "year") ?? 0.8;
  const t1 = fxT(tl, "card1") ?? 2.2;
  const t2 = fxT(tl, "card2") ?? Infinity;
  const t3 = fxT(tl, "card3") ?? Infinity;
  const tF = fxT(tl, "faulty") ?? Infinity;
  const tC = fxT(tl, "count") ?? Infinity;
  const tOut = fxT(tl, "cards-out") ?? sc?.end ?? Infinity;
  if (t > tOut + 1.1) return null;
  const hero1End = fxBeat(tl, "card1")?.heroEnd ?? t1 + 3;
  const tEvery = wordT(tl, "every") ?? t1 + 1;
  const tBattery = wordT(tl, "battery") ?? tF - 0.8;
  const tSwap = wordT(tl, "swap") ?? t2 + 0.9;
  // the full band holds until ~1.68 s, then docks while card 1 flies in (one read at a time)
  const tDock = Math.max(tY + 0.7, Math.min(tY + 0.95, t1 - 0.24));
  const times = { tB, tY, tCol: tDock - 0.18, tDock, tOut };

  // ---- camera: a slow, never-still push that reframes on each read ----
  // a slow push the whole time, a touch faster into the pile in the last beat
  const drift = Math.max(0, t - t1) * 8 + Math.max(0, t - t3 - 0.6) * 22;
  const cam = track(t, V0, [
    { t: hero1End + 0.05, v: { x: -90, y: 8, z: 80, ry: 5 }, cfg: SPRING_SOFT }, // the card takes the stage
    { t: tF - 0.12, v: { x: -110, y: -20, z: 140, ry: 7 }, cfg: SPRING_SOFT }, // lean in on "faulty"
    { t: tC - 0.4, v: { x: -40, y: 0, z: 50, ry: 2 }, cfg: SPRING_SOFT }, // give a little room back to $1.9 BILLION
    { t: t2, v: { x: -90, y: 0, z: 30, ry: 3 }, cfg: SPRING_SOFT }, // the new card takes the stage
    { t: t2 + 1.3, v: { x: -90, y: 6, z: 95, ry: 4 }, cfg: SLOW }, // push into the Hyundai card
    { t: t3 - 0.1, v: { x: -50, y: 96, z: -130, ry: 2 }, cfg: PULL }, // pull back: the pile of stories
  ]);
  cam.z += drift;
  cam.ry += 0.8 * Math.sin(t * 0.45);

  // ---- the cards ----
  type St = { i: number; v: V; op: number; t0: number };
  const exitOf = (te: number, at: number) => {
    const e = easeIn(prog(at, te, 0.5, (x) => x));
    const antic = at > te - 0.16 && at < te + 0.08 ? Math.sin(Math.PI * clamp01((at - (te - 0.16)) / 0.24)) : 0;
    // fly away back into depth (shrinking towards the vanishing point), so nothing clips the right edge
    return { x: 320 * e - 30 * antic, y: -90 * e + 6 * antic, z: -1350 * e, ry: -32 * e, rz: -5 * e, op: 1 - clamp01((e - 0.45) / 0.55) };
  };
  const stateAt = (i: number, at: number): St | null => {
    if (!cards[i]) return null;
    const t0 = [t1, t2, t3][i];
    if (!(at >= t0 - 0.02)) return null;
    let v: V;
    // card 1 starts stepping back a beat before card 2 crosses it, so their text never sits side by side
    if (i === 0) v = track(at, { x: 1020, y: 30, z: 120, ry: -52, rz: 6, dim: 0, blur: 0 }, [{ t: t1, v: S0, cfg: LAND }, { t: t2 - 0.06, v: S1, cfg: SPRING }]);
    else if (i === 1) v = track(at, { x: 1000, y: 330, z: 200, ry: -48, rz: -8, dim: 0, blur: 0 }, [{ t: t2, v: S0, cfg: LAND }]);
    else v = track(at, { ...S2, x: 980, ry: -42, rz: 3 }, [{ t: t3, v: S2, cfg: SPRING_SOFT }]);
    const te = tOut + [-0.1, -0.03, -0.17][i]; // back to front, 2 frames apart
    const ex = exitOf(te, at);
    return { i, t0, v: { ...v, x: v.x + ex.x, y: v.y + ex.y, z: v.z + ex.z, ry: v.ry + ex.ry, rz: v.rz + ex.rz }, op: clamp01((at - t0) / 0.12) * ex.op };
  };

  const states = [0, 1, 2].map((i) => stateAt(i, t)).filter((s): s is St => !!s && s.op > 0.001);
  states.sort((a, b) => a.v.z - b.v.z); // painter's order: deepest first

  const cardEls = states.map(({ i, v, op, t0 }) => {
    const prev = stateAt(i, t - 1 / 30);
    const sp3 = prev ? Math.hypot(v.x - prev.v.x, v.y - prev.v.y, (v.z - prev.v.z) * 0.5) : 0;
    const blur = v.blur + Math.min(3, Math.max(0, sp3 - 18) / 14); // motion blur on fast travel only
    const card = cards[i];
    const art: ArtFx = {
      draw: prog(t, t0 + 0.22, 1.05, inOut),
      battery: i === 0 ? sp(t, tBattery) : 0,
      fault: i === 0 ? sp(t, tF + 0.08) : 0,
      swapOut: i === 1 ? prog(t, tSwap, 0.32, inOut) : 0,
      swapIn: i === 1 ? sp(t, tSwap + 0.34, SPRING_POP) : 0,
      t,
    };
    const fx: Partial<CardFx> = {
      art,
      mark: i === 0 ? prog(t, tF + 0.04, 0.5, calm) : 0,
      focus: i === 0 ? sp(t, tF - 0.02, SPRING_POP) : 0,
      sheen: prog(t, t0 + 0.32, 0.85, inOut),
      dim: v.dim,
    };
    return (
      <FactCard
        key={i}
        card={card}
        t={t}
        art={artOf(card, i)}
        fx={fx}
        style={{
          left: SX - CARD_W / 2,
          top: SY,
          opacity: op,
          transformOrigin: "50% 45%",
          transform: `translate3d(${v.x + cam.x}px, ${v.y + cam.y}px, ${v.z + cam.z}px) rotateY(${v.ry + cam.ry}deg) rotateZ(${v.rz}deg)`,
          filter: blur > 0.15 ? `blur(${blur.toFixed(2)}px)` : undefined,
        }}
      />
    );
  });

  // ---- shared exit + the slam's little kick ----
  const out = prog(t, tOut - 0.1, 0.7);
  const kx = 4 * Math.sin((t - tB - 0.24) * 50) * Math.exp(-Math.max(0, t - tB - 0.24) * 14) * (t > tB + 0.24 ? 1 : 0);
  const ky = 3 * Math.sin((t - tB - 0.25) * 62) * Math.exp(-Math.max(0, t - tB - 0.25) * 14) * (t > tB + 0.25 ? 1 : 0);
  const credits = [
    { text: cards[0]?.source ?? "", t0: t1 + 0.55 },
    { text: cards[1]?.source ?? "", t0: t2 + 0.5 },
    { text: cards[2]?.source ?? "", t0: t3 + 0.5 },
  ].filter((c) => c.text);

  return (
    <div style={{ position: "absolute", inset: 0, transform: kx || ky ? `translate(${kx}px, ${ky}px)` : undefined }}>
      <CarRows t={t} t0={fxT(tl, "cars") ?? 0.35} tRed={tEvery} out={out} push={1 + 0.06 * prog(t, 0, 14.6, inOut)} bright={lerp(1.6, 1, prog(t, t1 - 0.1, 0.8))} />
      <div style={{ position: "absolute", inset: 0, perspective: PERSP, perspectiveOrigin: `${ORIGIN.x}px ${ORIGIN.y}px` }}>{cardEls}</div>
      <Banner t={t} times={times} label="Battery recalls" />
      <Credits t={t} segs={credits} out={prog(t, tOut - 0.05, 0.45)} />
    </div>
  );
}
