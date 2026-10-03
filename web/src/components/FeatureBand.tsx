import { batchColor } from "../colors";
import type { FeatureCall, FeatureProfile } from "../types";

interface Props {
  profile: FeatureProfile;
  call: FeatureCall;
  batches: string[];
}

export default function FeatureBand({ profile, call, batches }: Props) {
  const rows = batches.flatMap((batch) => {
    const mean = profile.mean[batch];
    const sd = profile.sd[batch];
    return mean == null || sd == null ? [] : [{ batch, mean, sd }];
  });
  const value = call.value;
  const title = `${profile.name} = ${value == null ? "—" : value.toPrecision(3)}${profile.unit ? ` ${profile.unit}` : ""}`;
  if (!rows.length) {
    return <div className="rounded-lg bg-white/[0.03] px-3 py-2 text-xs text-slate-500">{title} · no batch bands</div>;
  }

  const width = 360;
  const left = 92;
  const right = 10;
  const top = 8;
  const rowHeight = 21;
  const axisHeight = 25;
  const bounds = rows.flatMap(({ mean, sd }) => [mean - 2 * sd, mean + 2 * sd]);
  if (value != null) bounds.push(value);
  let low = Math.min(...bounds);
  let high = Math.max(...bounds);
  let pad = (high - low) * 0.05;
  if (pad === 0) pad = Math.max(Math.abs(low) * 0.05, 0.05);
  low -= pad;
  high += pad;
  const plotWidth = width - left - right;
  const x = (n: number) => left + ((n - low) / (high - low)) * plotWidth;
  const axisY = top + rows.length * rowHeight;
  const height = axisY + axisHeight;
  const ticks = [low, (low + high) / 2, high];

  return (
    <div className="rounded-xl bg-white/[0.03] p-3">
      <p className="mb-1 font-mono text-xs text-slate-300">{title}</p>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={`${profile.name} batch bands`}>
        {rows.map(({ batch, mean, sd }, index) => {
          const y = top + index * rowHeight;
          const color = batchColor(batch, batches);
          return (
            <g key={batch}>
              <text x="0" y={y + 13} fill="#94a3b8" fontSize="10">{batch}</text>
              <rect x={x(mean - 2 * sd)} y={y + 3} width={Math.max(0, x(mean + 2 * sd) - x(mean - 2 * sd))}
                height="12" rx="3" fill={color} opacity="0.22" />
              <rect x={x(mean - sd)} y={y + 3} width={Math.max(0, x(mean + sd) - x(mean - sd))}
                height="12" rx="3" fill={color} opacity="0.62" />
              <line x1={x(mean)} x2={x(mean)} y1={y + 1} y2={y + 17} stroke={color} strokeWidth="2" />
            </g>
          );
        })}
        {value != null && (
          <line x1={x(value)} x2={x(value)} y1={top - 3} y2={axisY - 1}
            stroke="#f8fafc" strokeWidth="1.5" strokeDasharray="3 3" />
        )}
        <line x1={left} x2={width - right} y1={axisY} y2={axisY} stroke="#475569" />
        {ticks.map((tick, index) => {
          const tickX = x(tick);
          return (
            <g key={index}>
              <line x1={tickX} x2={tickX} y1={axisY} y2={axisY + 4} stroke="#64748b" />
              <text x={tickX} y={axisY + 16} fill="#64748b" fontSize="9" textAnchor="middle">
                {tick.toPrecision(3)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
