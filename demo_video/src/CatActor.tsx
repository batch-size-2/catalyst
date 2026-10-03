// Places assets/cat/Cat.tsx in screen space: anchors in the side margins, arcs between them,
// a telescopic pointer that reaches into the window, held items and callouts.
// Phase 1 uses the current Cat.tsx unchanged; the rim glow is an SVG filter applied here.
import { staticFile } from "remotion";
import { Cat, type CatExpression, type CatPose } from "../../assets/cat/Cat";
import type { Timeline } from "./core";
import { CAT_H, CAT_K, CAT_SIZE, calloutAt, catAt, clamp01, hlToScreen, lerp, prog, springAt, type Box } from "./state";
import { C, FONT, glass } from "./theme";

// expressions the current Cat.tsx doesn't have yet (milestone 2) fall back to the closest one
const EXPR: Record<string, CatExpression> = { thinking: "curious", focused: "curious" };
const POSES = ["float", "hold", "point", "wave", "shrug", "stamp"];

const floatOf = (t: number) => Math.sin((t * 2 * Math.PI) / 3) * 8;

// the tip touches the target just inside its nearest edge
function aim(paw: [number, number], box: Box): [number, number] {
  const ix = Math.min(22, box.w / 2), iy = Math.min(14, box.h / 2);
  return [Math.max(box.x + ix, Math.min(box.x + box.w - ix, paw[0])), Math.max(box.y + iy, Math.min(box.y + box.h - iy, paw[1]))];
}

function Items({ item, t }: { item: string; t: number }) {
  if (item === "magnifier") {
    return (
      <g>
        <path d="M200,222 L236,182" stroke="#2A2C33" strokeWidth="11" strokeLinecap="round" />
        <path d="M200,222 L236,182" stroke={C.orange} strokeWidth="4" strokeLinecap="round" opacity="0.8" />
        <circle cx="252" cy="162" r="27" fill="rgba(190,225,255,0.22)" stroke="#2A2C33" strokeWidth="8" />
        <path d="M236,152 Q242,142 254,140" stroke="#fff" strokeWidth="4" fill="none" strokeLinecap="round" opacity={0.6 + 0.3 * Math.sin(t * 1.3)} />
      </g>
    );
  }
  if (item === "tile") {
    return (
      <g transform="rotate(-8 292 150)">
        <rect x="252" y="110" width="80" height="80" rx="10" fill="#15161A" stroke="rgba(255,240,220,0.85)" strokeWidth="3" />
        <clipPath id="tileclip"><rect x="258" y="116" width="68" height="68" rx="6" /></clipPath>
        <image href={staticFile("bg/micro_grey.jpg")} x="150" y="80" width="300" height="168" clipPath="url(#tileclip)" preserveAspectRatio="xMidYMid slice" />
      </g>
    );
  }
  return null;
}

export function CatActor({ tl, t }: { tl: Timeline; t: number }) {
  const cat = catAt(tl, t);
  if (!cat.visible) return null;
  const { x, y, face, rot, travel } = cat.pos;
  const pose = (POSES.includes(cat.pose ?? "") ? cat.pose : "float") as CatPose;
  const expression = (EXPR[cat.expression ?? ""] ?? cat.expression ?? "happy") as CatExpression;
  const fl = floatOf(t);
  const top = y - CAT_H;

  // pointer
  const pointing = pose === "point" && cat.item === "pointer";
  const paw: [number, number] = [x + face * (284 - 160) * CAT_K, top + (198 + fl) * CAT_K];
  let tip: [number, number] | null = null;
  let look: [number, number] = [face > 0 ? 0.6 : -0.6, 0.1];
  const box = hlToScreen(tl, t, cat.lookAt ?? null);
  if (pointing) {
    const ext = springAt(t, Math.max(cat.itemT, cat.t0 + 0.7), { damping: 22, stiffness: 90 }) * (1 - clamp01(travel * 4));
    let target: [number, number] = box ? aim(paw, box) : [paw[0] + face * 110, paw[1] - 60];
    const prevBox = cat.prevLookAt ? hlToScreen(tl, t, cat.prevLookAt) : null;
    if (prevBox && t - cat.lookT < 0.9) {
      const from = aim(paw, prevBox);
      const p = prog(t, cat.lookT, 0.9);
      target = [lerp(from[0], target[0], p), lerp(from[1], target[1], p)];
    }
    const dx = target[0] - paw[0], dy = target[1] - paw[1];
    const len = Math.min(Math.hypot(dx, dy), 900);
    const d = Math.hypot(dx, dy) || 1;
    tip = ext > 0.01 ? [paw[0] + (dx / d) * len * ext, paw[1] + (dy / d) * len * ext] : null;
  }
  if (box) {
    const bx = box.x + box.w / 2 - x, by = box.y + box.h / 2 - (top + 140 * CAT_K);
    const d = Math.hypot(bx, by) || 1;
    look = [(bx / d) * face, by / d];
  }

  const callout = calloutAt(tl, t);
  return (
    <>
      <svg width="0" height="0" style={{ position: "absolute" }}>
        <filter id="catRim" x="-25%" y="-25%" width="150%" height="150%">
          <feMorphology in="SourceAlpha" operator="dilate" radius="3" result="d" />
          <feFlood floodColor={C.cream} floodOpacity="0.7" />
          <feComposite in2="d" operator="in" result="rim" />
          <feGaussianBlur in="d" stdDeviation="12" result="gb" />
          <feFlood floodColor={C.orange} floodOpacity="0.42" />
          <feComposite in2="gb" operator="in" result="glow" />
          <feMerge>
            <feMergeNode in="glow" />
            <feMergeNode in="rim" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="tipGlow" x="-200%" y="-200%" width="500%" height="500%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </svg>
      {tip ? (
        <svg width={1920} height={1080} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
          <line x1={paw[0]} y1={paw[1]} x2={tip[0]} y2={tip[1]} stroke="rgba(0,0,0,0.5)" strokeWidth="9" strokeLinecap="round" />
          <line x1={paw[0]} y1={paw[1]} x2={lerp(paw[0], tip[0], 0.45)} y2={lerp(paw[1], tip[1], 0.45)} stroke="#3A3D46" strokeWidth="7" strokeLinecap="round" />
          <line x1={paw[0]} y1={paw[1]} x2={tip[0]} y2={tip[1]} stroke="#4A4E59" strokeWidth="4" strokeLinecap="round" />
          <line x1={paw[0]} y1={paw[1] - 1} x2={tip[0]} y2={tip[1] - 1} stroke="rgba(255,255,255,0.35)" strokeWidth="1.2" strokeLinecap="round" />
          <circle cx={tip[0]} cy={tip[1]} r="13" fill={C.orange} opacity={0.55 + 0.15 * Math.sin(t * 4)} filter="url(#tipGlow)" />
          <circle cx={tip[0]} cy={tip[1]} r="6" fill={C.orange} stroke="#FFD2B0" strokeWidth="1.5" />
        </svg>
      ) : null}
      <div
        style={{
          position: "absolute",
          left: x - CAT_SIZE / 2,
          top,
          width: CAT_SIZE,
          height: CAT_H,
          transformOrigin: "50% 100%",
          transform: `rotate(${rot}deg) scaleX(${face})`,
          filter: "url(#catRim)",
        }}
      >
        <Cat t={t} expression={expression} pose={pose} size={CAT_SIZE} lookAt={look} outfit="labcoat" />
        <svg viewBox="0 0 320 340" width={CAT_SIZE} height={CAT_H} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
          <g transform={`translate(0 ${fl})`}>
            <Items item={cat.item ?? "none"} t={t} />
          </g>
        </svg>
      </div>
      {callout ? <Callout text={callout.text} t={t} t0={callout.t0} end={callout.end} chained={callout.chained} x={x} top={top} face={face} /> : null}
    </>
  );
}

function Callout({ text, t, t0, end, chained, x, top, face }: { text: string; t: number; t0: number; end: number; chained: boolean; x: number; top: number; face: number }) {
  const inP = chained ? 1 : springAt(t, t0, { damping: 16, stiffness: 120 });
  const outP = prog(t, end, 0.3);
  const w = text.length * 11.6 + 40;
  const left = face > 0 ? Math.max(22, Math.min(252 - w, x - w / 2 + 20)) : Math.min(1898 - w, Math.max(1668, x - w / 2 - 20));
  const bottom = Math.max(70, top + 34 * CAT_K - 6);
  const pop = chained ? 1 + 0.06 * (1 - prog(t, t0, 0.25)) : 1;
  return (
    <div
      style={{
        position: "absolute",
        left,
        top: bottom - 46,
        height: 44,
        padding: "0 20px",
        display: "flex",
        alignItems: "center",
        whiteSpace: "nowrap",
        borderRadius: 14,
        ...glass,
        background: "linear-gradient(180deg, rgba(40,42,48,0.78), rgba(20,21,25,0.78))",
        font: `500 21px ${FONT}`,
        color: C.textStrong,
        opacity: clamp01(inP) * (1 - outP),
        transformOrigin: face > 0 ? "30% 100%" : "70% 100%",
        transform: `translateY(${(1 - inP) * 10}px) scale(${(0.9 + 0.1 * inP) * pop})`,
      }}
    >
      {text}
      <div
        style={{
          position: "absolute",
          bottom: -6,
          left: Math.max(16, Math.min(w - 28, x - left - 6)),
          width: 12,
          height: 12,
          transform: "rotate(45deg)",
          background: "rgba(22,23,27,0.9)",
          borderRight: "1px solid rgba(255,255,255,0.1)",
          borderBottom: "1px solid rgba(255,255,255,0.1)",
        }}
      />
    </div>
  );
}
