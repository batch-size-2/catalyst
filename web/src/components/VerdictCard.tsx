import { VERDICT_STYLE } from "../colors";
import type { Evidence } from "../types";

export default function VerdictCard({ evidence }: { evidence: Evidence }) {
  const style = VERDICT_STYLE[evidence.verdict];
  const [nBatch, nRef] = evidence.power.n_segments;
  const stats = [
    ["Strip segments", `${nBatch} vs ${nRef} reference`],
    ["Smallest possible p", evidence.power.min_p.toPrecision(2)],
    ["Shared strips", `${evidence.shared_strips.strips.length} · ${evidence.shared_strips.setting}`],
    ["Baseline", `${evidence.baseline} · ${evidence.n_images.baseline} images`],
    ["Config", evidence.config_version],
  ];
  return (
    <section className={`animate-rise rounded-2xl bg-linear-to-br ${style.glow} to-transparent p-8 ring-1 ${style.ring}`}>
      <p className="text-sm text-slate-400">{evidence.batch}</p>
      <h2 className={`mt-1 text-5xl font-bold tracking-tight ${style.text}`}>{evidence.verdict}</h2>
      <p className="mt-3 max-w-2xl text-lg text-slate-200">{evidence.next_action}</p>
      {evidence.reasons.length > 0 && (
        <ul className="mt-3 space-y-1">
          {evidence.reasons.map((reason) => (
            <li key={reason} className="text-sm text-slate-300">
              • {reason}
            </li>
          ))}
        </ul>
      )}
      <dl className="mt-8 grid grid-cols-2 gap-6 md:grid-cols-5">
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
