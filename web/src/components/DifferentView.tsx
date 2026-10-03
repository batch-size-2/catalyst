import { useEffect, useState } from "react";
import { getAttribution, listAttributions } from "../api";
import { batchColor } from "../colors";
import type { Attribution } from "../types";
import ConfusionMatrix from "./ConfusionMatrix";

const fmt = (value: number | null) => (value == null ? "—" : value.toPrecision(3));
const zColor = (value: number | null) => value == null ? "text-slate-500"
  : Math.abs(value) >= 2 ? "text-rose-300"
    : Math.abs(value) >= 1 ? "text-amber-300" : "text-slate-400";

export default function DifferentView() {
  const [runs, setRuns] = useState<string[]>([]);
  const [selected, setSelected] = useState("");
  const [attribution, setAttribution] = useState<Attribution | null>(null);

  useEffect(() => {
    listAttributions().then((names) => {
      setRuns(names);
      setSelected((current) => current || (names.includes("known") ? "known" : names[0] ?? ""));
    }).catch(() => setRuns([]));
  }, []);

  useEffect(() => {
    if (!selected) return;
    let current = true;
    getAttribution(selected).then(
      (result) => {
        if (current) setAttribution(result);
      },
      () => {
        if (current) setAttribution(null);
      },
    );
    return () => {
      current = false;
    };
  }, [selected]);

  return (
    <div className="space-y-6">
      <section className="animate-rise rounded-2xl border border-white/5 bg-slate-900/60 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-medium">What's different</h2>
            <p className="mt-1 text-xs text-slate-500">Feature separation and held-out evaluation.</p>
          </div>
          {runs.length > 0 && (
            <select value={selected} onChange={(event) => setSelected(event.target.value)}
              className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white">
              {runs.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          )}
        </div>
        {runs.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">
            No sorted images yet. To preview the layout: <code>cp tests/fixtures/attribution_example.json out/attribution/example_drop.json</code>.
          </p>
        ) : attribution ? (
          <p className="mt-3 text-xs text-slate-500">Baseline: {attribution.baseline}</p>
        ) : (
          <p className="mt-4 text-sm text-slate-500">Loading attribution…</p>
        )}
      </section>
      {attribution && (
        <>
          <section className="animate-rise overflow-x-auto rounded-2xl border border-white/5 bg-slate-900/60 p-6">
            <h3 className="font-medium">Feature ranking</h3>
            <table className="mt-4 min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="py-2 pr-4 font-normal">feature</th>
                  <th className="py-2 pr-4 font-normal">unit</th>
                  <th className="py-2 pr-4 font-normal">family</th>
                  <th className="py-2 pr-4 font-normal">used</th>
                  <th className="py-2 pr-4 font-normal">η²</th>
                  {attribution.batches.map((batch) => (
                    <th key={batch} className="py-2 pr-4 text-right font-normal" style={{ color: batchColor(batch, attribution.batches) }}>
                      {batch} mean ± sd
                    </th>
                  ))}
                  {attribution.batches.filter((batch) => batch !== attribution.baseline).map((batch) => (
                    <th key={`z-${batch}`} className="py-2 pr-4 text-right font-normal" style={{ color: batchColor(batch, attribution.batches) }}>
                      z vs {attribution.baseline}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {attribution.features.map((feature) => (
                  <tr key={feature.name} className="border-t border-white/5">
                    <td className="py-2 pr-4 font-mono">{feature.name}</td>
                    <td className="py-2 pr-4 text-xs text-slate-500">{feature.unit}</td>
                    <td className="py-2 pr-4 text-xs text-slate-500">{feature.family ?? "—"}</td>
                    <td className="py-2 pr-4">
                      <span className={`rounded px-2 py-0.5 text-xs ${feature.used
                        ? "bg-sky-400/15 text-sky-300" : "bg-white/5 text-slate-500"}`}>
                        {feature.used ? "used" : "not used"}
                      </span>
                    </td>
                    <td className="py-2 pr-4 tabular-nums">{fmt(feature.eta2)}</td>
                    {attribution.batches.map((batch) => {
                      const mean = feature.mean[batch];
                      const sd = feature.sd[batch];
                      return (
                        <td key={batch} className="py-2 pr-4 text-right font-mono text-xs tabular-nums">
                          {mean == null || sd == null ? "—" : `${fmt(mean)} ± ${fmt(sd)}`}
                        </td>
                      );
                    })}
                    {attribution.batches.filter((batch) => batch !== attribution.baseline).map((batch) => {
                      const z = feature.z_vs_baseline[batch] ?? null;
                      return (
                        <td key={`z-${batch}`} className={`py-2 pr-4 text-right font-mono text-xs tabular-nums ${zColor(z)}`}>
                          {fmt(z)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <div className="grid gap-4 xl:grid-cols-2">
            {attribution.evaluations.map((evaluation) => (
              <ConfusionMatrix key={evaluation.scheme} evaluation={evaluation} batches={attribution.batches} />
            ))}
          </div>
          {attribution.clustering_ari != null && (
            <p className="rounded-2xl border border-white/5 bg-slate-900/60 p-5 text-sm text-slate-300">
              Clustering vs labels: adjusted Rand index {fmt(attribution.clustering_ari)}
            </p>
          )}
        </>
      )}
    </div>
  );
}
