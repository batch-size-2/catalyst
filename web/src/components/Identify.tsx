import { useEffect, useRef, useState } from "react";
import {
  getAttribution, getModelStatus, imageUrl, listAttributions, runAttribution, uploadBatch,
} from "../api";
import { batchLabel, isFixture, localTime, modelName, record, useApi } from "../lib";
import { href } from "../router";
import type { Attribution, AttributionStage, ModelStatus } from "../types";
import { BatchDot, CAT, Cat, ErrorPanel, IconWarn, Panel, Spinner } from "./bits";
import IdentifyResult from "./IdentifyResult";

const DETECTOR_SLOTS = [
  { det: "BSE", hint: "Composition. Silicon shows bright." },
  { det: "ETD", hint: "Topography and edges." },
  { det: "InLens", hint: "Surface detail." },
];

const DETECTOR_ALIASES: Record<string, string> = { bse: "BSE", etd: "ETD", se: "ETD", inlens: "InLens" };

function tileOf(file: File): { id: string; det: string } | null {
  const match = file.name.match(/^(?:img_)?(.+)_([A-Za-z]+)\.tiff?$/i);
  if (!match) return null;
  return { id: match[1], det: DETECTOR_ALIASES[match[2].toLowerCase()] ?? match[2] };
}

type Phase = "idle" | "working" | "done" | "error";

export default function Identify() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [runName, setRunName] = useState<string | null>(null);
  const [attribution, setAttribution] = useState<Attribution | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tiles, setTiles] = useState<{ id: string; detectors: string[] }[]>([]);
  const [uploaded, setUploaded] = useState(false);
  const [progress, setProgress] = useState<Progress>({ stage: "load", done: 0, total: 0, events: false });
  const [dragging, setDragging] = useState(false);
  const [reload, setReload] = useState(0);
  const picker = useRef<HTMLInputElement>(null);
  const runId = useRef(0);  // reset() bumps it, so a cancelled run's late events are ignored
  const model = useApi(getModelStatus, []);
  const recent = useApi(async () => {
    const names = (await listAttributions()).filter((n) => !isFixture(n));
    const results = await Promise.allSettled(names.map((n) => getAttribution(n)));
    const runs = names
      .map((name, i) => ({ name, result: results[i] }))
      .filter((r): r is { name: string; result: PromiseFulfilledResult<Attribution> } => r.result.status === "fulfilled")
      .map(({ name, result }) => ({ name, attribution: result.value, times: 1 }))
      .reverse();  // drop_<date>-<time>: newest first
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

  async function start(files: File[]) {
    const tifs = files.filter((f) => /\.tiff?$/i.test(f.name));
    if (!tifs.length) return;
    const groups = new Map<string, Set<string>>();
    for (const file of tifs) {
      const tile = tileOf(file);
      if (!tile) continue;
      groups.set(tile.id, (groups.get(tile.id) ?? new Set()).add(tile.det));
    }
    if (!groups.size) {
      setError("Files must be named img_<id>_<detector>.tif (BSE, ETD or InLens).");
      setPhase("error");
      return;
    }
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const name = `drop_${stamp.slice(0, 8)}-${stamp.slice(8)}`;
    setTiles([...groups.entries()].map(([id, detectors]) => ({ id, detectors: [...detectors].sort() })));
    setRunName(name);
    setAttribution(null);
    setError(null);
    setPhase("working");
    setUploaded(false);
    setProgress({ stage: "load", done: 0, total: groups.size, events: false });
    const id = ++runId.current;
    const live = () => id === runId.current;
    try {
      await uploadBatch(name, tifs);
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
            setAttribution(event.attribution);
            setPhase("done");
          }, 600);
        }
        if (event.type === "error") {
          setError(event.message);
          setPhase("error");
        }
      });
    } catch (err) {
      if (!live()) return;
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
    setReload((r) => r + 1);
  }

  function reset() {
    runId.current += 1;
    setPhase("idle");
    setRunName(null);
    setAttribution(null);
    setError(null);
    setTiles([]);
  }

  if (phase === "working" && runName)
    return <Working name={runName} tiles={tiles} uploaded={uploaded} progress={progress} onCancel={reset} />;
  if (phase === "done" && attribution && runName)
    return <IdentifyResult name={runName} attribution={attribution} onReset={reset} />;

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-10 px-10 py-12">
      <div className="flex flex-col gap-2.5">
        <div className="lbl text-cx-orange-text">Identify</div>
        <h1 className="m-0 text-[40px] leading-[1.1] font-semibold tracking-[-0.03em]">
          Which batch is this tile from?
        </h1>
        <p className="m-0 max-w-[620px] text-base leading-[1.55] text-cx-muted">
          Drop the three detector images of one tile. Catalyst segments it, measures every silicon
          particle and tells you which known batch it matches, and how sure it is.
        </p>
      </div>

      <div className="relative pt-11">
        <img
          src={CAT.peeking}
          alt=""
          className="absolute top-0 left-16 z-[2] h-[60px] w-[104px]"
          aria-hidden
        />
        <section
          aria-label="Drop zone"
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void start([...e.dataTransfer.files]);
          }}
          className={`glass relative flex flex-col gap-8 rounded-[28px] p-10 transition ${
            dragging ? "outline-cx-orange/60" : ""
          }`}
          style={{ outline: `1.5px dashed ${dragging ? "rgba(255,122,47,.6)" : "rgba(255,255,255,.16)"}`, outlineOffset: -12 }}
        >
          <div className="grid grid-cols-3 gap-4">
            {DETECTOR_SLOTS.map((slot) => (
              <div
                key={slot.det}
                className="flex min-h-[150px] flex-col gap-3.5 rounded-[18px] border border-cx-line bg-black/25 p-5"
              >
                <div className="flex items-center justify-between">
                  <span className="mono text-[13px] font-semibold text-cx-text">
                    {slot.det === "ETD" ? "ETD / SE" : slot.det}
                  </span>
                  <span className="h-[22px] w-[22px] rounded-full border-[1.5px] border-dashed border-white/25" />
                </div>
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
                <div className="mono text-xs text-cx-faint">
                  img_&lt;id&gt;_BSE.tif · _ETD.tif (or _SE) · _InLens.tif, any case, paired by ID
                </div>
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
              <button className="btn pri" type="button" onClick={() => picker.current?.click()}>
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

      {phase === "error" && (
        <ErrorPanel
          title="Attribution failed"
          message={error ?? "Something went wrong."}
          command={error?.includes("attribute") || error?.includes("model")
            ? "uv run python -m qc.attribute --fit"
            : undefined}
        />
      )}

      <div className="grid grid-cols-3 gap-4">
        <Panel className="col-span-2 overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-cx-line px-5 py-4">
            <h2 className="m-0 text-[15px] font-medium">Recent identifications</h2>
          </div>
          {recent.data?.length ? (
            <table className="w-full min-w-[520px] border-collapse text-sm">
              <thead>
                <tr className="lbl text-left">
                  <th className="px-5 py-3 font-normal">Drop</th>
                  <th className="px-2 py-3 font-normal">Closest batch per tile</th>
                  <th className="px-5 py-3 text-right font-normal">Tiles</th>
                </tr>
              </thead>
              <tbody>
                {recent.data.map(({ name, attribution: a, times }) => {
                  return (
                    <tr
                      key={name}
                      className="cursor-pointer border-t border-cx-line-soft hover:bg-white/[0.03]"
                      onClick={() => {
                        setRunName(name);
                        setAttribution(a);
                        setTiles(a.images.map((i) => ({ id: i.image_id, detectors: ["BSE"] })));
                        setPhase("done");
                      }}
                    >
                      <td className="mono px-5 py-3.5 text-cx-text">
                        {name}
                        {times > 1 && <span className="pl-2 font-sans text-xs text-cx-faint">uploaded {times}×</span>}
                      </td>
                      <td className="px-2 py-3.5">
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
                      </td>
                      <td className="px-5 py-3.5 text-right text-cx-faint">{a.images.length}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
          <p className="m-0 mt-auto text-[13px] leading-normal text-cx-muted">
            Every tile gets a batch. Each answer says how sure it is and how often answers that sure were right.
          </p>
        </Panel>
      </div>
    </div>
  );
}

/** The model in config/attribution_model.json: what it got right on strips it never saw. */
function ModelGauge({ model }: { model: ModelStatus }) {
  const acc = model.loso_balanced_accuracy;
  const chance = model.classes.length ? 1 / model.classes.length : null;
  const cal = model.calibration;
  const total = Object.values(model.n_trained_on).reduce((a, b) => a + b, 0);
  return (
    <div className="flex flex-col gap-4">
      {acc != null && (
        <>
          <div className="flex items-baseline gap-2.5">
            <span className="text-[40px] font-semibold tracking-[-0.03em]">{Math.round(acc * 100)}%</span>
            <span className="text-[13px] text-cx-muted">balanced accuracy on held-out strips, all {model.classes.length} batches</span>
          </div>
          <div className="relative h-2 rounded bg-white/[0.07]">
            <div className="absolute inset-y-0 left-0 rounded bg-cx-text" style={{ width: `${acc * 100}%` }} />
            {chance != null && (
              <div className="absolute -top-1 -bottom-1 w-0.5 bg-cx-orange" style={{ left: `${chance * 100}%` }} />
            )}
          </div>
        </>
      )}
      <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 text-[13px]">
        {cal?.stages.baseline && (
          <>
            <dt className="text-cx-muted">{batchLabel(model.baseline)} or not</dt>
            <dd className="mono m-0 text-right">{record(cal.stages.baseline)}</dd>
          </>
        )}
        {cal?.stages.variation && (
          <>
            <dt className="text-cx-muted">Which other batch</dt>
            <dd className="mono m-0 text-right">{record(cal.stages.variation)}</dd>
          </>
        )}
        {cal?.tiers.map((t) => (
          <div key={t.tier} className="contents">
            <dt className="text-cx-muted">Calls marked {t.tier}</dt>
            <dd className="mono m-0 text-right">{record(t)}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-col gap-1 text-xs text-cx-faint">
        <span>
          Chance <span className="text-cx-orange-text">{chance != null ? `${Math.round(chance * 100)}%` : "—"}</span> ·{" "}
          {total} training tiles
        </span>
        <span>{modelName(model)}</span>
        <span>
          Fitted <span className="mono">{localTime(model.fitted_at)}</span> ·{" "}
          {model.matches_frozen ? "frozen" : model.matches_frozen === false ? "differs from the frozen model" : "not frozen"}
        </span>
      </div>
    </div>
  );
}

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
  { stage: "load", from: 0, to: 10, label: (n) => `Uploading ${n} tile${n === 1 ? "" : "s"}, detectors paired by ID` },
  { stage: "features", from: 10, to: 55, label: () => "Segmenting pore, graphite, silicon and binder; measuring" },
  { stage: "deep", from: 55, to: 90, label: () => "Image features (DINOv2)" },
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
  tiles: { id: string; detectors: string[] }[];
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
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-7 px-10 py-12">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="flex flex-col gap-2.5">
          <div className="lbl text-cx-orange-text">Identify · working</div>
          <h1 className="m-0 text-[40px] leading-[1.1] font-semibold tracking-[-0.03em]">
            Reading {tiles.length === 1 ? "tile" : `${tiles.length} tiles`}{" "}
            <span className="mono font-medium">
              {progress.stage === "features" || progress.stage === "deep" ? progress.tile?.split("/").pop() ?? first?.id : first?.id ?? name}
            </span>
          </h1>
          <p className="m-0 text-base text-cx-muted">Nothing leaves this machine.</p>
        </div>
        <button className="btn" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>

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
          <div className="flex items-center justify-between gap-4">
            <h2 className="m-0 text-[15px] font-medium">Pipeline</h2>
            {progress.stage !== "done" && <Spinner size={18} />}
          </div>
          <ol className="m-0 flex list-none flex-col p-0">
            {STAGES.map((st, i) => {
              const state = progress.stage === "done" || i < current ? "done" : i === current ? "running" : "pending";
              const count = st.stage === progress.stage && progress.total && st.stage !== "predict" && st.stage !== "load"
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
          <div className="flex flex-col gap-2.5">
            {tiles.map((tile) =>
              tile.detectors.map((d) => (
                <div key={`${tile.id}-${d}`} className="flex items-center gap-3">
                  {uploaded ? (
                    <img src={imageUrl(name, tile.id, d)} alt={d} className="h-10 w-24 rounded-lg border border-cx-line object-cover" />
                  ) : (
                    <span className="h-10 w-24 animate-pulse rounded-lg border border-cx-line bg-white/[0.04]" />
                  )}
                  <span className="mono flex-1 text-[13px]">{d}</span>
                  <span className={uploaded ? "text-xs text-cx-accept" : "text-xs text-cx-faint"}>{uploaded ? "Loaded" : "Uploading"}</span>
                </div>
              )),
            )}
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
