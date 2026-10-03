import { useRef, useState } from "react";
import {
  getAttribution, getAttributionEvaluation, imageUrl, listAttributions, runAttribution, uploadBatch,
} from "../api";
import { batchLabel, useApi } from "../lib";
import { href } from "../router";
import type { Attribution } from "../types";
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
  const [dragging, setDragging] = useState(false);
  const [reload, setReload] = useState(0);
  const picker = useRef<HTMLInputElement>(null);
  const evaluation = useApi(getAttributionEvaluation, []);
  const recent = useApi(async () => {
    const names = await listAttributions();
    const results = await Promise.allSettled(names.map((n) => getAttribution(n)));
    return names
      .map((name, i) => ({ name, result: results[i] }))
      .filter((r): r is { name: string; result: PromiseFulfilledResult<Attribution> } => r.result.status === "fulfilled")
      .map(({ name, result }) => ({ name, attribution: result.value }))
      .slice(-6)
      .reverse();
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
    try {
      await uploadBatch(name, tifs);
      setUploaded(true);
      await runAttribution(name, null, (event) => {
        if (event.type === "done") {
          setAttribution(event.attribution);
          setPhase("done");
        }
        if (event.type === "error") {
          setError(event.message);
          setPhase("error");
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
    setReload((r) => r + 1);
  }

  function reset() {
    setPhase("idle");
    setRunName(null);
    setAttribution(null);
    setError(null);
    setTiles([]);
  }

  if (phase === "working" && runName)
    return <Working name={runName} tiles={tiles} uploaded={uploaded} onCancel={reset} />;
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
                  img_&lt;id&gt;_BSE.tif · _ETD.tif · _InLens.tif, paired by ID
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
            <a href={href.audit()} className="text-[13px]">
              View all
            </a>
          </div>
          {recent.data?.length ? (
            <table className="w-full min-w-[520px] border-collapse text-sm">
              <thead>
                <tr className="lbl text-left">
                  <th className="px-5 py-3 font-normal">Drop</th>
                  <th className="px-2 py-3 font-normal">Closest batch</th>
                  <th className="px-2 py-3 font-normal">Confidence</th>
                  <th className="px-2 py-3 font-normal">Fits baseline?</th>
                  <th className="px-5 py-3 text-right font-normal">Tiles</th>
                </tr>
              </thead>
              <tbody>
                {recent.data.map(({ name, attribution: a }) => {
                  const first = a.images[0];
                  const unfamiliar = a.images.filter((i) => i.unfamiliar).length;
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
                      <td className="mono px-5 py-3.5 text-cx-text">{name}</td>
                      <td className="px-2 py-3.5">
                        {first && (
                          <span className="inline-flex items-center gap-2">
                            <BatchDot name={first.predicted} size={8} />
                            {batchLabel(first.predicted)}
                          </span>
                        )}
                      </td>
                      <td className="mono px-2 py-3.5">
                        {first?.confidence != null ? `${Math.round(first.confidence * 100)}%` : "—"}
                      </td>
                      <td className="px-2 py-3.5">
                        {unfamiliar ? (
                          <span className="inline-flex items-center gap-1.5 text-cx-investigate">
                            <IconWarn />
                            Unfamiliar
                          </span>
                        ) : (
                          <span className="text-cx-muted">Yes</span>
                        )}
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
          {evaluation.data ? (
            <EvaluationGauge evaluation={evaluation.data} />
          ) : (
            <p className="m-0 text-[13px] leading-normal text-cx-muted">
              No evaluation yet — run <code className="mono text-cx-text-2">uv run python -m qc.attribute --evaluate</code>.
            </p>
          )}
          <p className="m-0 mt-auto text-[13px] leading-normal text-cx-muted">
            Every answer shows its probabilities and says when a tile looks like none of the batches.
          </p>
        </Panel>
      </div>
    </div>
  );
}

function EvaluationGauge({ evaluation }: { evaluation: import("../types").AttributionEvaluation }) {
  const sets = Object.entries(evaluation.family_sets);
  const [name, fam] = sets.find(([n]) => n === "material") ?? sets[0] ?? [];
  const acc = fam?.balanced_accuracy;
  const classes = Array.isArray(evaluation.batches) ? evaluation.batches.length : evaluation.batches;
  const chance = classes ? 1 / classes : null;
  if (!fam || acc == null)
    return <p className="m-0 text-[13px] text-cx-muted">No family set evaluated yet.</p>;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline gap-2.5">
        <span className="text-[40px] font-semibold tracking-[-0.03em]">{Math.round(acc * 100)}%</span>
        <span className="text-[13px] text-cx-muted">right on held-out strips</span>
      </div>
      <div className="relative h-2 rounded bg-white/[0.07]">
        <div className="absolute inset-y-0 left-0 rounded bg-cx-text" style={{ width: `${acc * 100}%` }} />
        {chance != null && (
          <div
            className="absolute -top-1 -bottom-1 w-0.5 bg-cx-orange"
            style={{ left: `${chance * 100}%` }}
          />
        )}
      </div>
      <div className="flex justify-between text-xs text-cx-faint">
        <span>
          Chance <span className="text-cx-orange-text">{chance != null ? `${Math.round(chance * 100)}%` : "—"}</span>
        </span>
        <span>
          {evaluation.n_images} training tiles · {name} features
        </span>
      </div>
    </div>
  );
}

function Working({
  name,
  tiles,
  uploaded,
  onCancel,
}: {
  name: string;
  tiles: { id: string; detectors: string[] }[];
  uploaded: boolean;
  onCancel: () => void;
}) {
  const first = tiles[0];
  const det = first?.detectors.includes("BSE") ? "BSE" : first?.detectors[0] ?? "BSE";
  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-7 px-10 py-12">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="flex flex-col gap-2.5">
          <div className="lbl text-cx-orange-text">Identify · working</div>
          <h1 className="m-0 text-[40px] leading-[1.1] font-semibold tracking-[-0.03em]">
            Reading {tiles.length === 1 ? "tile" : `${tiles.length} tiles`}{" "}
            <span className="mono font-medium">{first?.id ?? name}</span>
          </h1>
          <p className="m-0 text-base text-cx-muted">Nothing leaves this machine.</p>
        </div>
        <button className="btn" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>

      {first && (
        <section className="relative aspect-[1800/536] overflow-hidden rounded-3xl border border-cx-line bg-black">
          {uploaded && (
            <img
              src={imageUrl(name, first.id, det, 2048)}
              alt={`${det} image of tile ${first.id}`}
              className="absolute inset-0 h-full w-full object-cover brightness-[0.8]"
            />
          )}
          <div
            className="scan absolute inset-y-0 left-[64%] w-0.5 bg-cx-orange"
            style={{ boxShadow: "0 0 18px 4px rgba(255,122,47,.55)" }}
          />
        </section>
      )}

      <div className="grid grid-cols-3 gap-4">
        <Panel className="glass col-span-2 flex flex-col gap-4 border-0">
          <div className="flex items-center justify-between gap-4">
            <h2 className="m-0 text-[15px] font-medium">Pipeline</h2>
            <Spinner size={18} />
          </div>
          <ol className="m-0 flex list-none flex-col p-0">
            {[
              { label: `Paired detectors by ID across ${tiles.length} tile${tiles.length > 1 ? "s" : ""}`, state: "done" },
              { label: "Segmenting pore, graphite, silicon and binder", state: "done" },
              { label: "Scoring against the known batches", state: "running" },
              { label: `Writing out/attribution/${name}.json`, state: "pending" },
            ].map((step) => (
              <li key={step.label} className="flex min-h-11 items-center gap-3.5 border-b border-cx-line-soft last:border-0">
                {step.state === "done" && (
                  <span className="grid h-[22px] w-[22px] place-items-center rounded-full bg-cx-accept/15 text-cx-accept">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M5 12l5 5 9-10" />
                    </svg>
                  </span>
                )}
                {step.state === "running" && <Spinner size={22} />}
                {step.state === "pending" && (
                  <span className="box-border h-[22px] w-[22px] rounded-full border-[1.5px] border-white/20" />
                )}
                <span className={`flex-1 ${step.state === "pending" ? "text-cx-faint" : ""}`}>{step.label}</span>
                {step.state === "running" && <span className="mono text-xs text-cx-orange-text">running</span>}
              </li>
            ))}
          </ol>
        </Panel>
        <Panel className="flex flex-col gap-4">
          <h2 className="m-0 text-[15px] font-medium">Detectors</h2>
          <div className="flex flex-col gap-2.5">
            {tiles.map((tile) =>
              tile.detectors.map((d) => (
                <div key={`${tile.id}-${d}`} className="flex items-center gap-3">
                  {uploaded ? (
                    <img
                      src={imageUrl(name, tile.id, d)}
                      alt={d}
                      className="h-10 w-24 rounded-lg border border-cx-line object-cover"
                    />
                  ) : (
                    <span className="h-10 w-24 animate-pulse rounded-lg border border-cx-line bg-white/[0.04]" />
                  )}
                  <span className="mono flex-1 text-[13px]">{d}</span>
                  <span className={uploaded ? "text-xs text-cx-accept" : "text-xs text-cx-faint"}>
                    {uploaded ? "Loaded" : "Uploading"}
                  </span>
                </div>
              )),
            )}
          </div>
          <div className="mt-auto flex items-center gap-3 border-t border-cx-line pt-4">
            <Cat mood="sniffing" size={34} />
            <span className="text-[13px] leading-snug text-cx-muted">
              Whiskers twitching. Sniffing out silicon…
            </span>
          </div>
        </Panel>
      </div>
    </div>
  );
}
