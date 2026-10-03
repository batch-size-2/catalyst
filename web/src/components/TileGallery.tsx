import { previewUrl } from "../api";
import { STATUS_STYLE } from "../colors";
import type { Evidence, TileStatus } from "../types";

const ORDER: TileStatus[] = ["NON_CONFORMING", "SUSPECT", "CONFORMING"];

export default function TileGallery({ evidence }: { evidence: Evidence }) {
  const tiles = [...evidence.tiles].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
  return (
    <section>
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="font-medium">Tiles</h2>
        <p className="text-xs text-slate-400">
          BSE · <span className="text-orange-300">orange</span> Si particle · <span className="text-sky-300">blue</span>{" "}
          pore · worst first
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {tiles.map((tile, i) => (
          <article
            key={tile.image_id}
            className="animate-rise overflow-hidden rounded-xl border border-white/5 bg-slate-900/60"
            style={{ animationDelay: `${i * 40}ms` }}
          >
            <div className="aspect-[3/1] bg-slate-800/50">
              <img
                src={previewUrl(evidence.batch, tile.image_id)}
                alt=""
                className="h-full w-full object-cover"
                onError={(event) => (event.currentTarget.style.display = "none")}
              />
            </div>
            <div className="p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="font-mono text-sm">{tile.image_id}</p>
                <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[tile.status].chip}`}>
                  {STATUS_STYLE[tile.status].label}
                </span>
              </div>
              {tile.strip_id && <p className="mt-1 text-xs text-slate-500">strip {tile.strip_id}</p>}
              <ul className="mt-2 space-y-0.5">
                {tile.reasons.map((reason) => (
                  <li key={reason} className="text-xs text-slate-400">
                    {reason}
                  </li>
                ))}
              </ul>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
