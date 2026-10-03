import { maskUrl } from "../api";
import { batchColor } from "../colors";
import type { AttributedImage } from "../types";

const fmt = (value: number | null) => (value == null ? "—" : value.toPrecision(3));

export default function AttributedImageCard(
  { image, run, classes }: { image: AttributedImage; run: string; classes: string[] },
) {
  const probability = (batch: string) => image[`p_${batch}`] ?? 0;
  const maxContribution = Math.max(0, ...image.reasons.map((reason) => Math.abs(reason.contribution ?? 0)));
  const confidence = image.confidence == null ? "—" : `${(100 * image.confidence).toFixed(0)}%`;

  return (
    <article className="animate-rise space-y-5 rounded-2xl border border-white/5 bg-slate-900/60 p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h3 className="font-mono text-lg text-white">{image.image_id}</h3>
          {image.strip_id && <p className="mt-1 text-xs text-slate-500">strip {image.strip_id}</p>}
        </div>
        <p className="text-2xl font-semibold" style={{ color: batchColor(image.predicted, classes) }}>
          looks like {image.predicted} <span className="text-base">{confidence}</span>
        </p>
      </header>

      <div className="flex flex-wrap gap-2 text-xs">
        {image.assigned && image.assigned !== image.predicted && (
          <span className="rounded-full bg-white/5 px-3 py-1 text-slate-300">
            balanced assignment: {image.assigned}
          </span>
        )}
        {image.unfamiliar === true && (
          <span className="rounded-full bg-rose-400/15 px-3 py-1 text-rose-300">
            Unlike any known batch (distance {fmt(image.baseline_distance)} vs threshold {fmt(image.baseline_threshold)})
          </span>
        )}
      </div>

      <div className="space-y-2">
        {classes.map((batch) => {
          const value = probability(batch);
          return (
            <div key={batch} className="grid grid-cols-[7rem_1fr_3rem] items-center gap-3 text-xs">
              <span style={{ color: batchColor(batch, classes) }}>{batch}</span>
              <div className="h-2 overflow-hidden rounded-full bg-white/5">
                <div className="h-full rounded-full" style={{
                  width: `${Math.max(0, Math.min(1, value)) * 100}%`,
                  backgroundColor: batchColor(batch, classes),
                }} />
              </div>
              <span className="text-right font-mono text-slate-400">{(value * 100).toFixed(0)}%</span>
            </div>
          );
        })}
      </div>

      {image.deviations.length > 0 && (
        <ul className="space-y-1 text-sm text-amber-300">
          {image.deviations.map((deviation) => (
            <li key={deviation.feature}>
              Outside the baseline's range on {deviation.feature}: z = {fmt(deviation.z)}, {deviation.direction}
            </li>
          ))}
        </ul>
      )}

      {image.reasons.length > 0 && (
        <div>
          <p className="mb-2 text-xs text-slate-500">Why it looks like {image.predicted}</p>
          <div className="space-y-2">
            {image.reasons.map((reason) => {
              const contribution = reason.contribution ?? 0;
              const width = maxContribution ? (Math.abs(contribution) / maxContribution) * 100 : 0;
              const positive = contribution >= 0;
              return (
                <div key={reason.feature} className="grid grid-cols-[12rem_1fr] items-center gap-3 text-xs">
                  <span className="truncate font-mono text-slate-300">
                    {reason.feature} · z {fmt(reason.z)}
                  </span>
                  <div className="h-2 rounded-full bg-white/5">
                    <div className={`h-2 rounded-full ${positive ? "bg-rose-400" : "bg-sky-400"}`}
                      style={{ width: `${width}%`, marginLeft: positive ? 0 : "auto" }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <figure className="overflow-hidden rounded-xl border border-white/5 bg-slate-800/50">
        <img src={maskUrl(run, image.image_id)} alt="" className="aspect-[3/1] w-full object-cover"
          onError={(event) => (event.currentTarget.style.display = "none")} />
        <figcaption className="p-2 text-xs text-slate-500">Mask overlay · {image.image_id}</figcaption>
      </figure>
    </article>
  );
}
