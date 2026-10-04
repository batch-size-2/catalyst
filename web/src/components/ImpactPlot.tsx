import { batchColor, batchLabel } from "../lib";
import { fmtUnit, type CurveLine, type CurveMarker, type Threshold } from "../impact";

const W = 520;
const H = 260;
const M = { l: 50, r: 18, t: 30, b: 42 };
const LINE_COLORS = ["var(--cx-phase-si)", "var(--cx-text-2)", "var(--cx-phase-pore)"];

export interface Band {
  lower: [number, number][];
  upper: [number, number][];
  color: string;
}

export interface PlotProps {
  xLabel: string;
  xUnit: string;
  yLabel: string;
  yUnit: string;
  xLog?: boolean;
  yLog?: boolean;
  lines: (CurveLine & { color?: string; dash?: boolean })[];
  markers?: CurveMarker[];
  thresholds?: Threshold[];
  thresholdsInLegend?: boolean;
  bands?: Band[];
  yMin?: number;
  markerNote?: string;
}

function niceTicks(lo: number, hi: number, n = 5): number[] {
  const step0 = (hi - lo) / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
  if (!(step > 0) || !Number.isFinite(step)) return [lo, hi];
  const ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

function logTicks(lo: number, hi: number): number[] {
  const ticks = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++)
    for (const m of hi / lo < 100 ? [1, 2, 5] : [1]) {
      const v = m * 10 ** e;
      if (v >= lo * 0.999 && v <= hi * 1.001) ticks.push(v);
    }
  return ticks;
}

function domain(values: number[], log: boolean, floor?: number): [number, number] {
  const finite = values.filter((v) => Number.isFinite(v) && (!log || v > 0));
  if (!finite.length) return log ? [1, 10] : [0, 1];
  let lo = Math.min(...finite);
  const hi = Math.max(...finite);
  if (floor != null) lo = Math.min(lo, floor);
  if (log) return [lo / 1.3, hi * 1.3];
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.06;
  return [floor != null && lo >= floor ? lo : lo - pad, hi + pad];
}

function mergeRows(rows: { y: number; label: string }[]): { top: number; bottom: number; label: string }[] {
  const groups: { y: number; label: string }[][] = [];
  for (const row of [...rows].sort((a, b) => a.y - b.y)) {
    const last = groups[groups.length - 1];
    if (last && row.y - last[last.length - 1].y < 14) last.push(row);
    else groups.push([row]);
  }
  return groups.map((g) => {
    const heads = g.map((r) => r.label.split(", ")[0]);
    const label = g.length === 1 ? g[0].label
      : heads.every((h) => h === heads[0]) ? `${heads[0]}, ${g.map((r) => r.label.slice(heads[0].length + 2)).join(" and ")}`
      : g.map((r) => r.label).join(" / ");
    return { top: g[0].y, bottom: g[g.length - 1].y, label };
  });
}

export default function ImpactPlot(props: PlotProps) {
  const { xLog = false, yLog = false, lines, markers = [], thresholds = [], bands = [], thresholdsInLegend = false } = props;
  const xs = [
    ...lines.flatMap((l) => l.points.map((p) => p[0])),
    ...markers.flatMap((m) => [m.x.value, m.x.low, m.x.high].filter((v): v is number => v != null)),
    ...thresholds.filter((t) => t.axis === "x").map((t) => t.value),
  ];
  const ys = [
    ...lines.flatMap((l) => l.points.map((p) => p[1])),
    ...bands.flatMap((b) => [...b.lower, ...b.upper].map((p) => p[1])),
    ...markers.flatMap((m) => [m.y.value, m.y.low, m.y.high].filter((v): v is number => v != null)),
    ...thresholds.filter((t) => t.axis === "y").map((t) => t.value),
  ];
  const [x0, x1] = domain(xs, xLog);
  const [y0, y1] = domain(ys, yLog, props.yMin);
  const t = (v: number, log: boolean) => (log ? Math.log10(Math.max(v, 1e-12)) : v);
  const sx = (v: number) => M.l + ((t(v, xLog) - t(x0, xLog)) / (t(x1, xLog) - t(x0, xLog))) * (W - M.l - M.r);
  const sy = (v: number) => H - M.b - ((t(v, yLog) - t(y0, yLog)) / (t(y1, yLog) - t(y0, yLog))) * (H - M.t - M.b);
  const clipX = (v: number) => Math.max(M.l, Math.min(W - M.r, sx(v)));
  const clipY = (v: number) => Math.max(M.t, Math.min(H - M.b, sy(v)));
  const path = (pts: [number, number][]) => pts.map((p, i) => `${i ? "L" : "M"}${sx(p[0]).toFixed(1)},${clipY(p[1]).toFixed(1)}`).join("");
  const xt = xLog ? logTicks(x0, x1) : niceTicks(x0, x1);
  const yt = yLog ? logTicks(y0, y1) : niceTicks(y0, y1, 4);
  const tick = (v: number, unit: string) => (unit === "fraction" ? fmtUnit(v, unit) : `${Number(v.toPrecision(3))}`);
  const unitOf = (unit: string) => (!unit || unit === "fraction" || unit === "ratio" ? "" : ` (${unit === "um" ? "µm" : unit})`);
  const vertical = thresholds.filter((th) => th.axis === "x");
  const horizontal = thresholds.filter((th) => th.axis === "y");
  const rows = mergeRows(horizontal.map((th) => ({ y: clipY(th.value), label: th.label })));
  const dotted = [...new Set(markers.filter((m) => m.x.value != null && m.y.value != null).map((m) => m.batch))];

  return (
    <div className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label={`${props.yLabel} against ${props.xLabel}`}>
        <text x={4} y={14} fontSize="11.5" fill="var(--cx-muted)">{props.yLabel}{unitOf(props.yUnit)}</text>
        {yt.map((v) => (
          <g key={`y${v}`}>
            <line x1={M.l} x2={W - M.r} y1={sy(v)} y2={sy(v)} stroke="var(--cx-line)" />
            <text x={M.l - 8} y={sy(v) + 4} textAnchor="end" fontSize="11" fill="var(--cx-faint)" className="mono">
              {tick(v, props.yUnit)}
            </text>
          </g>
        ))}
        {xt.map((v) => (
          <text key={`x${v}`} x={sx(v)} y={H - M.b + 16} textAnchor="middle" fontSize="11" fill="var(--cx-faint)" className="mono">
            {tick(v, props.xUnit)}
          </text>
        ))}
        <line x1={M.l} x2={W - M.r} y1={H - M.b} y2={H - M.b} stroke="var(--cx-line)" />
        <text x={(M.l + W - M.r) / 2} y={H - 6} textAnchor="middle" fontSize="11.5" fill="var(--cx-muted)">
          {props.xLabel}{unitOf(props.xUnit)}
        </text>

        {bands.map((b, i) => (
          <path key={`b${i}`} fill={b.color} fillOpacity={0.18} stroke="none"
            d={`${path(b.upper)}L${[...b.lower].reverse().map((p) => `${sx(p[0]).toFixed(1)},${clipY(p[1]).toFixed(1)}`).join("L")}Z`} />
        ))}
        {vertical.map((th, i) => (
          <g key={`tx${i}`}>
            <line x1={sx(th.value)} x2={sx(th.value)} y1={M.t} y2={H - M.b} stroke="var(--cx-faint)" strokeDasharray="3 4" />
            {!thresholdsInLegend && (
              <text x={sx(th.value) + 4} y={M.t + 11 + 13 * i} fontSize="10.5" fill="var(--cx-faint)">{th.label}</text>
            )}
          </g>
        ))}
        {rows.map((r, i) => (
          <g key={`ty${i}`}>
            {r.bottom - r.top > 0.5 && (
              <rect x={M.l} width={W - M.l - M.r} y={r.top} height={r.bottom - r.top} fill="var(--cx-faint)" fillOpacity={0.16} />
            )}
            <line x1={M.l} x2={W - M.r} y1={r.top} y2={r.top} stroke="var(--cx-faint)" strokeDasharray="3 4" />
            {r.bottom - r.top > 0.5 && (
              <line x1={M.l} x2={W - M.r} y1={r.bottom} y2={r.bottom} stroke="var(--cx-faint)" strokeDasharray="3 4" />
            )}
            {!thresholdsInLegend && (
              <text x={W - M.r - 4} y={r.top - 5} textAnchor="end" fontSize="10.5" fill="var(--cx-faint)">{r.label}</text>
            )}
          </g>
        ))}
        {lines.map((l, i) => (
          <path key={`${i}-${l.name}`} d={path(l.points)} fill="none" strokeWidth={2}
            stroke={l.color ?? (l.batch ? batchColor(l.batch) : LINE_COLORS[i % LINE_COLORS.length])}
            strokeDasharray={l.dash || (!l.batch && !l.color && i % 2 === 1) ? "6 5" : undefined} />
        ))}
        {markers.map((m, mi) => {
          if (m.x.value == null || m.y.value == null) return null;
          const c = batchColor(m.batch);
          const cx = sx(m.x.value);
          const cy = clipY(m.y.value);
          return (
            <g key={`${mi}-${m.batch}`}>
              <title>{batchLabel(m.batch)}</title>
              {m.x.low != null && m.x.high != null && (
                <line x1={clipX(m.x.low)} x2={clipX(m.x.high)} y1={cy} y2={cy} stroke={c} strokeWidth={2} strokeOpacity={0.7} />
              )}
              {m.y.low != null && m.y.high != null && (
                <line x1={cx} x2={cx} y1={clipY(m.y.low)} y2={clipY(m.y.high)} stroke={c} strokeWidth={2} strokeOpacity={0.7} />
              )}
              <circle cx={cx} cy={cy} r={5.5} fill={c} stroke="#111215" strokeWidth={2.5} />
            </g>
          );
        })}
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-cx-faint">
        {lines.map((l, i) => (
          <span key={`${i}-${l.name}`} className="flex items-center gap-1.5">
            <svg width="18" height="6" aria-hidden>
              <line x1="0" x2="18" y1="3" y2="3" strokeWidth="2"
                stroke={l.color ?? (l.batch ? batchColor(l.batch) : LINE_COLORS[i % LINE_COLORS.length])}
                strokeDasharray={l.dash || (!l.batch && !l.color && i % 2 === 1) ? "4 3" : undefined} />
            </svg>
            {l.name}
          </span>
        ))}
        {thresholdsInLegend && thresholds.map((th) => (
          <span key={th.label} className="flex items-center gap-1.5">
            <svg width="18" height="6" aria-hidden>
              <line x1="0" x2="18" y1="3" y2="3" strokeWidth="1" stroke="var(--cx-faint)" strokeDasharray="3 3" />
            </svg>
            {th.label}
          </span>
        ))}
        {dotted.map((b) => (
          <span key={b} className="flex items-center gap-1.5">
            <span aria-hidden style={{ width: 9, height: 9, borderRadius: 99, background: batchColor(b) }} />
            {batchLabel(b)}
          </span>
        ))}
        {dotted.length > 0 && props.markerNote && <span>{props.markerNote}</span>}
      </div>
    </div>
  );
}
