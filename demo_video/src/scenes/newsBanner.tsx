// The opening broadcast treatment (our style, no outlet's look): a red band wipes across the frame,
// BREAKING NEWS slams into it, the year rolls in on "2021", then the band retracts and the lockup
// docks top-left as a small bug with a plain live strip under it. Plus the small text-only credits.
import type { ReactNode } from "react";
import { clamp01, inOut, lerp, prog, sp, wobble } from "../state";
import { C, FONT, MONO, SAFE, SPRING, SPRING_POP } from "../theme";

export const BAND_Y = 404; // big band, vertically centred on the hero-type line (y ≈ 470)
export const BAND_H = 132;
export const DOCK_Y = 84;
export const DOCK_S = 0.38;
const X0 = SAFE.x; // the red block's left edge; its text starts at x 126 like the hero type
const YEAR_W = 300;
const DOCK_TICK_W = 478; // about the docked lockup's width
const WIPE = { damping: 20, stiffness: 150, mass: 0.6 };
// the reject token with a little light from above, fixed to the frame so band and block match
const RED = `linear-gradient(180deg, #FB8A8A 0px, ${C.reject} 40px, #EF6767 ${BAND_H}px)`;

export type BannerTimes = { tB: number; tY: number; tCol: number; tDock: number; tOut: number };

function LiveDot({ t, size, color = C.reject }: { t: number; size: number; color?: string }) {
  const ph = (t * 0.85) % 1;
  const ring = 1 - Math.pow(1 - ph, 3);
  return (
    <span style={{ position: "relative", display: "inline-block", width: size, height: size, flex: "none" }}>
      <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: color, opacity: 0.55 * (1 - ring), transform: `scale(${1 + 1.6 * ring})` }} />
      <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: color, transform: `scale(${0.9 + 0.1 * Math.sin(t * 5.3)})` }} />
    </span>
  );
}

// A plain live strip: LIVE + a neutral topic label (never the card headlines), with a faint light
// passing along it every few seconds so it never sits dead.
function Ticker({ t, w, h, fs, label, live }: { t: number; w: number; h: number; fs: number; label: string; live: boolean }) {
  const ph = ((t + 0.6) / 3.4) % 1;
  return (
    <div style={{ width: w, height: h, display: "flex", alignItems: "stretch", overflow: "hidden", background: "rgba(13,14,17,0.94)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.07), inset 0 -1px 0 rgba(255,255,255,0.05)" }}>
      {live ? (
        <div style={{ flex: "none", display: "flex", alignItems: "center", gap: fs * 0.55, padding: `0 ${fs * 0.9}px 0 ${fs * 0.8}px`, background: "rgba(248,113,113,0.13)", font: `650 ${fs}px/1 ${MONO}`, letterSpacing: "0.14em", color: C.reject }}>
          <LiveDot t={t} size={fs * 0.55} />
          LIVE
        </div>
      ) : null}
      <div style={{ position: "relative", flex: 1, overflow: "hidden", display: "flex", alignItems: "center", paddingLeft: fs * 1.1, whiteSpace: "nowrap", font: `500 ${fs}px/1 ${MONO}`, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(196,197,201,0.8)" }}>
        {label}
        <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: "28%", background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)", transform: `translateX(${lerp(-110, 400, inOut(ph))}%)` }} />
      </div>
    </div>
  );
}

export function Banner({ t, times, label }: { t: number; times: BannerTimes; label: string }) {
  const { tB, tY, tCol, tDock, tOut } = times;
  // exit: the ticker retracts first, the bug slides up out of frame 3 frames later
  const exT = sp(t, tOut - 0.06, SPRING);
  const exB = sp(t, tOut + 0.04, SPRING);
  if (exB > 0.995 && t > tOut + 0.6) return null;

  // ---- the band ----
  const wipe = sp(t, tB - 0.07, WIPE);
  const wipe2 = sp(t, tB + 0.03, WIPE); // the ticker under it, 3 frames behind
  const col = prog(t, tCol, 0.22, inOut);
  const col2 = prog(t, tCol + 0.05, 0.2, inOut);
  const right = lerp(1920 * Math.min(1, wipe), X0 + 420, col);
  const left = lerp(0, X0 + 12, col);
  const tImpact = tB + 0.24;
  const squash = 1 + 0.14 * wobble(t, tImpact, 2.6, 8);

  // ---- the lockup (red block + year), docking top-left ----
  const dock = sp(t, tDock, SPRING);
  const push = 1 + 0.03 * prog(t, tB + 0.3, 1.4, inOut);
  const s = lerp(push, DOCK_S, dock);
  const tx = lerp(-16 * prog(t, tB + 0.35, 1.3, inOut), 0, dock);
  const ty = lerp(0, DOCK_Y - BAND_Y, dock) - exB * 150;
  // during the wipe the red block is revealed by the band's leading edge (local, unscaled px)
  const redClip = t < tCol && wipe < 0.999 ? Math.max(0, (1920 * Math.min(1, wipe) - X0 - tx) / s) : Infinity;
  const year = sp(t, tY, SPRING_POP);
  const word = (k: number) => sp(t, tB + 0.09 + k * 0.07, SPRING_POP);

  const slam = (txt: string, k: number): ReactNode => {
    const a = word(k);
    return (
      <span
        key={txt}
        style={{
          display: "inline-block",
          opacity: clamp01(a * 3),
          transformOrigin: k === 0 ? "50% 55%" : "0% 55%",
          transform: `scale(${1.6 - 0.6 * a}, ${1.6 - 0.6 * a + 0.06 * wobble(t, tB + 0.2 + k * 0.07, 3, 9)})`,
          filter: a < 0.97 ? `blur(${(1 - clamp01(a)) * 12}px)` : undefined,
        }}
      >
        {txt}
      </span>
    );
  };

  // ---- the docked ticker ----
  const tk = sp(t, tDock + 0.4, SPRING) * (1 - exT);
  const dockH = BAND_H * DOCK_S;

  return (
    <>
      {/* full-width band + ticker (the hook), gone once the lockup docks */}
      {col2 < 1 ? (
        <>
          {col < 1 ? (
            <div style={{ position: "absolute", left, width: Math.max(0, right - left), top: BAND_Y, height: BAND_H, background: RED, transform: `scaleY(${squash})`, boxShadow: "0 30px 80px -20px rgba(0,0,0,0.65)" }}>
              <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 4, background: "rgba(255,240,220,0.9)", opacity: clamp01(1 - wipe) * 1.2 }} />
            </div>
          ) : null}
          <div style={{ position: "absolute", left: lerp(0, X0 + 12, col2), top: BAND_Y + BAND_H, width: Math.max(0, lerp(1920 * Math.min(1, wipe2), X0 + 420, col2) - lerp(0, X0 + 12, col2)), overflow: "hidden" }}>
            <Ticker t={t} w={1920} h={42} fs={17} label={label} live />
          </div>
        </>
      ) : null}

      {/* the lockup */}
      <div style={{ position: "absolute", left: X0, top: BAND_Y, display: "flex", transformOrigin: "0 0", transform: `translate(${tx}px, ${ty}px) scale(${s})`, opacity: 1 - exB, filter: exB > 0.02 ? `blur(${exB * 6}px)` : undefined }}>
        <div
          style={{
            height: BAND_H,
            display: "flex",
            alignItems: "center",
            gap: 30,
            padding: "0 38px 0 30px",
            background: RED,
            overflow: "hidden",
            clipPath: Number.isFinite(redClip) ? `polygon(0 -50%, ${redClip}px -50%, ${redClip}px 150%, 0 150%)` : undefined,
            font: `820 112px/1 ${FONT}`,
            letterSpacing: "-0.04em",
            color: C.bg,
            boxShadow: dock > 0.5 ? "0 18px 50px -18px rgba(0,0,0,0.7)" : undefined,
          }}
        >
          {slam("BREAKING", 0)}
          {slam("NEWS", 1)}
        </div>
        <div style={{ width: YEAR_W * Math.max(0, year), height: BAND_H, overflow: "hidden", background: "linear-gradient(180deg, #1C1D22, #111215)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "inset 0 2px 0 rgba(255,255,255,0.10), inset 0 0 0 2px rgba(255,255,255,0.06)" }}>
          <div style={{ display: "flex", font: `700 100px/1 ${MONO}`, letterSpacing: "-0.05em", color: C.textStrong, fontVariantNumeric: "tabular-nums" }}>
            {"2021".split("").map((ch, i) => {
              const a = sp(t, tY + 0.05 + i * 0.055, SPRING_POP);
              return (
                <span key={i} style={{ display: "inline-block", transform: `translateY(${(1 - a) * 96}px)`, opacity: clamp01(a * 2) }}>
                  {ch}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {/* docked live ticker under the bug */}
      {tk > 0.002 ? (
        <div style={{ position: "absolute", left: X0, top: DOCK_Y + dockH - exB * 150, width: DOCK_TICK_W * Math.min(1, tk), overflow: "hidden", opacity: clamp01(tk * 3) }}>
          <Ticker t={t} w={DOCK_TICK_W} h={32} fs={13} label={label} live />
        </div>
      ) : null}
    </>
  );
}

// "Sources: …" grows as each story lands. Text only, small, bottom-left inside the safe area.
export function Credits({ t, segs, out }: { t: number; segs: { text: string; t0: number }[]; out: number }) {
  if (!segs.length || t < segs[0].t0 || out >= 1) return null;
  return (
    <div style={{ position: "absolute", left: SAFE.x, top: 1004, font: `500 14px/1.2 ${MONO}`, letterSpacing: "0.02em", color: C.faint, whiteSpace: "nowrap", opacity: 0.9 * (1 - out) }}>
      {segs.map((sg, i) => {
        const r = sp(t, sg.t0, SPRING);
        if (r <= 0.001) return null;
        return (
          <span key={i} style={{ display: "inline-block", whiteSpace: "pre", clipPath: `inset(-4px ${(1 - clamp01(r)) * 100}% -4px 0)`, transform: `translateY(${(1 - r) * 8}px)`, opacity: clamp01(r * 2) }}>
            {i === 0 ? "Sources: " : "; "}
            {sg.text}
          </span>
        );
      })}
    </div>
  );
}
