// Line art for the news cards (illustrative, no numbers) and the faint car rows behind them.
import { clamp01, prog } from "../state";
import { C } from "../theme";

export type ArtKind = "car" | "ev" | "phone";
export type ArtFx = {
  draw: number; // 0..1 the strokes draw themselves
  battery: number; // 0..1 the pack lights up (the Bolt: "battery")
  fault: number; // 0..1 some cells turn red ("faulty")
  swapOut: number; // 0..1 the old pack drops out (Hyundai: "swap")
  swapIn: number; // 0..1+ the new pack springs in
  t: number; // for idle pulses
};
export const ART_DONE: ArtFx = { draw: 1, battery: 0, fault: 0, swapOut: 0, swapIn: 0, t: 0 };

const INK = "rgba(237,236,232,0.9)";
const INK2 = "rgba(237,236,232,0.46)";
const dash = (p: number) => ({ pathLength: 1, strokeDasharray: 1, strokeDashoffset: 1 - clamp01(p) });

// staggered sub-progress: element k of n starts a little after the previous one
const sub = (p: number, k: number, n: number, span = 0.55) => clamp01((p - (k / n) * (1 - span)) / span);

// ---- the cars (raw coordinates face right; the group is mirrored so they face into the frame) ----
const BOLT = {
  body: "M150 150 L147 114 Q147 94 160 82 L190 54 Q198 46 212 45 L330 42 Q354 42 370 54 L420 88 L498 98 Q522 102 526 118 L528 140 Q528 150 518 150 L486 150 A31 31 0 0 0 424 150 L246 150 A31 31 0 0 0 184 150 Z",
  glass: "M198 84 L214 58 Q219 52 228 52 L326 50 Q344 50 356 60 L396 86 Z",
  lines: ["M292 51 L294 86", "M296 90 L300 146", "M500 106 Q512 107 520 112", "M151 92 L157 104"],
  wheels: [215, 455],
  r: 24,
  pack: { x: 250, y: 131, w: 170, h: 15 },
};
const KONA = {
  body: "M138 150 L136 104 Q136 82 150 72 L180 48 Q188 41 202 40 L360 38 Q382 38 396 50 L436 84 L510 94 Q532 98 536 116 L538 142 Q538 150 528 150 L494 150 A32 32 0 0 0 430 150 L242 150 A32 32 0 0 0 178 150 Z",
  glass: "M194 80 L208 56 Q213 50 222 50 L354 48 Q370 48 380 57 L410 82 Z",
  lines: ["M290 49 L291 82", "M296 86 L299 146", "M506 102 Q520 104 528 110", "M139 88 L146 100", "M212 33 L352 31", "M224 33 L224 40", "M340 31 L340 38"],
  wheels: [210, 462],
  r: 26,
  pack: { x: 248, y: 132, w: 176, h: 15 },
};
const BOLT_SIGN = "M356 90 L344 108 L354 108 L347 125 L366 102 L356 102 L363 90 Z";

function Pack({ x, y, w, h, n, fx, faulty, dy = 0, alpha = 1, fresh = 0 }: { x: number; y: number; w: number; h: number; n: number; fx: ArtFx; faulty?: number[]; dy?: number; alpha?: number; fresh?: number }) {
  const cw = (w - 6) / n;
  const lit = clamp01(fx.battery);
  const stroke = fresh > 0 ? `rgba(255,154,92,${0.4 + 0.5 * fresh})` : lit > 0 ? `rgba(255,154,92,${0.3 + 0.6 * lit})` : INK2;
  return (
    <g transform={`translate(0 ${dy})`} opacity={alpha * clamp01(fx.draw * 1.4 - 0.3)}>
      <rect x={x} y={y} width={w} height={h} rx={3} fill={`rgba(255,122,47,${0.05 * Math.max(lit, fresh)})`} stroke={stroke} strokeWidth={1.6} />
      {Array.from({ length: n }, (_, i) => {
        const bad = faulty?.includes(i) ? fx.fault : 0;
        const pulse = bad > 0 ? 0.55 + 0.3 * Math.sin(fx.t * 10 + i) : 0;
        return (
          <rect
            key={i}
            x={x + 3 + i * cw + 1.5}
            y={y + 3}
            width={cw - 3}
            height={h - 6}
            rx={1.5}
            fill={bad > 0 ? `rgba(248,113,113,${bad * pulse})` : "transparent"}
            stroke={bad > 0 ? `rgba(248,113,113,${0.4 + 0.6 * bad})` : stroke}
            strokeWidth={1.1}
          />
        );
      })}
    </g>
  );
}

function CarArt({ kind, fx }: { kind: "car" | "ev"; fx: ArtFx }) {
  const m = kind === "car" ? BOLT : KONA;
  const d = fx.draw;
  return (
    <g transform="translate(686 0) scale(-1 1)">
      <path d="M70 176 L616 176" stroke={INK2} strokeWidth={1.4} {...dash(sub(d, 0, 6, 0.6))} />
      <path d={m.body} fill="rgba(10,11,13,0.35)" fillOpacity={clamp01(d * 2 - 1)} stroke={INK} strokeWidth={2.4} strokeLinejoin="round" {...dash(sub(d, 1, 6, 0.6))} />
      <path d={m.glass} fill="rgba(237,236,232,0.035)" stroke={INK2} strokeWidth={1.6} strokeLinejoin="round" {...dash(sub(d, 2, 6))} />
      {m.lines.map((l, i) => (
        <path key={i} d={l} fill="none" stroke={INK2} strokeWidth={1.6} strokeLinecap="round" {...dash(sub(d, 3, 6))} />
      ))}
      {m.wheels.map((cx, i) => (
        <g key={cx}>
          <circle cx={cx} cy={150} r={m.r} fill="#121317" fillOpacity={sub(d, 2 + i, 6)} stroke={INK} strokeWidth={2.4} {...dash(sub(d, 2 + i, 6))} />
          <circle cx={cx} cy={150} r={m.r * 0.38} fill="none" stroke={INK2} strokeWidth={1.4} opacity={clamp01(d * 2 - 1)} />
        </g>
      ))}
      {kind === "car" ? (
        <Pack {...BOLT.pack} n={8} fx={fx} faulty={[1, 4, 5]} />
      ) : (
        <>
          <path d={BOLT_SIGN} fill="rgba(255,154,92,0.12)" stroke="rgba(255,154,92,0.7)" strokeWidth={1.4} strokeLinejoin="round" opacity={clamp01(d * 2 - 1)} />
          {/* "swap the batteries": the old pack drops out, a fresh one springs in */}
          <Pack {...KONA.pack} n={8} fx={fx} dy={fx.swapOut * 30} alpha={1 - fx.swapOut} />
          {fx.swapIn > 0.001 ? <Pack {...KONA.pack} n={8} fx={fx} dy={(1 - fx.swapIn) * 30} alpha={clamp01(fx.swapIn * 2)} fresh={clamp01(1.6 - fx.swapIn)} /> : null}
        </>
      )}
    </g>
  );
}

function PhoneArt({ fx }: { fx: ArtFx }) {
  const d = fx.draw;
  const heat = clamp01(d * 2 - 1);
  return (
    <g transform="rotate(-9 340 100)">
      <rect x={296} y={18} width={88} height={162} rx={15} fill="#121317" fillOpacity={sub(d, 0, 4, 0.6)} stroke={INK} strokeWidth={2.4} {...dash(sub(d, 0, 4, 0.6))} />
      <rect x={304} y={34} width={72} height={130} rx={5} fill="rgba(237,236,232,0.03)" stroke={INK2} strokeWidth={1.4} {...dash(sub(d, 1, 4))} />
      <path d="M327 26 L353 26" stroke={INK2} strokeWidth={2} strokeLinecap="round" {...dash(sub(d, 1, 4))} />
      <rect x={325} y={78} width={30} height={52} rx={4} fill="none" stroke="rgba(248,113,113,0.75)" strokeWidth={1.6} {...dash(sub(d, 2, 4))} />
      <rect x={334} y={73} width={12} height={5} rx={1.5} fill="rgba(248,113,113,0.75)" opacity={heat} />
      <rect x={329} y={114} width={22} height={12} rx={2} fill="rgba(248,113,113,0.55)" opacity={heat} />
      {[0, 1, 2].map((i) => {
        const x = 402 + i * 20;
        const rise = ((fx.t * 0.5 + i * 0.33) % 1) * 10;
        return (
          <path
            key={i}
            d={`M${x} ${92 - i * 8 - rise} q 9 -11 0 -22 q -9 -11 0 -22`}
            fill="none"
            stroke="rgba(237,236,232,0.3)"
            strokeWidth={1.6}
            strokeLinecap="round"
            opacity={heat * (0.5 + 0.5 * Math.sin(fx.t * 2 + i * 1.7) ** 2)}
            {...dash(sub(d, 3, 4))}
          />
        );
      })}
    </g>
  );
}

export function CardArt({ kind, fx }: { kind: ArtKind; fx: ArtFx }) {
  return (
    <svg viewBox={kind === "phone" ? "0 4 686 192" : "60 26 566 160"} width="100%" height="100%" style={{ display: "block", overflow: "visible" }}>
      {kind === "phone" ? <PhoneArt fx={fx} /> : <CarArt kind={kind} fx={fx} />}
    </svg>
  );
}

// ---- the faint car rows behind the scene: they fill in from the centre, and on "every" a red
// recall wave runs through all of them. Alternate rows drift in opposite directions, like lanes. ----
const CAR = "M6 24 L10 15 Q14 8 26 8 L44 8 Q52 8 58 14 L66 16 Q70 17 70 22 L70 25 L6 25 Z";
export function CarRows({ t, t0, tRed, out, push, bright = 1 }: { t: number; t0: number; tRed: number; out: number; push: number; bright?: number }) {
  if (out >= 1) return null;
  const cols = 16;
  const rows = 7;
  const cars = [];
  for (let r = 0; r < rows; r++) {
    const lane = (r % 2 ? 1 : -1) * 26 * prog(t, t0, 15, (x) => x);
    for (let c = 0; c < cols; c++) {
      const cx = c * 128 + (r % 2) * 64 - 40 + lane;
      const cy = r * 128 + 70;
      const d = Math.hypot((cx + 35 - 960) / 128, ((cy - 470) / 128) * 1.5);
      const edge = Math.max(0, 1 - Math.hypot((cx + 35 - 960) / 1150, (cy - 470) / 600));
      const a = prog(t, t0 + d * 0.06, 0.55) * Math.min(1, edge * 2.4);
      if (a <= 0.003) continue;
      const red = prog(t, tRed + d * 0.07, 0.35) * (1 - 0.45 * prog(t, tRed + d * 0.07 + 0.5, 1.2));
      const s = `rgba(${Math.round(237 + (248 - 237) * red)},${Math.round(236 + (113 - 236) * red)},${Math.round(232 + (113 - 232) * red)},${(0.13 + 0.17 * red) * bright})`;
      cars.push(
        <g key={`${r}-${c}`} transform={`translate(${cx} ${cy})`} opacity={a}>
          <path d={CAR} fill="none" stroke={s} strokeWidth="2" strokeLinejoin="round" />
          <circle cx="20" cy="25" r="6" fill={C.bg} stroke={s} strokeWidth="2" />
          <circle cx="56" cy="25" r="6" fill={C.bg} stroke={s} strokeWidth="2" />
        </g>,
      );
    }
  }
  return (
    <svg width={1920} height={1080} style={{ position: "absolute", left: 0, top: 0, opacity: 1 - out, transform: `scale(${push})`, transformOrigin: "960px 470px" }}>
      {cars}
    </svg>
  );
}
