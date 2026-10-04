import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getConfig, getKpiDictionary, getParticles, getTiles, imageUrl, layerUrl, maskUrl } from "../api";
import { batchColor, batchLabel, fmt, isUploadBatch, libraryTiles, plural, quantityNote, useApi } from "../lib";
import { href, replaceRoute } from "../router";
import type { KpiDictionary, Tile } from "../types";
import {
  BatchChip, BatchDot, Cat, ErrorPanel, LAYERS, PAGE, PageHeader, PHASE_LEGEND, Panel, Seg, Spinner, TileKpiGrid,
  type Layer,
} from "./bits";

const previewDetector = (t: Tile) => (t.detectors.includes("BSE") ? "BSE" : t.detectors[0]);

export default function Library({ routeBatch, routeImage }: { routeBatch?: string; routeImage?: string }) {
  const tiles = useApi(getTiles);
  const config = useApi(getConfig);
  const dict = useApi(getKpiDictionary);

  const all = useMemo(() => libraryTiles(tiles.data ?? []), [tiles.data]);
  const batches = useMemo(() => [...new Set(all.map((t) => t.batch))].sort(), [all]);
  const knownBatches = batches.filter((b) => !isUploadBatch(b));
  const uploads = all.filter((t) => isUploadBatch(t.batch));
  const baseline = config.data?.baseline ?? null;
  const filter = routeBatch ?? "all";
  const valid = filter === "all" || (filter === "uploads" ? uploads.length > 0 : batches.includes(filter));

  useEffect(() => {
    if (tiles.data && !routeImage && !valid) replaceRoute(href.library());
  }, [tiles.data, routeImage, valid]);

  if (routeBatch && routeImage)
    return (
      <Viewer
        tiles={tiles.data}
        error={tiles.error}
        batch={routeBatch}
        imageId={routeImage}
        baseline={baseline}
        dict={dict.data}
      />
    );

  const group = (b: string) => ({
    key: b, label: batchLabel(b), note: b === baseline ? "baseline" : null, tiles: all.filter((t) => t.batch === b),
  });
  const uploaded = { key: "uploads", label: "Uploads", note: null, tiles: uploads };
  const groups =
    filter === "all"
      ? [
          ...[...knownBatches].sort((a, b) => Number(b === baseline) - Number(a === baseline)).map(group),
          ...(uploads.length ? [uploaded] : []),
        ]
      : filter === "uploads" ? [uploaded] : [group(filter)];

  return (
    <div className={`${PAGE} gap-8`}>
      <PageHeader title="Library">
        {all.length > 0 && (
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
              ...(uploads.length
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
            value={isUploadBatch(filter) ? "uploads" : valid ? filter : "all"}
            onChange={(v) => replaceRoute(href.library(v === "all" ? null : v))}
          />
        )}
      </PageHeader>

      {tiles.error ? (
        <ErrorPanel title="Couldn't load the tiles" message={tiles.error} />
      ) : !tiles.data ? (
        <Loading />
      ) : !all.length ? (
        <Panel className="flex items-center gap-3 text-sm text-cx-muted">
          <Cat mood="ready" size={34} />
          <span>No tiles yet. Upload a folder of tiles on <a href={href.compare()}>Compare</a>.</span>
        </Panel>
      ) : (
        groups.map((g) => (
          <section key={g.key} className="flex flex-col gap-3">
            <h2 className="m-0 flex items-center gap-2 text-[15px] font-medium">
              <BatchDot name={g.key === "uploads" ? "drop" : g.key} size={8} />
              {g.label}
              <span className="font-normal text-cx-faint">
                · {[g.note, plural(g.tiles.length, "tile")].filter(Boolean).join(" · ")}
              </span>
            </h2>
            <div className="grid grid-cols-4 gap-3">
              {g.tiles.map((tile) => (
                <a
                  key={`${tile.batch}/${tile.image_id}`}
                  href={href.library(tile.batch, tile.image_id)}
                  className="group relative block overflow-hidden rounded-[14px] border border-cx-line hover:border-white/20"
                >
                  <Thumb tile={tile} className="aspect-[4/3] w-full object-cover transition group-hover:scale-[1.02]" />
                  <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: batchColor(tile.batch) }} />
                  <span className="mono absolute bottom-2 left-2 rounded-md px-1.5 py-0.5 text-[11px] text-cx-text" style={{ background: "rgba(10,11,13,.75)" }}>
                    {tile.image_id}
                  </span>
                </a>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function Loading() {
  return (
    <div className="grid place-items-center gap-3 py-24">
      <Cat mood="sniffing" size={48} />
      <Spinner />
    </div>
  );
}

function Thumb({ tile, className, note = true }: { tile: Tile; className: string; note?: boolean }) {
  const [broken, setBroken] = useState(false);
  return broken ? (
    <span className={`grid place-items-center bg-[#111215] text-xs text-cx-faint ${className}`}>{note && "Can't read this image"}</span>
  ) : (
    <img
      src={imageUrl(tile.batch, tile.image_id, previewDetector(tile))}
      alt=""
      loading="lazy"
      className={className}
      onError={() => setBroken(true)}
    />
  );
}

function Viewer({
  tiles,
  error,
  batch,
  imageId,
  baseline,
  dict,
}: {
  tiles: Tile[] | null;
  error: string | null;
  batch: string;
  imageId: string;
  baseline: string | null;
  dict: KpiDictionary | null;
}) {
  const tile = tiles?.find((t) => t.batch === batch && t.image_id === imageId);
  const ordered = (tiles ?? []).filter((t) => t.batch === batch);
  const index = ordered.findIndex((t) => t.image_id === imageId);
  const [detector, setDetector] = useState<string | null>(null);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [mask, setMask] = useState(false);
  const [hot, setHot] = useState<number | null>(null);
  const particles = useApi(() => (tile ? getParticles(batch, imageId, 6) : Promise.resolve(null)), [batch, imageId, !!tile]);

  const go = (delta: number) => {
    const next = ordered[(index + delta + ordered.length) % ordered.length];
    if (index >= 0 && ordered.length > 1 && next) replaceRoute(href.library(batch, next.image_id));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
      if ((e.target as HTMLElement | null)?.closest?.('[role="tablist"], input, select, textarea')) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!tile)
    return (
      <div className={`${PAGE} gap-6`}>
        {error ? (
          <ErrorPanel title="Couldn't load the tiles" message={error} />
        ) : !tiles ? (
          <Loading />
        ) : (
          <Panel className="flex items-center gap-3 text-sm text-cx-muted">
            <Cat mood="ready" size={34} />
            <span>{batchLabel(batch)} has no tile “{imageId}”. <a href={href.library(ordered.length ? batch : null)}>Back to the library</a></span>
          </Panel>
        )}
      </div>
    );

  const det = detector && tile.detectors.includes(detector) ? detector : previewDetector(tile);
  const found = particles.data?.particles.length ? particles.data : null;
  const spot = found && hot != null ? found.particles[hot] : null;

  return (
    <div className={`${PAGE} gap-5`}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <h1 className="mono m-0 text-[28px] font-medium tracking-[-0.02em]" title={tile.strip_id ? `Strip ${tile.strip_id}` : undefined}>
            {imageId}
          </h1>
          <BatchChip name={batch} />
        </div>
        {ordered.length > 1 && (
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
        )}
      </div>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-9 flex min-w-0 flex-col gap-4">
          <Micrograph
            key={`${batch}/${imageId}`}
            tile={tile}
            detector={det}
            onDetector={(d) => {
              setDetector(d);
              setMask(false);
            }}
            layers={tile.has_layers ? layers : []}
            mask={mask && tile.has_mask && !tile.has_layers}
            ring={
              spot && found
                ? { x: spot.x / found.width, y: spot.y / found.height, d: found.px_um ? spot.d_um / found.px_um / found.width : 0 }
                : null
            }
          />

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
                    <Thumb tile={t} note={false} className="h-full w-full object-cover" />
                  </a>
                );
              })}
            </div>
          )}

          <Panel className="flex flex-col gap-3.5 p-5">
            <h2 className="m-0 text-[15px] font-medium">
              Against the baseline{baseline ? `, ${batchLabel(baseline)}` : ""}
            </h2>
            <TileKpiGrid tile={tile} tiles={tiles ?? []} baseline={baseline} dict={dict} />
          </Panel>
        </div>

        <aside className="col-span-3 flex min-w-0 flex-col gap-4">
          <Panel className="flex flex-col gap-1.5 p-5">
            <h2 className="m-0 mb-1.5 flex items-center gap-2 text-[15px] font-medium">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 3l9 5-9 5-9-5 9-5z" />
                <path d="M3 13l9 5 9-5" />
              </svg>
              Layers
            </h2>
            {tile.has_layers ? (
              LAYERS.map((l) => (
                <Switch
                  key={l.id}
                  label={l.label}
                  color={l.color}
                  on={layers.includes(l.id)}
                  onClick={() => setLayers((ls) => (ls.includes(l.id) ? ls.filter((x) => x !== l.id) : [...ls, l.id]))}
                />
              ))
            ) : tile.has_mask ? (
              <>
                <Switch label="Phase mask" color="var(--cx-phase-si)" on={mask} onClick={() => setMask((m) => !m)} />
                {mask && (
                  <div className="flex flex-col gap-1.5 text-[13px]">
                    {PHASE_LEGEND.map(([label, color]) => (
                      <span key={label} className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: color }} />
                        {label}
                      </span>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <span className="text-[13px] text-cx-muted">Not measured yet.</span>
            )}
          </Panel>

          {found && (
            <Panel className="flex flex-col gap-2 p-5">
              <h2 className="m-0 text-[15px] font-medium">Largest silicon particles</h2>
              <ol className="m-0 flex list-none flex-col p-0" onMouseLeave={() => setHot(null)}>
                {found.particles.map((p, i) => (
                  <li
                    key={i}
                    onMouseEnter={() => setHot(i)}
                    className="mono grid grid-cols-[20px_1fr_auto] items-center gap-2 border-t border-cx-line-soft py-2 text-[13px] first:border-t-0 hover:text-cx-text-strong"
                  >
                    <span className="text-cx-faint">{i + 1}</span>
                    <span>{fmt(p.d_um, "um")}</span>
                    {p.type && (
                      <span className="text-cx-muted" title={quantityNote(`type_share:${p.type}`, dict) ?? undefined}>
                        {p.type}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </Panel>
          )}
        </aside>
      </div>
    </div>
  );
}

function Micrograph({
  tile,
  detector,
  onDetector,
  layers,
  mask,
  ring,
}: {
  tile: Tile;
  detector: string;
  onDetector: (detector: string) => void;
  layers: Layer[];
  mask: boolean;
  ring: { x: number; y: number; d: number } | null;
}) {
  const box = useRef<HTMLElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const centre = useRef({ x: 0.5, y: 0.5 });
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    const el = box.current!;
    const observer = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fit = size && natural ? Math.min(size.w, (size.h * natural.w) / natural.h) : null;
  const cap = fit && natural ? Math.max(1, natural.w / fit) : 1;
  const steps = [1];
  for (let s = 1.5; s < cap - 0.15; s += 0.5) steps.push(s);
  if (cap > 1.01) steps.push(cap);
  const z = Math.min(zoom, cap);

  const zoomTo = (next: number | undefined) => {
    const el = scroller.current;
    const pic = el?.firstElementChild as HTMLElement | null | undefined;
    if (next == null || !el || !pic) return;
    centre.current = {
      x: (el.scrollLeft + el.clientWidth / 2 - pic.offsetLeft) / pic.offsetWidth,
      y: (el.scrollTop + el.clientHeight / 2 - pic.offsetTop) / pic.offsetHeight,
    };
    setZoom(next);
  };

  useLayoutEffect(() => {
    const el = scroller.current;
    const pic = el?.firstElementChild as HTMLElement | null | undefined;
    if (!el || !pic) return;
    el.scrollLeft = centre.current.x * pic.offsetWidth + pic.offsetLeft - el.clientWidth / 2;
    el.scrollTop = centre.current.y * pic.offsetHeight + pic.offsetTop - el.clientHeight / 2;
  }, [z]);

  const src = mask ? maskUrl(tile.batch, tile.image_id) : imageUrl(tile.batch, tile.image_id, detector, 2048);
  const zoomButton = "text-lg disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="flex flex-col gap-3">
      <section ref={box} aria-label="Micrograph" className="relative aspect-[3/1] overflow-hidden rounded-3xl border border-cx-line bg-black">
        {failed === src ? (
          <div className="grid h-full place-items-center text-sm text-cx-faint">Can't read this image</div>
        ) : (
          <div ref={scroller} className="absolute inset-0 flex overflow-auto [scrollbar-color:rgba(255,255,255,.25)_transparent] [scrollbar-width:thin]">
            <div
              className="relative m-auto shrink-0"
              style={fit && natural ? { width: fit * z, height: (fit * z * natural.h) / natural.w } : { width: "100%" }}
            >
              <img
                src={src}
                alt={`${mask ? "Phase mask" : detector} of tile ${tile.image_id}`}
                className="block h-full w-full"
                onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                onError={() => setFailed(src)}
              />
              {layers.map((l) => (
                <img key={l} src={layerUrl(tile.batch, tile.image_id, l)} alt="" className="absolute inset-0 h-full w-full opacity-75" />
              ))}
              {ring && (
                <span
                  className="pointer-events-none absolute aspect-square -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-cx-text-strong"
                  style={{
                    left: `${ring.x * 100}%`,
                    top: `${ring.y * 100}%`,
                    width: `max(20px, ${ring.d * 160}%)`,
                    boxShadow: "0 0 0 2px rgba(10,11,13,.6)",
                  }}
                />
              )}
            </div>
          </div>
        )}
      </section>
      <div className="flex items-center justify-between gap-3">
        <Seg
          options={tile.detectors.map((d) => ({ value: d, label: <span className="mono text-xs">{d}</span> }))}
          value={mask ? "" : detector}
          onChange={onDetector}
        />
        <div className="seg glass items-center" role="group" aria-label="Zoom">
          <button type="button" aria-label="Zoom out" disabled={z <= 1} className={zoomButton} onClick={() => zoomTo(steps.filter((s) => s < z - 1e-3).at(-1))}>
            −
          </button>
          <span className="mono w-12 text-center text-xs text-cx-text-2">{Math.round(z * 100)}%</span>
          <button type="button" aria-label="Zoom in" disabled={z >= cap - 1e-3} className={zoomButton} onClick={() => zoomTo(steps.find((s) => s > z + 1e-3))}>
            +
          </button>
        </div>
      </div>
    </div>
  );
}

function Switch({ label, color, on, onClick }: { label: string; color: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className="flex min-h-10 cursor-pointer items-center gap-2.5 border-0 bg-transparent p-0 text-left text-sm text-cx-text"
    >
      <span className="flex-1">{label}</span>
      <span className="relative h-5 w-[34px] rounded-[10px] transition" style={{ background: on ? color : "rgba(255,255,255,.14)" }}>
        <span className="absolute top-0.5 h-4 w-4 rounded-full transition-all" style={{ left: on ? 16 : 2, background: on ? "#fff" : "var(--cx-muted)" }} />
      </span>
    </button>
  );
}
