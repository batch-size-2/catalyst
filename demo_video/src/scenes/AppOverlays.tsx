import { staticFile } from "remotion";
import type { Timeline } from "../core";
import { CAT_H, CAT_K, catAt, clamp01, fxBeat, hlToScreen, inOut, lerp, prog, sceneOf, screenAt, springAt } from "../state";
import { C, CONTENT, MONO, glass, lbl } from "../theme";

// Identify: the tile card leaves the cat's paw and lands on the drop zone.
function TileDrop({ tl, t }: { tl: Timeline; t: number }) {
  const b = fxBeat(tl, "drop");
  if (!b || t < b.t) return null;
  const s = screenAt(tl, t);
  if (s.shot !== "identify_empty") return null;
  const dur = b.dur ?? 0.7;
  const p = prog(t, b.t, dur, inOut);
  const cat = catAt(tl, b.t);
  const from = [cat.pos.x + cat.pos.face * (292 - 160) * CAT_K, cat.pos.y - CAT_H + 150 * CAT_K];
  const zone = hlToScreen(tl, b.t + dur, "dropzone");
  const to = zone ? [zone.x + zone.w / 2, zone.y + zone.h / 2] : [960, 420];
  const x = lerp(from[0], to[0], p);
  const y = lerp(from[1], to[1], p) - Math.sin(Math.PI * p) * 160;
  const size = lerp(50, 120, p);
  const land = t - (b.t + dur);
  const ring = land > 0 ? clamp01(land / 0.7) : 0;
  return (
    <>
      {ring > 0 && ring < 1 ? (
        <div style={{ position: "absolute", left: to[0] - 100 - ring * 80, top: to[1] - 100 - ring * 80, width: 200 + ring * 160, height: 200 + ring * 160, borderRadius: 30 + ring * 30, border: `2px solid ${C.orange}`, opacity: (1 - ring) * 0.7 }} />
      ) : null}
      <div
        style={{
          position: "absolute",
          left: x - size / 2,
          top: y - size / 2,
          width: size,
          height: size,
          borderRadius: 12,
          border: "3px solid rgba(255,240,220,0.85)",
          overflow: "hidden",
          transform: `rotate(${lerp(-8, 0, p)}deg) scale(${land > 0 ? 1 - 0.04 * Math.sin(clamp01(land / 0.25) * Math.PI) : 1})`,
          boxShadow: `0 ${lerp(10, 24, p)}px 40px rgba(0,0,0,0.6), 0 0 30px rgba(255,122,47,${0.25 * p})`,
          background: `url(${staticFile("bg/micro_grey.jpg")}) center / 300% auto`,
        }}
      />
    </>
  );
}

// Audit: a fingerprint types itself under the decision-log row.
function HashType({ tl, t }: { tl: Timeline; t: number }) {
  const b = fxBeat(tl, "hash");
  const text = (sceneOf(tl, "audit")?.spec.hash as string) ?? "";
  if (!b || t < b.t || !text) return null;
  const end = fxBeat(tl, "verify")?.t ?? Infinity;
  const a = springAt(t, b.t) * (1 - prog(t, end, 0.5));
  if (a <= 0.01) return null;
  const n = Math.floor(clamp01((t - b.t - 0.2) / (b.dur ?? 1.6)) * text.length);
  return (
    <div style={{ position: "absolute", left: CONTENT.x + 36, bottom: 1080 - (CONTENT.y + CONTENT.h) + 36, padding: "14px 20px", borderRadius: 14, ...glass, background: "rgba(14,15,18,0.85)", opacity: a }}>
      <div style={{ ...lbl, marginBottom: 6 }}>fingerprint of the inputs</div>
      <div style={{ font: `500 24px ${MONO}`, color: C.text, whiteSpace: "pre" }}>
        {text.slice(0, n)}
        <span style={{ color: C.orange, opacity: Math.floor(t * 3) % 2 ? 1 : 0.2 }}>▍</span>
      </div>
    </div>
  );
}

// Audit: the cat stamps a paw print onto a small "verified" card in the margin.
function Verified({ tl, t }: { tl: Timeline; t: number }) {
  const b = fxBeat(tl, "verify");
  if (!b || t < b.t) return null;
  const stamp = tl.beats.find((x) => x.sfx === "stamp" && x.t >= b.t)?.t ?? b.t + 0.6;
  const end = sceneOf(tl, "audit")?.end ?? Infinity;
  const a = springAt(t, b.t) * (1 - prog(t, end - 0.2, 0.6));
  // in front of the cat's lower body, like a desk; the print lands with the stamp sound
  const cat = catAt(tl, b.t + 1);
  const cx = cat.pos.x + cat.pos.face * 22;
  const top = cat.pos.y - 78;
  const pr = springAt(t, stamp, { damping: 12, stiffness: 160 });
  return (
    <div style={{ position: "absolute", left: cx - 100, top, width: 200, height: 136, borderRadius: 18, transform: `translateY(${(1 - a) * 20}px)`, ...glass, background: "rgba(14,15,18,0.78)", opacity: a, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6 }}>
      <svg viewBox="0 0 60 56" width={54} height={50} style={{ opacity: clamp01(pr * 1.5), transform: `scale(${1.3 - 0.3 * pr})` }}>
        <ellipse cx="30" cy="36" rx="15" ry="12" fill={C.orange} />
        {[[12, 18], [24, 10], [36, 10], [48, 18]].map(([x, y]) => (
          <ellipse key={x} cx={x} cy={y} rx="6" ry="7" fill={C.orange} />
        ))}
      </svg>
      <div style={{ ...lbl, fontSize: 15, color: t >= stamp ? C.accept : C.faint }}>{t >= stamp ? "✓ verified" : "verify"}</div>
    </div>
  );
}

export function AppOverlays({ tl, t }: { tl: Timeline; t: number }) {
  return (
    <>
      <TileDrop tl={tl} t={t} />
      <HashType tl={tl} t={t} />
    </>
  );
}

// drawn after the cat
export function FrontOverlays({ tl, t }: { tl: Timeline; t: number }) {
  return <Verified tl={tl} t={t} />;
}
