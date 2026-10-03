import { useEffect, useMemo, useState } from "react";
import { getConfig, getKpiDictionary, getTiles, imageUrl, maskUrl } from "../api";
import { batchColor, batchLabel, isUploadBatch, libraryTiles, useApi } from "../lib";
import { href } from "../router";
import type { Tile } from "../types";
import { BatchChip, BatchDot, Cat, PHASE_LEGEND, Panel, Seg, TileKpiGrid } from "./bits";

export default function Library({ routeBatch, routeImage }: { routeBatch?: string; routeImage?: string }) {
  const tiles = useApi(getTiles);
  const config = useApi(getConfig);
  const dict = useApi(getKpiDictionary);
  const [filter, setFilter] = useState<string>("all");

  const everything = tiles.data ?? [];
  const all = useMemo(() => libraryTiles(everything), [everything]);
  const batches = useMemo(() => [...new Set(all.map((t) => t.batch))].sort(), [all]);
  const knownBatches = batches.filter((b) => !isUploadBatch(b));
  const hasUploads = batches.some(isUploadBatch);
  const shown =
    filter === "all"
      ? all
      : filter === "uploads"
        ? all.filter((t) => isUploadBatch(t.batch))
        : all.filter((t) => t.batch === filter);
  const filterValue =
    filter === "uploads" || knownBatches.includes(filter) || filter === "all" ? filter : "all";

  if (routeBatch && routeImage)
    return (
      <Viewer
        tiles={everything}
        batches={batches}
        batch={routeBatch}
        imageId={routeImage}
        baseline={config.data?.baseline ?? null}
        dict={dict.data}
      />
    );

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-6 px-10 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2.5">
          <div className="lbl text-cx-orange-text">Library</div>
          <h1 className="m-0 text-[40px] leading-[1.1] font-semibold tracking-[-0.03em]">Every tile</h1>
        </div>
        <Seg
          options={[
            { value: "all", label: "All" },
            ...knownBatches.map((b) => ({
              value: b,
              label: (
                <span className="flex items-center gap-2">
                  <BatchDot name={b} size={8} />
                  {batchLabel(b)}
                </span>
              ),
            })),
            ...(hasUploads
              ? [{
                  value: "uploads",
                  label: (
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-[3px] bg-cx-new" />
                      Uploads
                    </span>
                  ),
                }]
              : []),
          ]}
          value={filterValue}
          onChange={setFilter}
        />
      </div>

      {shown.length ? (
        <div className="grid grid-cols-4 gap-3">
          {shown.map((tile) => (
            <a
              key={`${tile.batch}/${tile.image_id}`}
              href={href.library(tile.batch, tile.image_id)}
              className="group relative block overflow-hidden rounded-[14px]"
              style={{ boxShadow: `inset 0 0 0 1px var(--cx-line), inset 3px 0 0 ${batchColor(tile.batch)}` }}
            >
              <img
                src={imageUrl(tile.batch, tile.image_id, tile.detectors.includes("BSE") ? "BSE" : tile.detectors[0])}
                alt={`Tile ${tile.image_id}`}
                loading="lazy"
                className="aspect-[4/3] w-full object-cover transition group-hover:scale-[1.02]"
              />
              <span className="absolute right-2 bottom-2 left-2 flex items-end justify-between">
                <span className="mono rounded-md px-1.5 py-0.5 text-[11px] text-cx-text" style={{ background: "rgba(10,11,13,.75)" }}>
                  {tile.image_id}
                </span>
                <span
                  className="mono rounded-md px-1.5 py-0.5 text-[10px] text-cx-faint"
                  style={{ background: "rgba(10,11,13,.75)" }}
                  title={isUploadBatch(tile.batch) ? tile.batch : undefined}
                >
                  {isUploadBatch(tile.batch) ? "Upload" : batchLabel(tile.batch)}
                </span>
              </span>
            </a>
          ))}
        </div>
      ) : (
        <Panel className="flex items-center gap-3 text-sm text-cx-muted">
          <Cat mood="ready" size={34} />
          No tiles yet — drop TIFFs into data/&lt;batch&gt;/ or upload from Compare.
        </Panel>
      )}
    </div>
  );
}

function Viewer({
  tiles,
  batches,
  batch,
  imageId,
  baseline,
  dict,
}: {
  tiles: Tile[];
  batches: string[];
  batch: string;
  imageId: string;
  baseline: string | null;
  dict: import("../types").KpiDictionary | null;
}) {
  const tile = tiles.find((t) => t.batch === batch && t.image_id === imageId);
  const ordered = tiles.filter((t) => t.batch === batch);
  const index = ordered.findIndex((t) => t.image_id === imageId);
  const [detector, setDetector] = useState<string | null>(null);
  const [segmentation, setSegmentation] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [aspect, setAspect] = useState<string | null>(null);

  const det = detector && tile?.detectors.includes(detector) ? detector : tile?.detectors.includes("BSE") ? "BSE" : tile?.detectors[0];

  const go = (delta: number) => {
    const next = ordered[(index + delta + ordered.length) % ordered.length];
    if (next) window.location.hash = href.library(batch, next.image_id);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!tile)
    return (
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-6 px-10 py-10">
        <Panel className="flex items-center gap-3 text-sm text-cx-muted">
          <Cat mood="ready" size={34} />
          No tile {imageId} in {batchLabel(batch)} — <a href={href.library()}>back to the library</a>.
        </Panel>
      </div>
    );

  const src = segmentation && tile.has_mask ? maskUrl(batch, imageId) : det ? imageUrl(batch, imageId, det, 2048) : "";

  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-5 px-10 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3.5">
          <h1 className="mono m-0 text-[28px] font-medium tracking-[-0.02em]">{imageId}</h1>
          <BatchChip name={batch} />
          {tile.strip_id && (
            <span className="text-[13px] text-cx-faint">
              strip <span className="mono">{tile.strip_id}</span>
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button className="btn px-3.5" type="button" aria-label="Previous tile" onClick={() => go(-1)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
          <button className="btn px-3.5" type="button" aria-label="Next tile" onClick={() => go(1)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-9 flex min-w-0 flex-col gap-4">
          <section
            aria-label="Micrograph"
            className="relative overflow-hidden rounded-3xl border border-cx-line bg-black"
            style={{ aspectRatio: aspect ?? "1800 / 536" }}
          >
            <div className="absolute inset-0 overflow-auto">
              {src && (
                <img
                  src={src}
                  alt={`${segmentation ? "Segmentation" : det} of tile ${imageId}`}
                  className="block max-w-none"
                  style={{ width: `${zoom * 100}%` }}
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    if (img.naturalWidth && img.naturalHeight) setAspect(`${img.naturalWidth} / ${img.naturalHeight}`);
                  }}
                />
              )}
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-between p-3.5">
              <Seg
                className="pointer-events-auto"
                style={{ background: "rgba(14,15,18,.82)", backdropFilter: "blur(12px)" }}
                options={tile.detectors.map((d) => ({ value: d, label: <span className="mono text-xs">{d}</span> }))}
                value={det ?? ""}
                onChange={(d) => {
                  setDetector(d);
                  setSegmentation(false);
                }}
              />
              <div className="glass pointer-events-auto flex items-center gap-0.5 rounded-[14px] p-1" style={{ background: "rgba(14,15,18,.82)", backdropFilter: "blur(12px)" }}>
                <button
                  type="button"
                  aria-label="Zoom out"
                  disabled={zoom <= 1}
                  className="h-9 w-9 cursor-pointer rounded-[10px] border-0 bg-transparent text-lg text-cx-text disabled:opacity-40"
                  onClick={() => setZoom((z) => Math.max(1, z / 1.4))}
                >
                  −
                </button>
                <span className="mono px-1.5 text-xs text-cx-text-2">{Math.round(zoom * 100)}%</span>
                <button
                  type="button"
                  aria-label="Zoom in"
                  className="h-9 w-9 cursor-pointer rounded-[10px] border-0 bg-transparent text-lg text-cx-text"
                  onClick={() => setZoom((z) => Math.min(6, z * 1.4))}
                >
                  +
                </button>
              </div>
            </div>
          </section>

          {ordered.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {ordered.map((t) => {
                const current = t.image_id === imageId;
                return (
                  <a
                    key={t.image_id}
                    href={href.library(batch, t.image_id)}
                    title={t.image_id}
                    className="block h-14 w-[72px] shrink-0 overflow-hidden rounded-lg"
                    style={{
                      boxShadow: current
                        ? `0 0 0 2px ${batchColor(batch)}, 0 0 0 4px var(--cx-bg)`
                        : "0 0 0 1px var(--cx-line)",
                      opacity: current ? 1 : 0.75,
                    }}
                  >
                    <img
                      src={imageUrl(batch, t.image_id, t.detectors.includes("BSE") ? "BSE" : t.detectors[0])}
                      alt={t.image_id}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  </a>
                );
              })}
            </div>
          )}

          <Panel className="flex flex-col gap-3.5 p-5">
            <h2 className="m-0 text-[15px] font-medium">
              This tile vs {baseline ? batchLabel(baseline) : "the baseline"}
            </h2>
            <TileKpiGrid tile={tile} tiles={tiles} baseline={baseline} dict={dict} />
          </Panel>
        </div>

        <aside className="col-span-3 flex min-w-0 flex-col gap-4">
          <Panel className="flex flex-col gap-4 p-5">
            <h2 className="m-0 flex items-center gap-2 text-[15px] font-medium">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 3l9 5-9 5-9-5 9-5z" />
                <path d="M3 13l9 5 9-5" />
              </svg>
              Layers
            </h2>
            <button
              type="button"
              role="switch"
              aria-checked={segmentation}
              disabled={!tile.has_mask}
              onClick={() => setSegmentation((s) => !s)}
              className={`flex min-h-10 cursor-pointer items-center gap-2.5 border-0 bg-transparent p-0 text-left text-sm text-cx-text ${tile.has_mask ? "" : "opacity-45"}`}
            >
              <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: "var(--cx-phase-si)" }} />
              <span className="flex-1">Segmentation</span>
              <span
                className="relative h-5 w-[34px] rounded-[10px] transition"
                style={{ background: segmentation ? "var(--cx-phase-si)" : "rgba(255,255,255,.14)" }}
              >
                <span
                  className="absolute top-0.5 h-4 w-4 rounded-full transition-all"
                  style={{ left: segmentation ? 16 : 2, background: segmentation ? "#fff" : "var(--cx-muted)" }}
                />
              </span>
            </button>
            {segmentation && (
              <div className="flex flex-col gap-1.5 text-[13px]">
                {PHASE_LEGEND.map(([label, color]) => (
                  <span key={label} className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: color }} />
                    {label}
                  </span>
                ))}
              </div>
            )}
            {!tile.has_mask && (
              <span className="text-xs text-cx-faint">No mask for this tile yet — re-run its batch.</span>
            )}
          </Panel>
        </aside>
      </div>
    </div>
  );
}
