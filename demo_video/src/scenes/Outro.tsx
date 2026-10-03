import type { Timeline } from "../core";
import { fxBeat, fxT, prog, sceneOf, springAt } from "../state";
import { C, FONT, MONO, glass } from "../theme";
import { FactCard, type Card } from "./News";

const HEX = "M12 38 L15 9 L27 19 L37 19 L49 9 L52 38 L42 55 L22 55 Z";

function Wordmark({ size }: { size: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: size * 0.28 }}>
      <svg viewBox="0 0 64 64" width={size} height={size}>
        <path d={HEX} fill={C.orange} stroke={C.orange} strokeWidth="4" strokeLinejoin="round" />
        <rect x="22.5" y="31" width="5" height="10" rx="2.5" fill={C.bg} />
        <rect x="36.5" y="31" width="5" height="10" rx="2.5" fill={C.bg} />
        <path d="M29.5 45 L34.5 45 L32 48 Z" fill={C.bg} />
        <path d="M10 41 L1 38 M10 46 L2 49 M54 41 L63 38 M54 46 L62 49" stroke={C.orange} strokeWidth="3" strokeLinecap="round" fill="none" />
      </svg>
      <span style={{ font: `600 ${size * 0.95}px ${FONT}`, letterSpacing: "-0.045em", color: C.text, lineHeight: 1 }}>catalyst</span>
    </div>
  );
}

export function Outro({ tl, t }: { tl: Timeline; t: number }) {
  const sc = sceneOf(tl, "outro");
  const tLogo = fxT(tl, "logo");
  if (!sc || tLogo == null || t < tLogo) return null;
  const fl = fxBeat(tl, "flicker");
  const tTeam = fxT(tl, "team") ?? Infinity;
  const cards = (sceneOf(tl, "news")?.spec.cards ?? []) as Card[];
  const a = springAt(t, tLogo + 0.35, { damping: 200, stiffness: 50 });
  const sub = springAt(t, tLogo + 1.0);
  const team = springAt(t, tTeam);
  // the news flickers back faintly behind the card, then dissolves
  let flick = 0;
  if (fl && t >= fl.t) {
    const u = (t - fl.t) / (fl.dur ?? 1.6);
    const noise = 0.55 + 0.45 * Math.sin(t * 37) * Math.sin(t * 13.7);
    flick = u < 1 ? Math.sin(Math.min(1, u) * Math.PI) * noise * 0.32 : 0;
  }
  return (
    <>
      {flick > 0.005 && cards[0] && cards[1] ? (
        <div style={{ position: "absolute", inset: 0, opacity: flick, filter: `blur(${1 + prog(t, fl!.t, fl!.dur ?? 1.6) * 6}px)` }}>
          <FactCard card={cards[0]} t={t} style={{ top: 140, transform: "translateX(-330px) rotate(-3deg) scale(0.8)" }} />
          <FactCard card={cards[1]} t={t} style={{ top: 520, transform: "translateX(330px) rotate(2deg) scale(0.8)" }} />
        </div>
      ) : null}
      <div
        style={{
          position: "absolute",
          left: 960 - 470,
          top: 300,
          width: 940,
          height: 380,
          borderRadius: 28,
          ...glass,
          background: "linear-gradient(180deg, rgba(36,37,42,0.62), rgba(14,15,18,0.72))",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.14), 0 50px 120px -30px rgba(0,0,0,0.9)",
          opacity: a,
          transform: `translateY(${(1 - a) * 30}px) scale(${0.97 + 0.03 * a})`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Wordmark size={104} />
        <div style={{ font: `400 30px ${FONT}`, color: C.muted, marginTop: 26, opacity: sub, transform: `translateY(${(1 - sub) * 8}px)` }}>
          {String(sc.spec.subtitle ?? "")}
        </div>
        <div style={{ width: 640 * team, height: 1, background: "rgba(255,255,255,0.1)", margin: "30px 0 20px" }} />
        <div style={{ font: `500 18px ${MONO}`, letterSpacing: "0.12em", textTransform: "uppercase", color: C.orangeText, opacity: team }}>
          {String(sc.spec.team ?? "")}
        </div>
      </div>
    </>
  );
}
