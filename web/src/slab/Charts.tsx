import type { ReactNode } from "react";

export interface Series {
  xs: number[];
  ys: number[];
  color: string;
  dash?: string;
  width?: number;
}

export interface Band {
  xs: number[];
  lo: number[];
  hi: number[];
  color: string;
}

interface Props {
  title: string;
  caption?: ReactNode;
  x: [number, number];
  y: [number, number];
  xTicks: number[];
  yTicks: number[];
  fx?: (v: number) => string;
  fy?: (v: number) => string;
  series?: Series[];
  bands?: Band[];
  shade?: { x0: number; x1: number; color: string; label?: string }[];
  markers?: { x: number; color?: string }[];
  hlines?: { y: number; label: string; color?: string }[];
  height?: number;
}

const W = 340;
const PAD = { l: 40, r: 14, t: 8, b: 22 };

export function Chart({
  title, caption, x, y, xTicks, yTicks, fx = String, fy = String, series = [], bands = [], shade = [],
  markers = [], hlines = [], height = 130,
}: Props) {
  const sx = (v: number) => PAD.l + ((v - x[0]) / (x[1] - x[0])) * (W - PAD.l - PAD.r);
  const sy = (v: number) => height - PAD.b - ((Math.min(Math.max(v, y[0]), y[1]) - y[0]) / (y[1] - y[0])) * (height - PAD.t - PAD.b);
  const path = (xs: number[], ys: number[]) => xs.map((v, i) => `${i ? "L" : "M"}${sx(v).toFixed(1)},${sy(ys[i]).toFixed(1)}`).join("");
  return (
    <figure className="mt-3 rounded-[14px] border border-cx-line-soft bg-black/20 p-2.5">
      <figcaption className="mb-1.5 flex flex-col gap-0.5 px-0.5">
        <span className="text-[12px] font-medium text-cx-text-2">{title}</span>
        {caption && <span className="text-[11px] text-cx-faint">{caption}</span>}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${height}`} className="block w-full overflow-hidden">
        {shade.map((s, i) => (
          <g key={i}>
            <rect x={sx(s.x0)} y={PAD.t} width={Math.max(0, sx(s.x1) - sx(s.x0))} height={height - PAD.t - PAD.b} fill={s.color} />
            {s.label && <text x={sx(s.x0) + 3} y={PAD.t + 10} fontSize={9} fill="#FCA5A5">{s.label}</text>}
          </g>
        ))}
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line x1={PAD.l} x2={W - PAD.r} y1={sy(t)} y2={sy(t)} stroke="rgba(255,255,255,0.06)" />
            <text x={PAD.l - 4} y={sy(t) + 3} fontSize={9} textAnchor="end" fill="#8A8C92" className="mono">{fy(t)}</text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={`x${t}`} x={sx(t)} y={height - 8} fontSize={9} fill="#8A8C92" className="mono"
            textAnchor={t === x[0] ? "start" : t === x[1] ? "end" : "middle"}>{fx(t)}</text>
        ))}
        {hlines.map((h) => (
          <g key={h.label}>
            <line x1={PAD.l} x2={W - PAD.r} y1={sy(h.y)} y2={sy(h.y)} stroke={h.color ?? "#F87171"} strokeDasharray="3 3" />
            <text x={W - PAD.r - 2} y={sy(h.y) - 3} fontSize={9} textAnchor="end" fill={h.color ?? "#FCA5A5"}>{h.label}</text>
          </g>
        ))}
        {bands.map((b, i) => (
          <path key={i} d={`${path(b.xs, b.hi)}L${[...b.xs].reverse().map((v, j) => `${sx(v).toFixed(1)},${sy(b.lo[b.lo.length - 1 - j]).toFixed(1)}`).join("L")}Z`}
            fill={b.color} opacity={0.22} />
        ))}
        {series.map((s, i) => (
          <path key={i} d={path(s.xs, s.ys)} fill="none" stroke={s.color} strokeWidth={s.width ?? 1.6} strokeDasharray={s.dash} />
        ))}
        {markers.map((m, i) => (
          <line key={i} x1={sx(m.x)} x2={sx(m.x)} y1={PAD.t} y2={height - PAD.b} stroke={m.color ?? "#F6F5F2"} strokeOpacity={0.5} />
        ))}
      </svg>
    </figure>
  );
}

export function Legend({ items }: { items: { color: string; label: string; dash?: boolean }[] }) {
  return (
    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-cx-faint">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-[2px] w-3" style={{ background: it.color, opacity: it.dash ? 0.6 : 1 }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}
