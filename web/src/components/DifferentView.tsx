import { useEffect, useState } from "react";
import { getAttributionEvaluation } from "../api";
import { batchColor } from "../colors";
import type { AttributionEvaluation, FamilyResult } from "../types";
import ConfusionMatrix from "./ConfusionMatrix";

const fmt = (value: number | null) => (value == null ? "—" : value.toPrecision(3));

function FamilySetTable({ evaluation }: { evaluation: AttributionEvaluation }) {
  return (
    <section className="animate-rise overflow-x-auto rounded-2xl border border-white/5 bg-slate-900/60 p-6">
      <h3 className="font-medium">Feature families</h3>
      <table className="mt-4 min-w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500">
            {["set", "families", "features", "balanced accuracy", "null p95", "above null", "strips"].map((label) => (
              <th key={label} className="py-2 pr-4 font-normal">{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Object.entries(evaluation.family_sets).map(([name, result]) => (
            <tr key={name} className="border-t border-white/5">
              <td className="py-2 pr-4 font-mono">{name}</td>
              <td className="py-2 pr-4 text-xs text-slate-400">{result.families.join(", ")}</td>
              <td className="py-2 pr-4 tabular-nums">{result.n_features}</td>
              <td className="py-2 pr-4 tabular-nums">{fmt(result.balanced_accuracy)}</td>
              <td className="py-2 pr-4 tabular-nums">{fmt(result.null?.p95 ?? null)}</td>
              <td className="py-2 pr-4">
                <span className={`rounded px-2 py-0.5 text-xs ${result.above_null
                  ? "bg-emerald-400/15 text-emerald-300" : "bg-rose-400/15 text-rose-300"}`}>
                  {result.above_null ? "✓" : "✗"}
                </span>
              </td>
              <td className="py-2 pr-4 tabular-nums">{result.n_strips}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function SharedStripTable({ result }: { result: FamilyResult }) {
  if (result.shared_strips.length === 0) return null;
  return (
    <section className="animate-rise overflow-x-auto rounded-2xl border border-white/5 bg-slate-900/60 p-6">
      <h3 className="font-medium">Shared-strip check</h3>
      <table className="mt-4 min-w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500">
            {["strip", "batches", "images", "accuracy", "predicted per batch"].map((label) => (
              <th key={label} className="py-2 pr-4 font-normal">{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.shared_strips.map((strip) => (
            <tr key={strip.strip} className="border-t border-white/5">
              <td className="py-2 pr-4 font-mono">{strip.strip}</td>
              <td className="py-2 pr-4 text-xs text-slate-400">{strip.batches.join(", ")}</td>
              <td className="py-2 pr-4 tabular-nums">{strip.n_images}</td>
              <td className="py-2 pr-4 tabular-nums">{fmt(strip.accuracy)}</td>
              <td className="py-2 pr-4 text-xs text-slate-400">
                {strip.batches.map((batch) => (
                  <span key={batch} className="mr-3">
                    <span style={{ color: batchColor(batch, strip.batches) }}>{batch}</span>:{" "}
                    {(strip.predicted[batch] ?? []).join(", ")}
                  </span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function TopFeatures({ evaluation }: { evaluation: AttributionEvaluation }) {
  return (
    <section className="animate-rise overflow-x-auto rounded-2xl border border-white/5 bg-slate-900/60 p-6">
      <h3 className="font-medium">Top features</h3>
      <table className="mt-4 min-w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500">
            <th className="py-2 pr-4 font-normal">feature</th>
            <th className="py-2 pr-4 font-normal">family</th>
            <th className="py-2 pr-4 text-right font-normal">effect size</th>
            <th className="py-2 pr-4 text-right font-normal">LOSO acc</th>
            {evaluation.batches.map((batch) => (
              <th key={batch} className="py-2 pr-4 text-right font-normal"
                style={{ color: batchColor(batch, evaluation.batches) }}>
                mean {batch}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {evaluation.top_features.map((feature) => (
            <tr key={feature.feature} className="border-t border-white/5">
              <td className="py-2 pr-4 font-mono">{feature.feature}</td>
              <td className="py-2 pr-4 text-xs text-slate-400">{feature.family}</td>
              <td className="py-2 pr-4 text-right tabular-nums">{fmt(feature.effect_size)}</td>
              <td className="py-2 pr-4 text-right tabular-nums">{fmt(feature.loso_acc)}</td>
              {evaluation.batches.map((batch) => (
                <td key={batch} className="py-2 pr-4 text-right tabular-nums">
                  {fmt(feature[`mean_${batch}`] ?? null)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default function DifferentView() {
  const [evaluation, setEvaluation] = useState<AttributionEvaluation | null>(null);
  const [selected, setSelected] = useState("");

  useEffect(() => {
    let current = true;
    getAttributionEvaluation().then(
      (result) => {
        if (current) {
          setEvaluation(result);
          setSelected((name) => name || (result.family_sets.material ? "material" : Object.keys(result.family_sets)[0] ?? ""));
        }
      },
      () => {
        if (current) setEvaluation(null);
      },
    );
    return () => {
      current = false;
    };
  }, []);

  const familyNames = evaluation ? Object.keys(evaluation.family_sets) : [];
  const selectedName = familyNames.includes(selected) ? selected
    : familyNames.includes("material") ? "material" : familyNames[0] ?? "";
  const result = evaluation?.family_sets[selectedName];

  return (
    <div className="space-y-6">
      {!evaluation ? (
        <section className="animate-rise rounded-2xl border border-white/5 bg-slate-900/60 p-6 text-sm text-slate-400">
          No attribution evaluation yet: Pat's <code>uv run python -m qc.attribute --evaluate</code> writes it. To preview:{" "}
          <code>cp tests/fixtures/attribution_evaluation_example.json out/attribution/evaluation.json</code>.
        </section>
      ) : (
        <>
          <section className="animate-rise rounded-2xl border border-white/5 bg-slate-900/60 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-medium">What's different</h2>
                <p className="mt-1 text-xs text-slate-500">LOSO attribution by feature family.</p>
              </div>
              {familyNames.length > 0 && (
                <select value={selectedName} onChange={(event) => setSelected(event.target.value)}
                  className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white">
                  {familyNames.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              )}
            </div>
          </section>
          <FamilySetTable evaluation={evaluation} />
          {result && (
            <>
              <ConfusionMatrix title={selectedName}
                subtitle={`balanced accuracy ${fmt(result.balanced_accuracy)} · null 95th ${fmt(result.null?.p95 ?? null)} · n ${result.n_images}`}
                confusion={result.confusion} batches={evaluation.batches} />
              <SharedStripTable result={result} />
            </>
          )}
          <TopFeatures evaluation={evaluation} />
        </>
      )}
    </div>
  );
}
