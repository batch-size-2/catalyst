// The hexagon cat mark (design/logo/catalyst-mark.svg) as something that can draw itself:
// the head outline strokes on, then fills, the eyes open, the whiskers draw outwards; eyes can blink.
// Shared by the science intro ("I'm Catalyst") and the outro lockup, so the two moments rhyme.
import { clamp01 } from "../state";
import { C } from "../theme";

export const HEX = "M12 38 L15 9 L27 19 L37 19 L49 9 L52 38 L42 55 L22 55 Z";
const PTS: [number, number][] = [[12, 38], [15, 9], [27, 19], [37, 19], [49, 9], [52, 38], [42, 55], [22, 55], [12, 38]];
const SEG = PTS.slice(1).map((p, i) => Math.hypot(p[0] - PTS[i][0], p[1] - PTS[i][1]));
const PERIM = SEG.reduce((a, b) => a + b, 0);

// the point at fraction u of the outline (where the pen is while it draws)
export function hexPoint(u: number): [number, number] {
  let d = clamp01(u) * PERIM;
  for (let i = 0; i < SEG.length; i++) {
    if (d <= SEG[i] || i === SEG.length - 1) {
      const k = SEG[i] ? Math.min(1, d / SEG[i]) : 0;
      return [PTS[i][0] + (PTS[i + 1][0] - PTS[i][0]) * k, PTS[i][1] + (PTS[i + 1][1] - PTS[i][1]) * k];
    }
    d -= SEG[i];
  }
  return PTS[0];
}

const WHISKERS: [number, number, number, number][] = [[10, 41, 1, 38], [10, 46, 2, 49], [54, 41, 63, 38], [54, 46, 62, 49]];

export type MarkState = {
  draw: number; // 0..1 outline drawn
  fill: number; // 0..1 (may overshoot) fill flood
  eyes: number; // 0..1 (may overshoot) eyes open
  whisk: number; // 0..1 whiskers drawn
  blink?: number; // 0 open .. 1 closed
  pen?: number; // 0..1 brightness of the pen tip while drawing
};

export function CatMark({ size, s, stroke = 3 }: { size: number; s: MarkState; stroke?: number }) {
  const f = clamp01(s.fill);
  const eyeY = Math.max(0, s.eyes) * (1 - 0.9 * clamp01(s.blink ?? 0));
  const tip = hexPoint(s.draw);
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
      <path
        d={HEX}
        fill={C.orange}
        fillOpacity={f}
        stroke={C.orange}
        strokeWidth={stroke + (4 - stroke) * f}
        strokeLinejoin="round"
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray={s.draw >= 1 ? undefined : "1 1"}
        strokeDashoffset={s.draw >= 1 ? undefined : 1 - s.draw}
      />
      {/* eyes and nose are cut-outs: they open with a little overshoot, and blink */}
      <g opacity={clamp01(f * 3)}>
        {[25, 39].map((cx) => (
          <rect key={cx} x={cx - 2.5} y={36 - 5 * eyeY} width={5} height={Math.max(0.4, 10 * eyeY)} rx={2.5 * Math.min(1, eyeY * 2 + 0.2)} fill={C.bg} />
        ))}
        <path d="M29.5 45 L34.5 45 L32 48 Z" fill={C.bg} opacity={clamp01(s.eyes)} />
      </g>
      {WHISKERS.map(([x1, y1, x2, y2], i) => {
        const w = clamp01(s.whisk * 1.25 - (i % 2) * 0.25);
        if (w <= 0) return null;
        return <line key={i} x1={x1} y1={y1} x2={x1 + (x2 - x1) * w} y2={y1 + (y2 - y1) * w} stroke={C.orange} strokeWidth={3} strokeLinecap="round" />;
      })}
      {s.pen && s.pen > 0.01 && s.draw > 0 && s.draw < 1 ? (
        <g opacity={s.pen}>
          <circle cx={tip[0]} cy={tip[1]} r={4.2} fill={C.orange} opacity={0.35} />
          <circle cx={tip[0]} cy={tip[1]} r={1.9} fill={C.cream} />
        </g>
      ) : null}
    </svg>
  );
}

// a soft orange bloom behind the mark (light, not a shape)
export function Bloom({ x, y, r, a }: { x: number; y: number; r: number; a: number }) {
  if (a <= 0.005) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: x - r,
        top: y - r,
        width: 2 * r,
        height: 2 * r,
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(255,122,47,0.55) 0%, rgba(255,122,47,0.22) 32%, rgba(255,122,47,0.06) 55%, transparent 70%)",
        opacity: a,
        mixBlendMode: "screen",
      }}
    />
  );
}
