import { maskUrl } from "../api";
import type { Evidence } from "../types";

export default function TileGallery({ evidence }: { evidence: Evidence }) {
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
              {segment.shared && (
                <span className="ml-2 rounded bg-sky-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-sky-300">
                  shared
                </span>
              )}
            </p>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {segment.image_ids.map((imageId) => (
                <figure
                  key={imageId}
                  className="overflow-hidden rounded-xl border border-white/5 bg-slate-900/60"
                >
                  <div className="aspect-[3/1] bg-slate-800/50">
                    <img
                      src={maskUrl(evidence.batch, imageId)}
                      alt=""
                      className="h-full w-full object-cover"
                      onError={(event) => (event.currentTarget.style.display = "none")}
                    />
                  </div>
                  <figcaption className="p-2 font-mono text-xs text-slate-300">{imageId}</figcaption>
                </figure>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
