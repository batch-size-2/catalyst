import { maskUrl } from "../api";
import { batchColor } from "../colors";
import type { Evidence, ImageCall } from "../types";

interface Props {
  evidence: Evidence;
  calls?: ImageCall[];
  batches?: string[];
}

export default function TileGallery({ evidence, calls = [], batches = [] }: Props) {
  const callsByImage = new Map(calls.map((call) => [call.image_id, call]));
  return (
    <section>
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="font-medium">Images by strip</h2>
        <p className="text-xs text-slate-400">
          BSE · <span className="text-orange-300">orange</span> Si particle · <span className="text-sky-300">blue</span>{" "}
          pore · grouped by strip segment
        </p>
      </div>
      <div className="space-y-5">
        {evidence.fingerprint.segments.map((segment) => (
          <div key={segment.strip_id}>
            <p className="mb-2 text-xs text-slate-400">
              strip <span className="font-mono text-slate-300">{segment.strip_id}</span>
              <span className="ml-2 text-slate-500">{segment.image_ids.length} image(s)</span>
            </p>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {segment.image_ids.map((imageId) => {
                const oddQuantities = Array.from(new Set(evidence.odd_images
                  .filter((odd) => odd.image_ids[0] === imageId)
                  .map((odd) => odd.quantity)));
                const call = callsByImage.get(imageId);
                const probability = call ? call.probabilities[call.predicted] ?? 0 : 0;
                return (
                  <figure key={imageId} className="overflow-hidden rounded-xl border border-white/5 bg-slate-900/60">
                    <div className="aspect-[3/1] bg-slate-800/50">
                      <img src={maskUrl(evidence.batch, imageId)} alt="" className="h-full w-full object-cover"
                        onError={(event) => (event.currentTarget.style.display = "none")} />
                    </div>
                    <figcaption className="flex flex-wrap items-center gap-2 p-2 text-xs">
                      <span className="font-mono text-slate-300">{imageId}</span>
                      {oddQuantities.length > 0 && (
                        <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-amber-300">
                          odd: {oddQuantities.join(", ")}
                        </span>
                      )}
                      {call && (
                        <span className="rounded bg-white/5 px-1.5 py-0.5" style={{ color: batchColor(call.predicted, batches) }}>
                          {call.predicted} · {(probability * 100).toFixed(0)}%
                        </span>
                      )}
                    </figcaption>
                  </figure>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
