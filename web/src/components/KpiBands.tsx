import type { Evidence, KpiResult, TileResult } from "../types";

const W = 600;
const H = 36;
const MID = W / 2;
const BAND_HALF_PX = 90;
const CLAMP = 3;

const fmt = (value: number) => value.toPrecision(3);

export default function KpiBands({ evidence }: { evidence: Evidence }) {
  return (
    <section className="animate-rise rounded-2xl border border-white/5 bg-slate-900/60 p-6">
      <h2 className="font-medium">KPIs against the baseline tolerance band</h2>
      <p className="mt-1 text-xs text-slate-400">
        Each dot is a tile. The shaded band is where a new tile from the baseline is expected to land; dots outside are
        flagged. Dots past ±3 band-widths are pinned to the edge.
      </p>
      <div className="mt-6 space-y-3">
        {evidence.kpis.map((kpi) => (
          <KpiRow key={kpi.name} kpi={kpi} tiles={evidence.tiles} />
        ))}
      </div>
    </section>
  );
}

function KpiRow({ kpi, tiles }: { kpi: KpiResult; tiles: TileResult[] }) {
  const [lo, hi] = kpi.band;
  const centre = (lo + hi) / 2;
  const half = Math.max((hi - lo) / 2, 1e-12);
  const x = (value: number) => MID + Math.max(-CLAMP, Math.min(CLAMP, (value - centre) / half)) * BAND_HALF_PX;

  return (
    <div className="grid grid-cols-[12rem_1fr_6rem] items-center gap-4">
      <div>
        <p className="font-mono text-sm">{kpi.name}</p>
        <p className="text-xs text-slate-500">
          {fmt(lo)} – {fmt(hi)} {kpi.unit}
        </p>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="rgb(255 255 255 / 0.08)" />
        <rect
          x={MID - BAND_HALF_PX}
          width={2 * BAND_HALF_PX}
          y={4}
          height={H - 8}
          rx={6}
          fill="rgb(52 211 153 / 0.12)"
          stroke="rgb(52 211 153 / 0.35)"
        />
        <line x1={MID} x2={MID} y1={4} y2={H - 4} stroke="rgb(52 211 153 / 0.5)" strokeDasharray="2 3" />
        {tiles.map((tile, i) => {
          const value = tile.kpis[kpi.name];
          if (value == null) return null;
          return (
            <circle
              key={tile.image_id}
              cx={x(value)}
              cy={H / 2 + ((i % 3) - 1) * 6}
              r={5}
              fill={value < lo || value > hi ? "#fb7185" : "#34d399"}
              fillOpacity={0.9}
              stroke="#0f172a"
            >
              <title>{`${tile.image_id}: ${fmt(value)} ${kpi.unit}`}</title>
            </circle>
          );
        })}
      </svg>
      <p className={`text-right text-sm tabular-nums ${kpi.n_outside ? "text-rose-300" : "text-slate-500"}`}>
        {kpi.n_outside} outside
      </p>
    </div>
  );
}
