import { attributionFileUrl, maskUrl } from "../api";
import { batchColor } from "../colors";
import type { Attribution, ImageCall } from "../types";
import FeatureBand from "./FeatureBand";

export default function ImageCallCard({ call, attribution }: { call: ImageCall; attribution: Attribution }) {
  const color = batchColor(call.predicted, attribution.batches);
  const probability = call.probabilities[call.predicted] ?? 0;
  const profiles = new Map(attribution.features.map((profile) => [profile.name, profile]));

  return (
    <article className="animate-rise space-y-5 rounded-2xl border border-white/5 bg-slate-900/60 p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-slate-400">{call.folder}</p>
          <h3 className="mt-1 font-mono text-lg text-white">{call.image_id}</h3>
        </div>
        <p className="text-2xl font-semibold" style={{ color }}>{call.predicted}</p>
      </header>

      <div className="flex flex-wrap gap-2 text-xs">
        {call.assigned && call.assigned !== call.predicted && (
          <span className="rounded-full bg-white/5 px-3 py-1 text-slate-300">balanced assignment: {call.assigned}</span>
        )}
        {call.truth && (
          <span className={`rounded-full px-3 py-1 ${call.truth === call.predicted
            ? "bg-emerald-400/15 text-emerald-300" : "bg-rose-400/15 text-rose-300"}`}>
            true batch: {call.truth} {call.truth === call.predicted ? "✓" : "✗"}
          </span>
        )}
        {call.unfamiliar && (
          <span className="rounded-full bg-rose-400/15 px-3 py-1 text-rose-300">Unlike any known batch</span>
        )}
        {call.outside_baseline.length > 0 && (
          <span className="rounded-full bg-amber-400/15 px-3 py-1 text-amber-300">
            Outside the baseline on: {call.outside_baseline.join(", ")}
          </span>
        )}
      </div>

      <div className="space-y-2">
        {attribution.batches.map((batch) => {
          const value = call.probabilities[batch] ?? 0;
          return (
            <div key={batch} className="grid grid-cols-[7rem_1fr_3rem] items-center gap-3 text-xs">
              <span style={{ color: batchColor(batch, attribution.batches) }}>{batch}</span>
              <div className="h-2 overflow-hidden rounded-full bg-white/5">
                <div className="h-full rounded-full" style={{
                  width: `${Math.max(0, Math.min(1, value)) * 100}%`,
                  backgroundColor: batchColor(batch, attribution.batches),
                }} />
              </div>
              <span className="text-right font-mono text-slate-400">{(value * 100).toFixed(0)}%</span>
            </div>
          );
        })}
      </div>

      {call.why.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-300">
          {call.why.map((sentence) => <li key={sentence}>{sentence}</li>)}
        </ul>
      )}

      {call.features.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {call.features.slice(0, 4).map((feature) => {
            const profile = profiles.get(feature.name);
            return profile ? (
              <FeatureBand key={feature.name} profile={profile} call={feature} batches={attribution.batches} />
            ) : null;
          })}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <figure className="overflow-hidden rounded-xl border border-white/5 bg-slate-800/50">
          <img src={maskUrl(call.folder, call.image_id)} alt="" className="aspect-[3/1] w-full object-cover"
            onError={(event) => (event.currentTarget.style.display = "none")} />
          <figcaption className="p-2 text-xs text-slate-500">Mask overlay · {call.image_id}</figcaption>
        </figure>
        {call.heatmap && (
          <figure className="overflow-hidden rounded-xl border border-white/5 bg-slate-800/50">
            <img src={attributionFileUrl(call.heatmap)} alt="" className="aspect-[3/1] w-full object-cover"
              onError={(event) => (event.currentTarget.style.display = "none")} />
            <figcaption className="p-2 text-xs text-slate-500">Per-region support · {call.image_id}</figcaption>
          </figure>
        )}
      </div>

      {call.nearest.length > 0 && (
        <div>
          <p className="mb-2 text-xs text-slate-500">Most similar known images</p>
          <div className="flex flex-wrap gap-2">
            {call.nearest.map((known) => {
              const separator = known.lastIndexOf("/");
              const folder = known.slice(0, separator);
              const imageId = known.slice(separator + 1);
              return (
                <figure key={known} className="w-32 overflow-hidden rounded-lg border border-white/5 bg-slate-800/50">
                  <img src={maskUrl(folder, imageId)} alt="" className="aspect-[3/1] w-full object-cover"
                    onError={(event) => (event.currentTarget.style.display = "none")} />
                  <figcaption className="truncate p-1.5 font-mono text-[10px] text-slate-400">{imageId}</figcaption>
                </figure>
              );
            })}
          </div>
        </div>
      )}
    </article>
  );
}
