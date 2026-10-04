// Places assets/cat/Cat.tsx in screen space: anchors in the side margins, arcs between them, an acted
// change around every expression switch (squint + squash, take, emote), the head leading the body,
// a telescopic pointer that reaches into the window, and held items.
import { staticFile } from "remotion";
import { Cat, type CatExpression, type CatPose } from "../../assets/cat/Cat";
import type { Timeline } from "./core";
import { CAT_H, CAT_K, CAT_SIZE, catAt, catTakeAt, clamp01, hlToScreen, lerp, prog, sp, springAt, wobble, type Box } from "./state";
import { C, SPRING_POP } from "./theme";

const POSES = ["float", "hold", "point", "wave", "shrug", "stamp"];
const floatOf = (t: number) => Math.sin((t * 2 * Math.PI) / 3) * 8;

// the tip touches the target just inside its nearest edge
function aim(paw: [number, number], box: Box): [number, number] {
  const ix = Math.min(22, box.w / 2), iy = Math.min(14, box.h / 2);
  return [Math.max(box.x + ix, Math.min(box.x + box.w - ix, paw[0])), Math.max(box.y + iy, Math.min(box.y + box.h - iy, paw[1]))];
}

function Items({ item, t, strike }: { item: string; t: number; strike: number }) {
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
      <g transform={`rotate(${-8 + Math.sin(t * 2.1) * 3} 292 150)`}>
        <rect x="252" y="110" width="80" height="80" rx="10" fill="#15161A" stroke="rgba(255,240,220,0.85)" strokeWidth="3" />
        <clipPath id="tileclip"><rect x="258" y="116" width="68" height="68" rx="6" /></clipPath>
        <image href={staticFile("bg/micro_grey.jpg")} x="150" y="80" width="300" height="168" clipPath="url(#tileclip)" preserveAspectRatio="xMidYMid slice" />
      </g>
    );
  }
  if (item === "gavel") {
    // a small walnut gavel, raised; `strike` swings it down
    const a = -38 + strike * 62;
    return (
      <g transform={`rotate(${a} 236 214)`}>
        <rect x="231" y="128" width="10" height="92" rx="5" fill="#7A4A2A" stroke="#2B2D42" strokeWidth="4" />
        <rect x="206" y="108" width="60" height="30" rx="8" fill="#9A5E34" stroke="#2B2D42" strokeWidth="4.5" />
        <rect x="214" y="108" width="7" height="30" fill="#C9A227" opacity="0.9" />
        <rect x="251" y="108" width="7" height="30" fill="#C9A227" opacity="0.9" />
      </g>
    );
  }
  return null;
}

function Emote({ kind, age, x, y }: { kind: string; age: number; x: number; y: number }) {
  const pop = sp(age, 0, SPRING_POP);
  const out = prog(age, 0.95, 0.3);
  const a = clamp01(pop * 1.5) * (1 - out);
  if (a <= 0.01) return null;
  const s = 0.4 + 0.6 * pop;
  let body = null;
  if (kind === "!") body = <g><path d="M0,-34 L0,-6" stroke={C.cream} strokeWidth="9" strokeLinecap="round" /><circle cx="0" cy="8" r="5" fill={C.cream} /></g>;
  if (kind === "?") body = <g><path d="M-10,-26 Q-8,-38 4,-37 Q16,-35 14,-24 Q12,-15 2,-11 L1,-4" stroke={C.cream} strokeWidth="7" fill="none" strokeLinecap="round" /><circle cx="1" cy="9" r="4.5" fill={C.cream} /></g>;
  if (kind === "sweat") body = <path d={`M0,${-30 + age * 14} Q11,${-12 + age * 14} 0,${-4 + age * 14} Q-11,${-12 + age * 14} 0,${-30 + age * 14} Z`} fill="#8FD3FF" stroke="#2B2D42" strokeWidth="3" />;
  if (kind === "sparkle") {
    const star = (cx: number, cy: number, r: number) => `M${cx},${cy - r} L${cx + r * 0.28},${cy - r * 0.28} L${cx + r},${cy} L${cx + r * 0.28},${cy + r * 0.28} L${cx},${cy + r} L${cx - r * 0.28},${cy + r * 0.28} L${cx - r},${cy} L${cx - r * 0.28},${cy - r * 0.28} Z`;
    body = <g fill="#FFE27A"><path d={star(0, -16, 18 * (0.8 + 0.2 * Math.sin(age * 12)))} /><path d={star(22, 2, 9)} /><path d={star(-20, 6, 7)} /></g>;
  }
  return (
    <svg width={120} height={120} viewBox="-60 -60 120 120" style={{ position: "absolute", left: x - 60, top: y - 60, opacity: a, transform: `scale(${s}) rotate(${wobble(age, 0, 3, 4) * 12}deg)`, overflow: "visible", filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.6))" }}>
      {body}
    </svg>
  );
}

export function CatActor({ tl, t }: { tl: Timeline; t: number }) {
  const cat = catAt(tl, t);
  if (!cat.visible) return null;
  const { x, y, face, rot, travel } = cat.pos;
  const pose = (POSES.includes(cat.pose ?? "") ? cat.pose : "float") as CatPose;
  const expression = (cat.expression ?? "happy") as CatExpression;
  const take = catTakeAt(tl, t);
  const fl = floatOf(t);
  const top = y - CAT_H;

  // pointer
  const pointing = pose === "point" && cat.item === "pointer";
  const paw: [number, number] = [x + face * (284 - 160) * CAT_K, top + (198 + fl) * CAT_K];
  let tip: [number, number] | null = null;
  let look: [number, number] = [face > 0 ? 0.6 : -0.6, 0.1];
  const box = hlToScreen(tl, t, cat.lookAt ?? null);
  if (pointing) {
    const ext = springAt(t, Math.max(cat.itemT, cat.t0 + 0.5), { damping: 18, stiffness: 110 }) * (1 - clamp01(travel * 4));
    let target: [number, number] = box && box.w > 0 ? aim(paw, box) : [paw[0] + face * 110, paw[1] - 60];
    const prevBox = cat.prevLookAt ? hlToScreen(tl, t, cat.prevLookAt) : null;
    if (prevBox && prevBox.w > 0 && t - cat.lookT < 0.7) {
      const from = aim(paw, prevBox);
      const p = sp(t, cat.lookT);
      target = [lerp(from[0], target[0], p), lerp(from[1], target[1], p)];
    }
    const dx = target[0] - paw[0], dy = target[1] - paw[1];
    const len = Math.min(Math.hypot(dx, dy), 900);
    const d = Math.hypot(dx, dy) || 1;
    tip = ext > 0.01 ? [paw[0] + (dx / d) * len * ext, paw[1] + (dy / d) * len * ext] : null;
  }
  if (box && box.w > 0) {
    const bx = box.x + box.w / 2 - x, by = box.y + box.h / 2 - (top + 140 * CAT_K);
    const d = Math.hypot(bx, by) || 1;
    look = [(bx / d) * face, by / d];
  }
  // the head leads: it tilts toward where the cat is going / looking, the body follows a beat later
  const headTilt = clamp01(travel) * 10 * Math.sign(rot || 0) + look[1] * 6 * face + wobble(t, cat.t0, 1.6, 3) * 6;
  const fear = expression === "scared" ? 1 : expression === "wince" ? 0.6 : 0;
  // gavel strike lands on the lawsuit press (the beat carrying the lawsuit sfx)
  const lawT = tl.beats.find((b) => b.sfx === "lawsuit")?.t ?? Infinity;
  const strike = cat.item === "gavel" ? (t < lawT - 0.12 ? -0.25 * prog(t, lawT - 0.5, 0.38) : t < lawT ? lerp(-0.25, 1, (t - (lawT - 0.12)) / 0.12) : 1 - 0.35 * prog(t, lawT + 0.08, 0.5) + wobble(t, lawT, 4, 7) * 0.15) : 0;

  // the arc flash ("short") lights the cat for its 3 frames
  const arcT = tl.beats.find((b) => b.fx === "arc")?.t ?? Infinity;
  const flash = t >= arcT && t < arcT + 0.1 ? [1, 0.45, 0.15][Math.min(2, Math.floor((t - arcT) * 30))] : 0;
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
          transform: `rotate(${rot}deg) scaleX(${face * take.sx}) scaleY(${take.sy})`,
          filter: `url(#catRim)${flash > 0.01 ? ` brightness(${1 + 1.4 * flash})` : ""}`,
        }}
      >
        <Cat t={t} expression={expression} pose={pose} size={CAT_SIZE} lookAt={look} outfit="labcoat"
             goggles={cat.goggles === "down" ? "down" : "up"} blink={take.blink < 0.99 ? take.blink : undefined}
             earsBack={fear} headTilt={headTilt} />
        <svg viewBox="0 0 320 340" width={CAT_SIZE} height={CAT_H} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
          <g transform={`translate(0 ${fl})`}>
            <Items item={cat.item ?? "none"} t={t} strike={strike} />
          </g>
        </svg>
      </div>
      {take.emote ? <Emote kind={take.emote.kind} age={take.emote.age} x={x + face * 70} y={top + 8} /> : null}
    </>
  );
}
