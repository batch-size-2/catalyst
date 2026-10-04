import { staticFile } from "remotion";
import type { Timeline } from "../core";
import { CAT_H, CAT_K, catAt, clamp01, fxBeat, hlToScreen, inOut, lerp, prog, sp, wobble } from "../state";
import { C } from "../theme";

// Identify: the cat tosses a tile card onto the drop zone; it lands, the zone ripples, then it
// shrinks away into the page as the result arrives.
function TileDrop({ tl, t }: { tl: Timeline; t: number }) {
  const b = fxBeat(tl, "drop");
  if (!b || t < b.t) return null;
  const dur = b.dur ?? 0.7;
  const end = fxBeat(tl, "drop-out")?.t ?? b.t + 3;
  const gone = prog(t, end, 0.4, inOut);
  if (gone >= 1) return null;
  const p = prog(t, b.t, dur, inOut);
  const cat = catAt(tl, b.t);
  const from = [cat.pos.x + cat.pos.face * (292 - 160) * CAT_K, cat.pos.y - CAT_H + 150 * CAT_K];
  const zone = hlToScreen(tl, b.t + dur, "dropzone");
  const to = zone && zone.w > 0 ? [zone.x + zone.w / 2, zone.y + zone.h / 2] : [960, 420];
  const x = lerp(from[0], to[0], p);
  const y = lerp(from[1], to[1], p) - Math.sin(Math.PI * p) * 200;
  const size = lerp(54, 150, p) * (1 - 0.5 * gone);
  const land = t - (b.t + dur);
  const ring = land > 0 ? clamp01(land / 0.7) : 0;
  const squash = land > 0 ? wobble(t, b.t + dur, 3.2, 6) : 0;
  return (
    <>
      {ring > 0 && ring < 1 ? (
        <div style={{ position: "absolute", left: to[0] - 110 - ring * 90, top: to[1] - 110 - ring * 90, width: 220 + ring * 180, height: 220 + ring * 180, borderRadius: 30 + ring * 30, border: `2.5px solid ${C.orange}`, opacity: (1 - ring) * 0.8 }} />
      ) : null}
      <div
        style={{
          position: "absolute",
          left: x - size / 2,
          top: y - size / 2,
          width: size,
          height: size,
          borderRadius: 14,
          border: "3px solid rgba(255,240,220,0.9)",
          overflow: "hidden",
          opacity: 1 - gone,
          transform: `rotate(${lerp(-14, 0, p) + p * (1 - p) * 40}deg) scale(${1 + 0.08 * squash}, ${1 - 0.08 * squash})`,
          boxShadow: `0 ${lerp(10, 26, p)}px 44px rgba(0,0,0,0.65), 0 0 34px rgba(255,122,47,${0.3 * p})`,
          background: `url(${staticFile("bg/micro_grey.jpg")}) 38% 42% / 520% auto`,
        }}
      />
    </>
  );
}

// A soft idle pulse around a button that doesn't animate by itself in the app (GENERATE LAWSUIT).
function Pulse({ tl, t }: { tl: Timeline; t: number }) {
  const b = fxBeat(tl, "pulse");
  if (!b || t < b.t) return null;
  const end = b.t + (b.dur ?? 3);
  if (t > end + 0.3) return null;
  const box = hlToScreen(tl, t, "lawsuit_btn");
  if (!box || box.w <= 0) return null;
  const a = sp(t, b.t) * (1 - prog(t, end, 0.25));
  const ph = ((t - b.t) / 0.9) % 1;
  return (
    <>
      {[0, 0.5].map((o) => {
        const q = (ph + o) % 1;
        return (
          <div key={o} style={{ position: "absolute", left: box.x - 6 - q * 22, top: box.y - 6 - q * 22, width: box.w + 12 + q * 44, height: box.h + 12 + q * 44, borderRadius: 14 + q * 10, border: `2px solid ${C.reject}`, opacity: a * (1 - q) * 0.7 }} />
        );
      })}
      <div style={{ position: "absolute", left: box.x - 10, top: box.y - 10, width: box.w + 20, height: box.h + 20, borderRadius: 18, boxShadow: `0 0 ${30 + 12 * Math.sin(ph * Math.PI * 2)}px rgba(248,113,113,${0.45 * a})` }} />
    </>
  );
}

// A hit: a white-hot flash ring where the cursor pressed (the lawsuit button).
function Hit({ tl, t }: { tl: Timeline; t: number }) {
  const b = tl.beats.find((x) => x.sfx === "lawsuit");
  if (!b || t < b.t || t > b.t + 0.5) return null;
  const box = hlToScreen(tl, b.t, "lawsuit_btn");
  if (!box || box.w <= 0) return null;
  const q = clamp01((t - b.t) / 0.45);
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  return (
    <div style={{ position: "absolute", left: cx - 40 - q * 260, top: cy - 40 - q * 260, width: 80 + q * 520, height: 80 + q * 520, borderRadius: "50%", border: `${6 * (1 - q) + 1}px solid ${C.reject}`, opacity: (1 - q) * 0.85, boxShadow: `0 0 60px rgba(248,113,113,${0.5 * (1 - q)})` }} />
  );
}

export function AppOverlays({ tl, t }: { tl: Timeline; t: number }) {
  return (
    <>
      <Pulse tl={tl} t={t} />
      <Hit tl={tl} t={t} />
    </>
  );
}

// drawn after the cat
export function FrontOverlays({ tl, t }: { tl: Timeline; t: number }) {
  return <TileDrop tl={tl} t={t} />;
}
