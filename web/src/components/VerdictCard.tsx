import { VERDICT_STYLE } from "../colors";
import type { Evidence } from "../types";

const pct = (value: number) => `${Math.round(value * 100)}%`;

export default function VerdictCard({ evidence, ciLevel }: { evidence: Evidence; ciLevel: number }) {
  const style = VERDICT_STYLE[evidence.verdict];
  const { x, n, ci } = evidence.nonconforming;
  const stats = [
    ["Non-conforming tiles", `${x} / ${n}`],
    [`Non-conforming rate · ${pct(ciLevel)} CI`, `${pct(ci[0])} – ${pct(ci[1])}`],
    ["Baseline", `${evidence.baseline} · ${evidence.n_images.baseline} tiles`],
    ["Config", evidence.config_version],
  ];
  return (
    <section className={`animate-rise rounded-2xl bg-linear-to-br ${style.glow} to-transparent p-8 ring-1 ${style.ring}`}>
      <p className="text-sm text-slate-400">{evidence.batch}</p>
      <h2 className={`mt-1 text-5xl font-bold tracking-tight ${style.text}`}>{evidence.verdict}</h2>
      <p className="mt-3 max-w-2xl text-lg text-slate-200">{evidence.next_action}</p>
      <dl className="mt-8 grid grid-cols-2 gap-6 md:grid-cols-4">
        {stats.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-slate-400">{label}</dt>
            <dd className="mt-1 font-mono text-lg tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
