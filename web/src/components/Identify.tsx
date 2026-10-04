import { useEffect, useRef, useState } from "react";
import {
  getAttribution, getHealth, getModelStatus, imageUrl, listAttributions, runAttribution, uploadBatch,
} from "../api";
import { batchLabel, isFixture, joinAnd, localTime, plural, record, uploadName, useApi } from "../lib";
import { href } from "../router";
import type { Attribution, AttributionStage, ModelStatus } from "../types";
import { BatchDot, CAT, Cat, ErrorPanel, IconWarn, PAGE, PageHeader, Panel, Spinner } from "./bits";
import IdentifyResult from "./IdentifyResult";

const DETECTOR_SLOTS = [
  { det: "BSE", hint: "Composition. Silicon shows bright." },
  { det: "ETD", hint: "Topography and edges." },
  { det: "InLens", hint: "Surface detail." },
];

const DETECTOR_ALIASES: Record<string, string> = { bse: "BSE", etd: "ETD", se: "ETD", inlens: "InLens" };

type TileFiles = { id: string; detectors: string[] };

/** The tiles in a drop (img_<id>_<detector>.tif, the backend's qc.io.field_paths), or what's wrong with it. */
function readDrop(files: File[]): { tifs: File[]; tiles: TileFiles[] } | string {
  const tifs = files.filter((f) => /\.tiff?$/i.test(f.name));
  if (!tifs.length) return "Drop the .tif images of a tile.";
  const groups = new Map<string, string[]>();
  const problems: string[] = [];
  for (const file of tifs) {
    const m = /^img_([\w.-]+)_([A-Za-z0-9]+)\.[Tt][Ii][Ff][Ff]?$/.exec(file.name);
    const det = m && DETECTOR_ALIASES[m[2].toLowerCase()];
    if (!m) problems.push(`${file.name} isn't named img_<id>_<detector>.tif.`);
    else if (!det) problems.push(`${file.name}: ${m[2]} isn't BSE, ETD, SE or InLens.`);
    else {
      const dets = groups.get(m[1]) ?? [];
      if (dets.includes(det)) problems.push(`${m[1]} has two ${det} images.`);
      groups.set(m[1], [...dets, det]);
    }
  }
  for (const [id, dets] of groups) {
    const missing = DETECTOR_SLOTS.map((s) => s.det).filter((d) => !dets.includes(d));
    if (missing.length) problems.push(`${id} is missing ${joinAnd(missing)}.`);
  }
  if (problems.length) return problems.slice(0, 3).join("\n") + (problems.length > 3 ? `\nAnd ${problems.length - 3} more.` : "");
  return { tifs, tiles: [...groups].map(([id, dets]) => ({ id, detectors: [...new Set(dets)].sort() })) };
}

/** drop_<YYYYMMDD>-<HHMMSS>, or "" (sorts last) for folders that aren't uploads. */
const stampOf = (name: string) => /^drop_(\d{8}-\d{6})$/.exec(name)?.[1] ?? "";

export default function Identify({ routeDrop, routeImage }: { routeDrop?: string; routeImage?: string }) {
  const [run, setRun] = useState<{ name: string; tiles: TileFiles[] } | null>(null);
  const [error, setError] = useState<{ text: string; raw?: string } | null>(null);
  const [uploaded, setUploaded] = useState(false);
  const [progress, setProgress] = useState<Progress>({ stage: "load", done: 0, total: 0, events: false });
  const [dragging, setDragging] = useState(false);
  const [reload, setReload] = useState(0);
  const picker = useRef<HTMLInputElement>(null);
  const runId = useRef(0);  // reset() bumps it, so a cancelled run's late events are ignored
  const model = useApi(getModelStatus, []);
  const health = useApi(getHealth, []);
  const notReady = useRef<string | null>(null);
  notReady.current = health.data && !health.data.ok ? health.data.message : null;
  const saved = useApi(() => (routeDrop ? getAttribution(routeDrop) : Promise.resolve(null)), [routeDrop]);
  const recent = useApi(async () => {
    const names = (await listAttributions()).filter((n) => !isFixture(n)).sort((a, b) => stampOf(b).localeCompare(stampOf(a)));
    const results = await Promise.allSettled(names.map((n) => getAttribution(n)));
    const runs = names
      .map((name, i) => ({ name, result: results[i] }))
      .filter((r): r is { name: string; result: PromiseFulfilledResult<Attribution> } => r.result.status === "fulfilled")
      .map(({ name, result }) => ({ name, attribution: result.value, times: 1 }));
    // the same tiles uploaded again: keep the newest and say how often
    const seen = new Map<string, (typeof runs)[number]>();
    for (const run of runs) {
      const key = run.attribution.images.map((i) => i.image_id).sort().join("|");
      const kept = seen.get(key);
      if (kept) kept.times += 1;
      else seen.set(key, run);
    }
    return [...seen.values()].slice(0, 6);
  }, [reload]);
  const idle = !run && !routeDrop;

  useEffect(() => {
    if (!routeDrop) return;
    setError(null);
    window.scrollTo(0, 0);
  }, [routeDrop]);

  // a file dropped anywhere on the page goes into the zone, not into a new browser tab
  useEffect(() => {
    if (!idle) return;
    const files = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
    const over = (e: DragEvent) => {
      if (!files(e)) return;
      e.preventDefault();
      setDragging(true);
    };
    const leave = (e: DragEvent) => !e.relatedTarget && setDragging(false);
    const drop = (e: DragEvent) => {
      if (!files(e)) return;
      e.preventDefault();
      setDragging(false);
      void start([...e.dataTransfer!.files]);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
      setDragging(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idle]);

  async function start(files: File[]) {
    if (notReady.current) return setError({ text: notReady.current });
    const drop = readDrop(files);
    if (typeof drop === "string") return setError({ text: drop });
    const name = uploadName();
    setRun({ name, tiles: drop.tiles });
    setError(null);
    setUploaded(false);
    setProgress({ stage: "load", done: 0, total: drop.tiles.length, events: false });
    const id = ++runId.current;
    const live = () => id === runId.current;
    const fail = (text: string, raw: string) => {
      setError({ text: raw.includes("--fit") ? "There's no fitted model to identify with yet." : text, raw });
      setRun(null);
    };
    let uploading = true;
    try {
      await uploadBatch(name, drop.tifs);
      uploading = false;
      if (!live()) return;
      setUploaded(true);
      setProgress((p) => ({ ...p, stage: "features", done: 0 }));
      await runAttribution(name, null, (event) => {
        if (!live()) return;
        if (event.type === "progress") {
          // events arrive after each tile, so a finished stage means the next one is running now
          const stage = event.stage ?? "features";
          const next = event.done >= event.total ? NEXT_STAGE[stage] : undefined;
          setProgress({ stage: next ?? stage, done: next ? 0 : event.done, total: event.total, tile: event.tile, events: true });
        }
        if (event.type === "done") {
          setProgress((p) => ({ ...p, stage: "done" }));
          // let the line sweep to the end before the result opens
          window.setTimeout(() => {
            if (!live()) return;
            setRun(null);
            window.location.hash = href.identify(name);
          }, 600);
        }
        if (event.type === "error") fail("The analysis stopped before it finished.", event.message);
      });
    } catch (err) {
      if (!live()) return;
      fail(uploading ? "The upload didn't go through." : "The analysis stopped before it finished.", err instanceof Error ? err.message : String(err));
    }
    setReload((r) => r + 1);
  }

  function reset() {
    runId.current += 1;
    setRun(null);
  }

  if (run)
    return <Working name={run.name} tiles={run.tiles} uploaded={uploaded} progress={progress} onCancel={reset} />;
  if (routeDrop) {
    if (saved.data) return <IdentifyResult name={routeDrop} attribution={saved.data} imageId={routeImage} />;
    if (saved.error)
      return (
        <div className={`${PAGE} gap-4`}>
          <ErrorPanel
            title={`No identification called ${batchLabel(routeDrop)}`}
            message={saved.status && saved.status < 500 ? "There's no saved result for this link." : saved.error}
          />
          <a className="btn w-fit" href={href.identify()}>Identify a tile</a>
        </div>
      );
    return <div className="grid flex-1 place-items-center py-24"><Spinner /></div>;
  }

  return (
    <div className={`${PAGE} gap-10`}>
      <PageHeader
        title="Which batch is this tile from?"
        intro="Drop the three detector images of one tile. Catalyst segments it, measures every silicon particle and tells you which known batch it matches, and how sure it is."
      />

      {health.data && !health.data.ok && health.data.message && (
        <div role="alert" className="flex items-start gap-3 rounded-[14px] border border-cx-investigate/25 bg-cx-investigate/[0.05] px-4 py-3 text-sm">
          <span className="mt-0.5 text-cx-investigate"><IconWarn size={16} /></span>
          <span>
            <span className="font-medium">This machine can't identify a tile yet.</span>{" "}
            <span className="text-cx-text-2">{health.data.message} The upload stays closed until that's fixed.</span>
          </span>
        </div>
      )}

      <div className="relative pt-11">
        <img
          src={CAT.peeking}
          alt=""
          className="absolute top-0 left-16 z-[2] h-[60px] w-[104px]"
          aria-hidden
        />
        <section
          aria-label="Drop zone"
          className="glass relative flex flex-col gap-8 rounded-[28px] p-10 transition"
          style={{ outline: `1.5px dashed ${dragging ? "rgba(255,122,47,.6)" : "rgba(255,255,255,.16)"}`, outlineOffset: -12 }}
        >
          <div className="grid grid-cols-3 gap-4">
            {DETECTOR_SLOTS.map((slot) => (
              <div
                key={slot.det}
                className="flex min-h-[150px] flex-col gap-3.5 rounded-[18px] border border-cx-line bg-black/25 p-5"
              >
                <span className="mono text-[13px] font-semibold text-cx-text">
                  {slot.det === "ETD" ? "ETD / SE" : slot.det}
                </span>
                <div
                  className="flex-1 rounded-[10px]"
                  style={{
                    backgroundImage:
                      "repeating-linear-gradient(135deg, rgba(255,255,255,.04) 0 6px, transparent 6px 12px)",
                  }}
                />
                <div className="text-[13px] leading-snug text-cx-muted">{slot.hint}</div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="grid h-12 w-12 place-items-center rounded-[14px] border border-cx-orange/30 bg-cx-orange/10 text-cx-orange-text">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
                </svg>
              </div>
              <div className="flex flex-col gap-1">
                <div className="text-lg font-medium">Drop images here</div>
                <div className="mono text-xs text-cx-faint">img_&lt;id&gt;_BSE / _ETD (or _SE) / _InLens .tif</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <input
                ref={picker}
                type="file"
                multiple
                accept=".tif,.tiff"
                className="hidden"
                onChange={(e) => {
                  void start([...(e.target.files ?? [])]);
                  e.target.value = "";
                }}
              />
              <button className="btn pri" type="button" disabled={!!notReady.current} onClick={() => picker.current?.click()}>
                Choose files
              </button>
            </div>
          </div>
        </section>
        <div className="flex items-center gap-2 px-2 pt-3.5 text-[13px] text-cx-muted">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v5M12 8h.01" />
          </svg>
          Got a whole folder of tiles? <a href={href.compare()}>Compare it as a batch instead</a>
        </div>
      </div>

      {error && (
        <ErrorPanel
          title="Couldn't identify the tile"
          message={<span className="whitespace-pre-line">{error.text}</span>}
          details={error.raw}
          command={error.raw?.includes("--fit") ? "uv run python -m qc.attribute --fit" : undefined}
        />
      )}

      <div className="grid grid-cols-3 gap-4">
        <Panel className="col-span-2 overflow-hidden p-0">
          <h2 className="m-0 border-b border-cx-line px-5 py-4 text-[15px] font-medium">Recent identifications</h2>
          {recent.data?.length ? (
            <div className="flex flex-col text-sm">
              <div className="lbl grid grid-cols-[200px_minmax(0,1fr)] gap-4 px-5 py-3">
                <span>Upload</span>
                <span>Closest batch per tile</span>
              </div>
              {recent.data.map(({ name, attribution: a, times }) => (
                <a
                  key={name}
                  href={href.identify(name)}
                  className="grid min-h-12 grid-cols-[200px_minmax(0,1fr)] items-center gap-4 border-t border-cx-line-soft px-5 py-3 text-cx-text hover:bg-white/[0.03]"
                >
                  <span>
                    {batchLabel(name)}
                    {times > 1 && <span className="pl-2 text-xs text-cx-faint">uploaded {times}×</span>}
                  </span>
                  <span className="flex flex-wrap gap-x-4 gap-y-1">
                    {a.images.slice(0, 4).map((img) => (
                      <span key={img.image_id} className="inline-flex items-center gap-2">
                        {a.images.length > 1 && <span className="mono text-xs text-cx-faint">{img.image_id}</span>}
                        <BatchDot name={img.predicted} size={8} />
                        {batchLabel(img.predicted)}
                        <span className="mono text-cx-muted">{img.confidence != null ? `${Math.round(img.confidence * 100)}%` : "—"}</span>
                        {img.unfamiliar && (
                          <span className="inline-flex items-center gap-1 text-cx-investigate" title="Outside the range of the batch it was assigned to">
                            <IconWarn /> unfamiliar
                          </span>
                        )}
                      </span>
                    ))}
                    {a.images.length > 4 && <span className="text-cx-faint">+{a.images.length - 4} more</span>}
                  </span>
                </a>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-3 px-5 py-8 text-sm text-cx-muted">
              <Cat mood="ready" size={34} />
              Nothing identified yet — drop a tile above.
            </div>
          )}
        </Panel>

        <Panel className="glass flex flex-col gap-4 border-0">
          <h2 className="m-0 text-[15px] font-medium">How sure can it be?</h2>
          {model.data ? (
            <ModelGauge model={model.data} />
          ) : (
            <p className="m-0 text-[13px] leading-normal text-cx-muted">
              No model yet — run <code className="mono text-cx-text-2">uv run python -m qc.attribute --fit</code>.
            </p>
          )}
        </Panel>
      </div>
    </div>
  );
}

/** The model in config/attribution_model.json: what it got right on strips it never saw. */
function ModelGauge({ model }: { model: ModelStatus }) {
  const acc = model.loso_balanced_accuracy;
  const chance = model.classes.length ? 1 / model.classes.length : null;
  const stages = model.calibration?.stages;
  return (
    <div className="flex flex-1 flex-col gap-4">
      {acc != null && (
        <div className="flex flex-col gap-2.5">
          <span className="text-[40px] leading-none font-semibold tracking-[-0.03em]">{Math.round(acc * 100)}%</span>
          <div className="relative h-2 rounded bg-white/[0.07]">
            <div className="absolute inset-y-0 left-0 rounded bg-cx-text" style={{ width: `${acc * 100}%` }} />
            {chance != null && (
              <div className="absolute -top-1 -bottom-1 w-0.5 bg-cx-orange" style={{ left: `${chance * 100}%` }} />
            )}
          </div>
          <span className="text-[13px] text-cx-muted">
            balanced accuracy on held-out strips ·{" "}
            <span className="text-cx-orange-text">chance {chance != null ? `${Math.round(chance * 100)}%` : "—"}</span>
          </span>
        </div>
      )}
      <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 text-[13px]">
        {stages?.baseline && (
          <>
            <dt className="text-cx-muted">Baseline or not</dt>
            <dd className="mono m-0 text-right">{record(stages.baseline)}</dd>
          </>
        )}
        {stages?.variation && (
          <>
            <dt className="text-cx-muted">Which other batch</dt>
            <dd className="mono m-0 text-right">{record(stages.variation)}</dd>
          </>
        )}
        {model.calibration?.tiers.filter((t) => t.n > 0).map((t) => (
          <div key={t.tier} className="contents">
            <dt className="text-cx-muted">{TIER_TEXT[t.tier]}</dt>
            <dd className="mono m-0 text-right">{record(t)}</dd>
          </div>
        ))}
      </dl>
      <span className="mt-auto text-xs text-cx-faint">Fitted {localTime(model.fitted_at).slice(0, 10)}</span>
    </div>
  );
}

const TIER_TEXT = { high: "When 75% sure or more", medium: "When 50–75% sure", low: "When under 50% sure" } as const;

type Stage = "load" | AttributionStage | "done";
const NEXT_STAGE: Partial<Record<Stage, Stage>> = { features: "deep", deep: "predict" };

interface Progress {
  stage: Stage;
  done: number;
  total: number;
  tile?: string;
  events: boolean;  // the backend sends stage events (older ones only send "done")
}

/** Share of the line per stage, tuned to real timings (DINOv2 and segmentation dominate). */
const STAGES: { stage: Stage; from: number; to: number; label: (n: number) => string }[] = [
  { stage: "load", from: 0, to: 10, label: (n) => `Uploading ${plural(n, "tile")}` },
  { stage: "features", from: 10, to: 55, label: () => "Segmenting pore, graphite, silicon and binder; measuring" },
  { stage: "deep", from: 55, to: 90, label: () => "Image features" },
  { stage: "predict", from: 90, to: 99, label: () => "Scoring against the known batches" },
  { stage: "done", from: 100, to: 100, label: () => "Saving the result" },
];

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** Where the line is: jumps on each event, creeps towards (never reaching) the next boundary in between. */
function useLine(progress: Progress): number {
  const [x, setX] = useState(0);
  const s = STAGES.findIndex((st) => st.stage === progress.stage);
  const { from, to } = STAGES[s];
  const n = Math.max(1, progress.total);
  const base = progress.stage === "done" ? 100 : from + ((to - from) * Math.min(progress.done, n)) / n;
  const cap = progress.stage === "done" ? 100 : from + ((to - from) * Math.min(progress.done + 1, n)) / n - 0.5;
  useEffect(() => setX((v) => Math.max(v, base)), [base]);
  useEffect(() => {
    if (reducedMotion() || progress.stage === "done") return;
    const id = window.setInterval(() => setX((v) => (v < cap ? v + (cap - v) * 0.012 : v)), 150);  // slow: ~12 s to close the gap
    return () => window.clearInterval(id);
  }, [cap, progress.stage]);
  return x;
}

function Working({
  name,
  tiles,
  uploaded,
  progress,
  onCancel,
}: {
  name: string;
  tiles: TileFiles[];
  uploaded: boolean;
  progress: Progress;
  onCancel: () => void;
}) {
  const first = tiles[0];
  const det = first?.detectors.includes("BSE") ? "BSE" : first?.detectors[0] ?? "BSE";
  const x = useLine(progress);
  const [stalled, setStalled] = useState(false);
  // no stage events a while after the upload (an older backend): sweep on a loop instead of parking the line
  useEffect(() => {
    if (!uploaded || progress.events) return setStalled(false);
    // the first event comes after the first tile is segmented, so allow for a slow tile before giving up
    const id = window.setTimeout(() => setStalled(true), 20000);
    return () => window.clearTimeout(id);
  }, [uploaded, progress.events]);
  const indeterminate = stalled && progress.stage !== "done";
  const current = STAGES.findIndex((st) => st.stage === progress.stage);
  const motion = !reducedMotion();
  return (
    <div className={`${PAGE} gap-7`}>
      <PageHeader
        title={
          <>
            Reading {tiles.length === 1 ? "tile" : `${tiles.length} tiles`}{" "}
            <span className="mono font-medium">
              {progress.stage === "features" || progress.stage === "deep" ? progress.tile?.split("/").pop() ?? first?.id : first?.id ?? name}
            </span>
          </>
        }
        intro="Nothing leaves this machine."
      >
        <button className="btn" type="button" onClick={onCancel}>
          Cancel
        </button>
      </PageHeader>

      {first && (
        <section aria-label="Scan" className="relative aspect-[1800/536] overflow-hidden rounded-3xl border border-cx-line bg-black">
          {uploaded && (
            <>
              <img src={imageUrl(name, first.id, det, 2048)} alt={`${det} image of tile ${first.id}`} className="absolute inset-0 h-full w-full object-cover" />
              {!indeterminate && (
                <img
                  src={imageUrl(name, first.id, det, 2048)}
                  alt=""
                  aria-hidden
                  className="absolute inset-0 h-full w-full object-cover"
                  style={{
                    filter: "grayscale(1) brightness(.5) contrast(1.15)",
                    clipPath: `inset(0 calc(100% - ${x}%) 0 0)`,
                    transition: motion ? "clip-path .3s ease-out" : undefined,
                  }}
                />
              )}
            </>
          )}
          <div
            className={`absolute inset-y-0 w-0.5 bg-cx-orange ${indeterminate && motion ? "sweep" : ""}`}
            style={{
              left: indeterminate ? undefined : `${x}%`,
              boxShadow: "0 0 18px 4px rgba(255,122,47,.55)",
              transition: motion && !indeterminate ? "left .3s ease-out" : undefined,
              display: indeterminate && !motion ? "none" : undefined,
            }}
          />
          <span className="glass mono absolute right-3 bottom-3 rounded-[10px] px-2.5 py-1 text-xs text-cx-text" style={{ background: "rgba(14,15,18,.6)" }}>
            {indeterminate ? "working…" : `${Math.round(x)}%`}
          </span>
        </section>
      )}

      <div className="grid grid-cols-3 gap-4">
        <Panel className="glass col-span-2 flex flex-col gap-4 border-0">
          <h2 className="m-0 text-[15px] font-medium">Pipeline</h2>
          <ol className="m-0 flex list-none flex-col p-0">
            {STAGES.map((st, i) => {
              const state = progress.stage === "done" || i < current ? "done" : i === current ? "running" : "pending";
              const count = st.stage === progress.stage && progress.total > 1 && st.stage !== "predict" && st.stage !== "load"
                ? `${Math.min(progress.done, progress.total)}/${progress.total}` : null;
              return (
                <li key={st.stage} className="flex min-h-11 items-center gap-3.5 border-b border-cx-line-soft last:border-0">
                  {state === "done" && (
                    <span className="grid h-[22px] w-[22px] place-items-center rounded-full bg-cx-accept/15 text-cx-accept">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M5 12l5 5 9-10" />
                      </svg>
                    </span>
                  )}
                  {state === "running" && <Spinner size={22} />}
                  {state === "pending" && <span className="box-border h-[22px] w-[22px] rounded-full border-[1.5px] border-white/20" />}
                  <span className={`flex-1 ${state === "pending" ? "text-cx-faint" : ""}`}>{st.label(tiles.length)}</span>
                  {state === "running" && (
                    <span className="mono text-xs text-cx-orange-text">{count ?? (indeterminate ? "running" : "")}</span>
                  )}
                </li>
              );
            })}
          </ol>
        </Panel>
        <Panel className="flex flex-col gap-4">
          <h2 className="m-0 text-[15px] font-medium">Detectors</h2>
          <div className="flex flex-col gap-4">
            {tiles.map((tile) => (
              <div key={tile.id} className="flex flex-col gap-2.5">
                {tiles.length > 1 && <span className="mono text-xs text-cx-faint">{tile.id}</span>}
                {tile.detectors.map((d) => (
                  <div key={d} className="flex items-center gap-3">
                    {uploaded ? (
                      <img src={imageUrl(name, tile.id, d)} alt={d} className="h-10 w-24 rounded-lg border border-cx-line object-cover" />
                    ) : (
                      <span className="h-10 w-24 animate-pulse rounded-lg border border-cx-line bg-white/[0.04]" />
                    )}
                    <span className="mono flex-1 text-[13px]">{d}</span>
                    <span className={uploaded ? "text-xs text-cx-accept" : "text-xs text-cx-faint"}>{uploaded ? "Loaded" : "Uploading"}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="mt-auto flex items-center gap-3 border-t border-cx-line pt-4">
            <Cat mood="sniffing" size={34} />
            <span className="text-[13px] leading-snug text-cx-muted">Whiskers twitching. Sniffing out silicon…</span>
          </div>
        </Panel>
      </div>
    </div>
  );
}
