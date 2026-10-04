/**
 * Catalyst the cat: our orange mascot, drawn entirely in SVG.
 *
 * Plain React with no other dependencies, so it works in the web app and in Remotion.
 * Pass `t` (seconds) to animate the idle loop (float, blink, tail sway, ear twitch):
 *
 *   // Remotion
 *   const frame = useCurrentFrame(); const { fps } = useVideoConfig();
 *   <Cat t={frame / fps} expression="curious" pose="point" size={320} />
 *
 * Static exports and a live preview: see assets/README.md.
 */
import { useId, type CSSProperties } from "react";

export type CatExpression = "happy" | "curious" | "surprised" | "proud" | "shrug"
  | "focused" | "thinking" | "wince" | "smug" | "scared";   // opt-in extras (the video's acting)
export type CatPose = "float" | "hold" | "point" | "wave" | "shrug" | "stamp";

export type CatProps = {
  t?: number;                    // seconds; drives the idle animation
  expression?: CatExpression;
  pose?: CatPose;
  size?: number;                 // width in px; height follows the 320 x 340 viewBox
  lookAt?: [number, number];     // pupil direction, each in -1..1
  idle?: boolean;                // false freezes float, blink, tail and ears
  outfit?: "none" | "labcoat";   // "labcoat": open lab coat, sleeves, pocket pens, ID badge, graphite goggle strap
  style?: CSSProperties;
  // opt-in (all default to the original look)
  goggles?: "up" | "down";       // "down": over the eyes, for focused moments
  blink?: number;                // overrides the idle blink: 1 open, 0 shut (anticipation squints, slow blinks)
  earsBack?: number;             // 0..1 flattens both ears (fright)
  headTilt?: number;             // degrees; the head turns ahead of the body
};

export const CAT_COLORS = {
  ink: "#2B2D42",
  fur: "#F59A3C",
  stripe: "#D6721C",
  cream: "#FFF0DC",
  pink: "#FF9FB0",
  mouth: "#7A3A4A",
  lens: "#BDEDEA",
  strap: "#14A39A",
  shadow: "#2B2D42",
};

const C = CAT_COLORS;
const INK = { stroke: C.ink, strokeWidth: 5, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };

export function Cat({
  t = 0, expression = "happy", pose = "float", size = 260, lookAt = [0, 0], idle = true, style, outfit = "none",
  goggles = "up", blink: blinkOverride, earsBack = 0, headTilt = 0,
}: CatProps) {
  const coat = outfit === "labcoat";
  const id = useId().replace(/:/g, "");
  const float = idle ? Math.sin((t * 2 * Math.PI) / 3) * 8 : 0;
  const tail = idle ? Math.sin(t * 1.7) * 9 : 0;
  const bp = (t + 0.8) % 3.4;
  const blink = blinkOverride ?? (idle && bp < 0.18 ? 1 - Math.sin((bp / 0.18) * Math.PI) * 0.92 : 1);
  const down = goggles === "down";
  const ep = (t + 2) % 5.3;
  const ear = idle && ep < 0.35 ? -Math.sin((ep / 0.35) * Math.PI) * 12 : 0;
  const [lx, ly] = [clamp(lookAt[0]) * 5, clamp(lookAt[1]) * 4];

  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 340" width={size} height={(size * 340) / 320} style={style}
         role="img" aria-label="Catalyst the cat">
      <defs>
        <clipPath id={`head-${id}`}><ellipse cx="160" cy="135" rx="100" ry="84" /></clipPath>
        <clipPath id={`body-${id}`}><ellipse cx="160" cy="240" rx="82" ry="70" /></clipPath>
        <clipPath id={`tail-${id}`}><path d={TAIL} /></clipPath>
      </defs>

      <ellipse cx="160" cy="330" rx={62 * (1 - float / 70)} ry="7" fill={C.shadow} opacity={0.12 - float / 400} />

      <g transform={`translate(0 ${float})`}>
        {/* tail, behind the body */}
        <g transform={`rotate(${tail} 222 258)`}>
          <path d={TAIL} fill={C.fur} {...INK} />
          <g clipPath={`url(#tail-${id})`} stroke={C.stripe} strokeWidth="9" strokeLinecap="round">
            <line x1="296" y1="214" x2="268" y2="208" />
            <line x1="286" y1="240" x2="262" y2="228" />
            <line x1="266" y1="262" x2="248" y2="240" />
          </g>
          <path d={TAIL} fill="none" {...INK} />
        </g>

        {/* body */}
        <ellipse cx="160" cy="240" rx="82" ry="70" fill={C.fur} />
        <g clipPath={`url(#body-${id})`} stroke={C.stripe} strokeWidth="9" strokeLinecap="round" fill="none">
          <path d="M76,222 Q96,226 104,240" />
          <path d="M78,252 Q96,254 102,266" />
          <path d="M244,222 Q224,226 216,240" />
          <path d="M242,252 Q224,254 218,266" />
        </g>
        <ellipse cx="160" cy="258" rx="48" ry="42" fill={C.cream} />
        <ellipse cx="160" cy="240" rx="82" ry="70" fill="none" {...INK} />
        {coat && <LabCoat />}

        {/* feet */}
        <ellipse cx="126" cy="304" rx="22" ry="13" fill={C.cream} {...INK} />
        <ellipse cx="194" cy="304" rx="22" ry="13" fill={C.cream} {...INK} />

        <g transform={`rotate(${headTilt} 160 214)`}>
        {/* ears */}
        <g transform={`rotate(${ear - earsBack * 28} 104 84)`}>
          <path d="M70,112 L80,40 Q84,28 96,34 L140,66 Z" fill={C.fur} {...INK} />
          <path d="M90,92 L94,54 L124,74 Z" fill={C.pink} />
        </g>
        <g transform={`rotate(${earsBack * 28} 216 84)`}>
          <path d="M250,112 L240,40 Q236,28 224,34 L180,66 Z" fill={C.fur} {...INK} />
          <path d="M230,92 L226,54 L196,74 Z" fill={C.pink} />
        </g>

        {/* head */}
        <ellipse cx="160" cy="135" rx="100" ry="84" fill={C.fur} />
        <g clipPath={`url(#head-${id})`}>
          <g stroke={C.stripe} strokeWidth="8" strokeLinecap="round">
            <line x1="56" y1="126" x2="82" y2="130" />
            <line x1="58" y1="146" x2="80" y2="146" />
            <line x1="264" y1="126" x2="238" y2="130" />
            <line x1="262" y1="146" x2="240" y2="146" />
            <line x1="160" y1="56" x2="160" y2="70" />
          </g>
          {down
            ? <path d="M58,134 Q160,118 262,134" fill="none" stroke={coat ? COAT.strap : C.strap} strokeWidth="10" />
            : <path d="M58,116 Q160,60 262,116" fill="none" stroke={coat ? COAT.strap : C.strap} strokeWidth="9" />}
        </g>
        <ellipse cx="160" cy="135" rx="100" ry="84" fill="none" {...INK} />

        {/* goggles pushed up on the forehead */}
        {!down && <line x1="148" y1="92" x2="172" y2="92" stroke={C.ink} strokeWidth="4" />}
        {!down && [130, 190].map((x) => (
          <g key={x}>
            <circle cx={x} cy="92" r="18" fill={C.lens} stroke={C.ink} strokeWidth="4" />
            <path d={`M${x - 9},${86} Q${x - 5},${80} ${x + 1},${80}`} stroke="#fff" strokeWidth="3.5"
                  fill="none" strokeLinecap="round" />
          </g>
        ))}

        <Eyes expression={expression} blink={blink} lx={lx} ly={ly} />
        {down && <GogglesDown t={t} />}

        {/* muzzle, blush, nose, mouth, whiskers */}
        <ellipse cx="146" cy="172" rx="21" ry="15" fill={C.cream} />
        <ellipse cx="174" cy="172" rx="21" ry="15" fill={C.cream} />
        <ellipse cx="96" cy="166" rx="14" ry="8" fill={C.pink} opacity="0.75" />
        <ellipse cx="224" cy="166" rx="14" ry="8" fill={C.pink} opacity="0.75" />
        <path d="M151,158 Q160,153 169,158 Q165,166 160,167 Q155,166 151,158 Z" fill="#FF8FA3"
              stroke={C.ink} strokeWidth="2.5" strokeLinejoin="round" />
        <Mouth expression={expression} />
        <g stroke={C.ink} strokeWidth="2.5" strokeLinecap="round" opacity="0.8">
          <line x1="122" y1="170" x2="82" y2="162" />
          <line x1="122" y1="178" x2="80" y2="180" />
          <line x1="198" y1="170" x2="238" y2="162" />
          <line x1="198" y1="178" x2="240" y2="180" />
        </g>
        </g>

        <Paws pose={pose} t={t} idle={idle} sleeve={coat ? COAT.cloth : C.fur} />
      </g>
    </svg>
  );
}

const TAIL = "M214,268 C264,278 300,236 290,190 C286,170 262,170 264,188 C270,226 252,250 214,246 Z";

function clamp(v: number) {
  return Math.max(-1, Math.min(1, v));
}

/** Goggles down over the eyes: graphite frames, tinted lenses, a glint that sweeps across now and then. */
function GogglesDown({ t }: { t: number }) {
  const g = ((t * 0.45) % 1) * 3 - 1;   // the glint sweeps once every ~2.2 s
  return (
    <g>
      <path d="M146,140 Q160,132 174,140" stroke={COAT.strap} strokeWidth="7" fill="none" strokeLinecap="round" />
      {[122, 198].map((x) => (
        <g key={x}>
          <circle cx={x} cy="140" r="29" fill="rgba(170,205,215,0.34)" stroke="#2A2C33" strokeWidth="8" />
          <circle cx={x} cy="140" r="29" fill="none" stroke="#FF7A2F" strokeWidth="2" opacity="0.5" />
          {g > -0.4 && g < 1.4 && (
            <path d={`M${x - 16 + g * 20},${126} L${x - 4 + g * 20},${152}`} stroke="#fff" strokeWidth="5"
                  strokeLinecap="round" opacity={0.55 * Math.sin(Math.min(1, Math.max(0, (g + 0.4) / 1.8)) * Math.PI)} />
          )}
          <path d={`M${x - 17},${130} Q${x - 11},${121} ${x - 1},${119}`} stroke="#fff" strokeWidth="3.5"
                fill="none" strokeLinecap="round" opacity="0.7" />
        </g>
      ))}
    </g>
  );
}

function Eyes({ expression, blink, lx, ly }: { expression: CatExpression; blink: number; lx: number; ly: number }) {
  if (expression === "wince") {
    return (
      <g fill="none" stroke={C.ink} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M108,128 L132,140 L108,152" />
        <path d="M212,128 L188,140 L212,152" />
      </g>
    );
  }
  if (expression === "focused" || expression === "smug") {
    // narrowed eyes under a flat lid: the cool look
    const ry = (expression === "smug" ? 11 : 9) * blink;
    return (
      <g>
        {[122, 198].map((cx) => (
          <g key={cx}>
            <ellipse cx={cx + lx * 0.4} cy={143 + ly * 0.3} rx="15" ry={Math.max(1.5, ry)} fill={C.ink} />
            {blink > 0.5 && <circle cx={cx + lx + 5} cy={140 + ly * 0.3} r="3.5" fill="#fff" />}
            <path d={`M${cx - 18},${136 - (expression === "smug" ? 1 : 3)} L${cx + 18},${136 - (expression === "smug" ? 4 : 2)}`}
                  stroke={C.ink} strokeWidth="5" strokeLinecap="round" />
          </g>
        ))}
      </g>
    );
  }
  if (expression === "scared") {
    return (
      <g>
        {[122, 198].map((cx) => (
          <g key={cx} transform={`translate(${cx} 140) scale(1 ${blink}) translate(${-cx} -140)`}>
            <ellipse cx={cx} cy="140" rx="19" ry="24" fill="#fff" stroke={C.ink} strokeWidth="4.5" />
            <circle cx={cx + lx * 0.8} cy={142 + ly * 0.6} r="7" fill={C.ink} />
          </g>
        ))}
        <g fill="none" stroke={C.ink} strokeWidth="4" strokeLinecap="round">
          <path d="M104,106 Q120,96 136,102" />
          <path d="M216,106 Q200,96 184,102" />
        </g>
      </g>
    );
  }
  if (expression === "thinking") {
    return <Eyes expression="curious" blink={blink} lx={-4} ly={-4} />;
  }
  if (expression === "proud") {
    return (
      <g fill="none" stroke={C.ink} strokeWidth="5" strokeLinecap="round">
        <path d="M106,144 Q122,126 138,144" />
        <path d="M182,144 Q198,126 214,144" />
      </g>
    );
  }
  const big = expression === "surprised";
  const sleepy = expression === "shrug";
  const rx = big ? 17 : 15;
  const ry = big ? 22 : sleepy ? 13 : 19;
  const eye = (cx: number, scale = 1) => (
    <g transform={`translate(${cx} 140) scale(1 ${blink}) translate(${-cx} -140)`}>
      <ellipse cx={cx + lx * 0.4} cy={140 + ly * 0.4} rx={rx * scale} ry={ry * scale} fill={C.ink} />
      <circle cx={cx + lx + 5} cy={140 + ly - ry * 0.4} r={big ? 6 : 5} fill="#fff" />
      <circle cx={cx + lx - 4} cy={140 + ly + ry * 0.4} r="2.5" fill="#fff" />
    </g>
  );
  return (
    <g>
      {eye(122)}
      {eye(198, expression === "curious" ? 0.88 : 1)}
      {expression === "curious" && (
        <path d="M108,112 Q122,104 136,110" fill="none" stroke={C.ink} strokeWidth="4" strokeLinecap="round" />
      )}
      {sleepy && (
        <g fill="none" stroke={C.ink} strokeWidth="4" strokeLinecap="round">
          <path d="M108,118 L136,124" />
          <path d="M212,118 L184,124" />
        </g>
      )}
    </g>
  );
}

function Mouth({ expression }: { expression: CatExpression }) {
  const line = { fill: "none", stroke: C.ink, strokeWidth: 3.5, strokeLinecap: "round" as const };
  switch (expression) {
    case "focused":
    case "smug":
      return <path d="M148,177 Q160,182 173,170" {...line} />;
    case "thinking":
      return <path d="M151,178 L167,176" {...line} />;
    case "wince":
      return <path d="M144,180 L150,175 L156,180 L162,175 L168,180 L174,175" {...line} strokeLinejoin="round" />;
    case "scared":
      return <ellipse cx="160" cy="184" rx="8" ry="11" fill={C.mouth} stroke={C.ink} strokeWidth="3" />;
    case "surprised":
      return <ellipse cx="160" cy="182" rx="7" ry="9" fill={C.mouth} stroke={C.ink} strokeWidth="3" />;
    case "proud":
      return (
        <g>
          <path d="M143,171 Q160,196 177,171 Z" fill={C.mouth} stroke={C.ink} strokeWidth="3" strokeLinejoin="round" />
          <path d="M152,182 Q160,178 168,182 Q164,188 160,188 Q156,188 152,182 Z" fill={C.pink} />
        </g>
      );
    case "shrug":
      return <path d="M149,178 Q160,174 171,178" {...line} />;
    case "curious":
      return <path d="M152,175 Q160,181 168,175" {...line} />;
    default:
      return <path d="M146,172 Q153,181 160,171 Q167,181 174,172" {...line} />;
  }
}

function Paw({ x, y, rot = 0 }: { x: number; y: number; rot?: number }) {
  return (
    <g transform={`rotate(${rot} ${x} ${y})`}>
      <ellipse cx={x} cy={y} rx="17" ry="14" fill={C.cream} {...INK} strokeWidth={4.5} />
      <g stroke={C.ink} strokeWidth="2.5" strokeLinecap="round">
        <line x1={x - 5} y1={y + 6} x2={x - 5} y2={y + 12} />
        <line x1={x + 5} y1={y + 6} x2={x + 5} y2={y + 12} />
      </g>
    </g>
  );
}

function Arm({ from, to, sleeve = C.fur }: { from: [number, number]; to: [number, number]; sleeve?: string }) {
  const d = `M${from[0]},${from[1]} L${to[0]},${to[1]}`;
  return (
    <g strokeLinecap="round" fill="none">
      <path d={d} stroke={C.ink} strokeWidth="27" />
      <path d={d} stroke={sleeve} strokeWidth="18" />
    </g>
  );
}

function Paws({ pose, t, idle, sleeve }: { pose: CatPose; t: number; idle: boolean; sleeve: string }) {
  const rest = <><Paw x={130} y={236} /><Paw x={190} y={236} /></>;
  switch (pose) {
    case "hold":
      return <><Paw x={128} y={214} rot={-12} /><Paw x={192} y={214} rot={12} /></>;
    case "point":
      return (
        <>
          <Paw x={130} y={236} />
          <Arm sleeve={sleeve} from={[214, 226]} to={[278, 200]} />
          <Paw x={284} y={198} rot={-70} />
        </>
      );
    case "wave": {
      const a = ((-62 + (idle ? Math.sin(t * 8) * 16 : 0)) * Math.PI) / 180;
      const end: [number, number] = [216 + Math.cos(a) * 62, 222 + Math.sin(a) * 62];
      return (
        <>
          <Paw x={130} y={236} />
          <Arm sleeve={sleeve} from={[216, 222]} to={end} />
          <Paw x={end[0]} y={end[1] - 4} rot={(a * 180) / Math.PI + 90} />
        </>
      );
    }
    case "shrug":
      return (
        <>
          <Arm sleeve={sleeve} from={[100, 222]} to={[56, 188]} />
          <Paw x={50} y={182} rot={30} />
          <Arm sleeve={sleeve} from={[220, 222]} to={[264, 188]} />
          <Paw x={270} y={182} rot={-30} />
        </>
      );
    case "stamp": {
      const press = idle ? Math.max(0, Math.sin(t * 3)) * 10 : 0;
      return (
        <>
          <Paw x={130} y={236} />
          <Arm sleeve={sleeve} from={[212, 236]} to={[240, 282 + press]} />
          <Paw x={242} y={292 + press} rot={180} />
        </>
      );
    }
    default:
      return rest;
  }
}

const COAT = { cloth: "#F2F0EA", fold: "#D3CFC6", lapel: "#E4E1D9", pocket: "#E7E4DC", strap: "#3A3D46" };

/** Open lab coat drawn over the body: the belly shows through the front, pens in the pocket, a badge with the mark. */
function LabCoat() {
  return (
    <g>
      <ellipse cx="160" cy="243" rx="86" ry="71" fill={COAT.cloth} {...INK} />
      <path d="M226,196 Q252,244 224,302" stroke={COAT.fold} strokeWidth="12" fill="none" strokeLinecap="round" opacity="0.8" />
      <path d="M94,196 Q70,244 96,302" stroke={COAT.lapel} strokeWidth="8" fill="none" strokeLinecap="round" opacity="0.8" />
      <path d="M141,172 L179,172 L171,312 Q160,316 149,312 Z" fill={C.cream} />
      <path d="M141,172 L149,312 M179,172 L171,312" stroke={C.ink} strokeWidth="4" strokeLinecap="round" />
      <path d="M141,172 L117,182 L139,228 Z M179,172 L203,182 L181,228 Z" fill={COAT.lapel} stroke={C.ink}
            strokeWidth="3.5" strokeLinejoin="round" />
      <line x1="104" y1="256" x2="104" y2="238" stroke="#FF7A2F" strokeWidth="5" strokeLinecap="round" />
      <line x1="113" y1="256" x2="115" y2="241" stroke="#6EA8FF" strokeWidth="5" strokeLinecap="round" />
      <rect x="96" y="254" width="32" height="26" rx="5" fill={COAT.pocket} stroke={C.ink} strokeWidth="3.5" />
      <rect x="196" y="258" width="28" height="36" rx="5" fill="#1B1C21" stroke={C.ink} strokeWidth="3" />
      <path transform="translate(197.6 260) scale(0.39)" d="M12 38 L15 9 L27 19 L37 19 L49 9 L52 38 L42 55 L22 55 Z"
            fill="#FF7A2F" stroke="#FF7A2F" strokeWidth="4" strokeLinejoin="round" />
      <rect x="201" y="285" width="18" height="3" rx="1.5" fill="#8A8C92" />
    </g>
  );
}
