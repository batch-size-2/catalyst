import { useEffect, useRef, useState } from "react";
import {
  getAttributionEvaluation, getKpiDictionary, getModelStatus, getParticles, getTiles, imageUrl, measureFolder,
} from "../api";
import { batchColor, batchLabel, dictEntry, featureLabel, fmtSigma, localTime, modelName, prettyText, record, useApi } from "../lib";
import { href, replaceRoute } from "../router";
import type {
  Attribution, AttributedImage, AttributionEvaluation, AttributionModelInfo, AttributionReason, KpiDictionary, ModelStatus,
  StageImportance,
} from "../types";
import { Folds, IconWarn, kpisBeyond, PAGE, SigmaBand, TileKpiGrid } from "./bits";
import { Peekable, type PeekItem } from "./Peek";

export default function IdentifyResult({
  name,
  attribution,
  imageId,
}: {
  name: string;
  attribution: Attribution;
  imageId?: string;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [measured, setMeasured] = useState(0);
  const [measuring, setMeasuring] = useState<string | null>(null);
  const [broken, setBroken] = useState<string | null>(null);
  const dict = useApi(getKpiDictionary);
  const current = useApi(getModelStatus);
  const evaluation = useApi(getAttributionEvaluation);
  const tiles = useApi(getTiles, [measured], { keep: true });
  const image = attribution.images.find((i) => i.image_id === imageId) ?? attribution.images[0];
  const baseline = attribution.model.baseline;
  const tile = tiles.data?.find((t) => t.batch === name && t.image_id === image?.image_id);
  const particles = useApi(() => (image ? getParticles(name, image.image_id, 6) : Promise.resolve(null)), [name, image?.image_id, measured], { keep: true });
  const tried = useRef(new Set<string>());

  // Identify only scores the tile; measure it once in the background so the KPI grid and particle spots can show.
  useEffect(() => {
    if (!tiles.data || measuring || !tile || tile.kpis || tried.current.has(name)) return;
    tried.current.add(name);
    setMeasuring("measuring");
    measureFolder(name, (e) => {
      if (e.type === "done") setMeasured((n) => n + 1);
      if (e.type === "error") setMeasuring(e.message);
    })
      .then(() => setMeasuring((m) => (m === "measuring" ? null : m)))
      .catch((err) => setMeasuring(String(err instanceof Error ? err.message : err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiles.data, tile?.image_id]);

  if (!image) return null;
  const reasons = [...image.reasons].sort((a, b) => (b.contribution ?? 0) - (a.contribution ?? 0));
  const toward = reasons.filter((r) => (r.contribution ?? 0) > 0);
  const away = reasons.filter((r) => (r.contribution ?? 0) < 0).reverse();
  // up to three reasons for the call; the strongest one against only when it outweighs the weakest of those
  const fors = toward.slice(0, 3);
  const weakest = Math.abs(fors[fors.length - 1]?.contribution ?? 0);
  const against = away[0] && Math.abs(away[0].contribution ?? 0) >= weakest ? away[0] : null;
  const picks = against ? [...fors.slice(0, 2), against] : fors;
  const beyond = kpisBeyond(tile, tiles.data ?? [], baseline);
  const src = imageUrl(name, image.image_id, "BSE", 2048);
  const importance = attribution.model.importance;

  return (
    <div className={`${PAGE} gap-6`}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        {attribution.images.length > 1 && (
          <div className="flex flex-wrap gap-3" role="tablist" aria-label="Tiles in this drop">
            {attribution.images.map((img) => (
              <button
                key={img.image_id}
                type="button"
                role="tab"
                aria-selected={img === image}
                title={`${img.image_id} · ${batchLabel(img.predicted)}`}
                onClick={() => replaceRoute(href.identify(name, img.image_id))}
                className="relative block h-16 w-[72px] cursor-pointer overflow-hidden rounded-xl border-0 bg-black p-0"
                style={{ boxShadow: img === image ? `0 0 0 2px ${batchColor(img.predicted)}, 0 0 0 4px var(--cx-bg)` : "0 0 0 1px var(--cx-line)" }}
              >
                <img src={imageUrl(name, img.image_id, "BSE")} alt="" className="h-full w-full object-cover" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
                <span className="mono absolute inset-x-0 bottom-0 truncate bg-black/70 px-1 text-[11px] text-cx-text">{img.image_id}</span>
              </button>
            ))}
          </div>
        )}
        <div className="ml-auto flex flex-wrap gap-2.5">
          <a className="btn" href={href.library(name, image.image_id)}>Open in viewer</a>
          <a className="btn pri" href={href.identify()}>Identify another</a>
        </div>
      </div>

      {current.data && current.data.fitted_at !== attribution.model.fitted_at && (
        <div role="note" className="flex items-start gap-3 rounded-[14px] border border-cx-investigate/25 bg-cx-investigate/[0.05] px-4 py-3 text-sm">
          <span className="mt-0.5 text-cx-investigate"><IconWarn size={16} /></span>
          <span>
            <span className="font-medium">Made by an earlier model.</span>{" "}
            <span className="text-cx-text-2">Fitted {localTime(attribution.model.fitted_at)}; the app now uses the one fitted {localTime(current.data.fitted_at)}. Identify the tile again for a current call.</span>
          </span>
        </div>
      )}
      <Answer image={image} model={attribution.model} />
      {image.unfamiliar === true && (
        <div role="note" className="flex items-start gap-3 rounded-[14px] border border-cx-investigate/25 bg-cx-investigate/[0.05] px-4 py-3 text-sm">
          <span className="mt-0.5 text-cx-investigate"><IconWarn size={16} /></span>
          <span>
            <span className="font-medium">Unfamiliar tile.</span>{" "}
            <span className="text-cx-text-2">
              It sits outside the range of the {batchLabel(image.predicted)} tiles the model knows
              {distanceText(image.predicted_distance, image.predicted_threshold)}. {batchLabel(image.predicted)} is still the
              closest batch; treat the call with care.
            </span>
          </span>
        </div>
      )}

      <section aria-label="Look here first" className="flex flex-col gap-4">
        <h2 className="m-0 text-[22px] font-semibold tracking-[-0.02em]">Look here first</h2>
        <div
          className="relative overflow-hidden rounded-[22px] border border-white/10 bg-black"
          style={{ aspectRatio: particles.data ? `${particles.data.width} / ${particles.data.height}` : "3 / 1" }}
        >
          {broken === src ? (
            <span className="absolute inset-0 grid place-items-center text-[13px] text-cx-faint">This upload's images are no longer on disk.</span>
          ) : (
            <>
              <img src={src} alt={`BSE micrograph of tile ${image.image_id}`} className="absolute inset-0 h-full w-full object-cover brightness-[0.85]"
                onError={() => setBroken(src)} />
              <Spots name={name} imageId={image.image_id} data={particles.data} dict={dict.data} hasLayers={!!tile?.has_layers} detectors={tile?.detectors} />
              {!!particles.data?.particles.length && !!particles.data.px_um && (
                <span className="glass absolute right-3 bottom-3 rounded-[10px] px-2.5 py-1 text-[11px] text-cx-text-2" style={{ background: "rgba(14,15,18,.6)" }}>
                  Largest silicon particles · hover to look closer
                </span>
              )}
            </>
          )}
        </div>
        <div className="grid gap-3.5" style={{ gridTemplateColumns: `repeat(${Math.max(1, picks.length)}, minmax(0, 1fr))` }}>
          {picks.map((r, i) => (
            <ReasonCard key={r.feature} reason={r} n={i + 1} image={image} baseline={baseline} dict={dict.data} />
          ))}
        </div>
      </section>

      <Folds
        open={open}
        onToggle={(id) => setOpen((o) => ({ ...o, [id]: !o[id] }))}
        rows={[
          {
            id: "reasons",
            title: `All ${image.reasons.length} model reasons`,
            summary: `${toward.length} for · ${away.length} against`,
            body: () => (
              <div className="flex flex-col">
                <div className="lbl grid grid-cols-[minmax(0,1.3fr)_minmax(0,1.6fr)_150px] gap-5 border-b border-cx-line py-2">
                  <span>What the model looked at</span>
                  <span>What it found</span>
                  <span className="text-right">Weight</span>
                </div>
                {reasons.map((r) => (
                  <ReasonRow key={r.feature} reason={r} image={image} dict={dict.data}
                    max={Math.max(1e-9, ...reasons.map((x) => Math.abs(x.contribution ?? 0)))} />
                ))}
                {reasons.some((r) => r.related?.length) && (
                  <p className="m-0 pt-2.5 text-[13px] leading-normal text-cx-faint">r is how closely an image pattern moves with that measurement.</p>
                )}
              </div>
            ),
          },
          ...(importance && Object.keys(importance).length
            ? [{
                id: "importance",
                title: "What the model leans on overall",
                summary: leanSummary(importance),
                body: () => <Importance importance={importance} />,
              }]
            : []),
          {
            id: "kpis",
            title: "Measured on this tile",
            summary: beyond
              ? `${beyond.total} properties · ${beyond.beyond} beyond ±1σ of ${batchLabel(baseline)}`
              : measuring === "measuring" ? "measuring…" : measuring ? "couldn't measure" : "not measured",
            body: () =>
              measuring && measuring !== "measuring" && !tile?.kpis ? (
                <span className="text-[13px] text-cx-muted">Couldn't measure this tile: {measuring}</span>
              ) : measuring === "measuring" ? (
                <span className="text-[13px] text-cx-muted">Measuring the tile…</span>
              ) : (
                <TileKpiGrid tile={tile} tiles={tiles.data ?? []} baseline={baseline} dict={dict.data} />
              ),
          },
          {
            id: "model",
            title: "Model and run",
            summary: `fitted ${attribution.model.fitted_at.slice(0, 10)}`,
            body: () => <ModelAndRun image={image} attribution={attribution} current={current.data} evaluation={evaluation.data} />,
          },
        ]}
      />
    </div>
  );
}

/** Spots at the real centroids of the tile's largest silicon particles (out/particles.csv). */
function Spots({ name, imageId, data, dict, hasLayers, detectors }: {
  name: string; imageId: string; data: import("../types").TileParticles | null; dict: KpiDictionary | null; hasLayers: boolean; detectors?: string[];
}) {
  if (!data?.particles.length) return null;
  if (!data.px_um) return null;  // without the pixel size, spot sizes would be a guess
  const px = data.px_um;
  const items: PeekItem[] = data.particles.map((p, i) => {
    const kind = p.type ? dictEntry(`type_share:${p.type}`, dict).meaning : null;
    return {
      batch: name,
      imageId,
      title: `Silicon particle ${i + 1}`,
      note: `${p.d_um.toFixed(1)} µm across${p.type ? ` · type ${p.type}${kind ? ` (${prettyText(kind)})` : ""}` : ""}.`,
      region: { x: p.x, y: p.y, r: (p.d_um / px / 2) * 1.4 },
      hasLayers,
      detectors,
    };
  });
  return (
    <>
      {data.particles.map((p, i) => (
        <Peekable
          key={i}
          items={items}
          index={i}
          label={`${items[i].title}, ${items[i].note}`}
          className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/[0.06]"
          style={{
            left: `${(p.x / data.width) * 100}%`,
            top: `${(p.y / data.height) * 100}%`,
            width: `max(16px, ${((p.d_um / px) / data.width) * 140}%)`,
            aspectRatio: "1",
            border: "1.5px solid rgba(246,245,242,.85)",
            boxShadow: "0 0 0 2px rgba(10,11,13,.45)",
          }}
        />
      ))}
    </>
  );
}

const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);

/** "80–92%": a range of probabilities, rounded outwards so it never reads narrower than it is. */
const rangeText = ([low, high]: [number, number]) => `${Math.floor(low * 100)}–${Math.ceil(high * 100)}%`;

const setsText = (sets: NonNullable<NonNullable<AttributionModelInfo["calibration"]>["conformal"]>) =>
  `Prediction set aimed at ${Math.round((1 - sets.alpha) * 100)}%` +
  (sets.coverage != null && sets.mean_size != null
    ? ` · held the true batch for ${pct(sets.coverage)} of held-out tiles, ${sets.mean_size.toFixed(1)} batches on average`
    : "");

const distanceText = (d: number | null | undefined, limit: number | null | undefined) =>
  d != null && limit != null ? ` (distance ${d.toFixed(1)} against a limit of ${limit.toFixed(1)})` : "";

function Answer({ image, model }: { image: AttributedImage; model: AttributionModelInfo }) {
  const probs = model.classes.map((cls) => ({ cls, p: image[`p_${cls}`] ?? 0 }));
  const rec = image.unfamiliar ? null : image.confidence_record;
  const others = (image.prediction_set ?? []).filter((c) => c !== image.predicted);
  const sets = model.calibration?.conformal;
  const first = image.stage_baseline;
  return (
    <section aria-label="Answer" className="glass grid grid-cols-12 items-center gap-7 rounded-[24px] px-7 py-6">
      <div className="col-span-7 flex min-w-0 flex-col gap-3">
        <div className="lbl">
          Tile <span className="mono text-cx-text-2 normal-case">{image.image_id}</span> · closest match
        </div>
        <div className="flex flex-wrap items-center gap-3.5">
          <span className="h-4 w-4 rounded-[5px]" style={{ background: batchColor(image.predicted), boxShadow: `0 0 20px ${batchColor(image.predicted)}` }} />
          <span className="text-[48px] leading-none font-semibold tracking-[-0.04em]">{batchLabel(image.predicted)}</span>
          {image.confidence != null && <span className="mono text-2xl text-cx-text-2">{pct(image.confidence)}</span>}
        </div>
        <p className="m-0 text-base leading-normal text-cx-text-2">{heroSentence(image, probs, model.baseline)}</p>
      </div>
      <div className="col-span-5 flex min-w-0 flex-col gap-2.5">
        <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-[5px]">
          {probs.map(({ cls, p }) => (
            <span key={cls} style={{ width: `${Math.max(1, p * 100)}%`, background: batchColor(cls) }} />
          ))}
        </div>
        <div className="mono flex justify-between text-xs text-cx-text-2">
          {probs.map(({ cls, p }) => (
            <span key={cls}>
              {batchLabel(cls)} {pct(p)}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 pt-1.5">
          {rec && (
            <Chip tone={image.confidence_tier === "low" ? "warn" : "plain"}>
              When it's this sure, it was right {record(rec)} times
            </Chip>
          )}
          {first?.interval && (
            <Chip tone="plain" title="The range the held-out tiles allow for that probability (Venn–Abers)">
              {first.call === model.baseline ? "Baseline" : "Not the baseline"}: {rangeText(first.interval)}
            </Chip>
          )}
          {image.stage_variation?.record && !image.stage_variation.record.established && (
            <Chip tone="warn" title={image.stage_variation.note}>
              Which variation: not established
            </Chip>
          )}
          {others.length > 0 && (
            <Chip tone="plain" title={sets ? setsText(sets) : undefined}>
              Can't rule out {others.map(batchLabel).join(" or ")}
            </Chip>
          )}
          {image.unfamiliar === false && <Chip tone="good">Familiar tile</Chip>}
          {model.loso_balanced_accuracy != null && (
            <Chip tone="plain">
              Held-out balanced accuracy {pct(model.loso_balanced_accuracy)} · chance {pct(1 / model.classes.length)}
            </Chip>
          )}
        </div>
      </div>
    </section>
  );
}

const TONE = {
  good: "border-cx-accept/30 bg-cx-accept/10 text-cx-accept-text",
  warn: "border-cx-investigate/40 bg-cx-investigate/10 text-cx-investigate-text",
  plain: "border-white/[0.12] bg-white/5 text-cx-text-2",
};

function Chip({ tone, title, children }: { tone: keyof typeof TONE; title?: string; children: React.ReactNode }) {
  return (
    <span title={title} className={`inline-flex min-h-7 items-center rounded-full border px-2.5 text-xs ${TONE[tone]}`}>
      {children}
    </span>
  );
}

function heroSentence(image: AttributedImage, probs: { cls: string; p: number }[], baseline: string): string {
  const first = image.stage_baseline;
  const second = image.stage_variation;
  const lead = image.unfamiliar ? "Unfamiliar tile. " : "";
  if (first && first.call === baseline) return `${lead}Fits the baseline: ${pct(first.confidence)} that this tile is ${batchLabel(baseline)}.`;
  if (first && second) {
    const rest = probs.filter((p) => p.cls !== baseline && p.cls !== second.call);
    const among = rest.length === 1 ? `Between ${batchLabel(second.call)} and ${batchLabel(rest[0].cls)}` : "Among the other batches";
    if (second.record && !second.record.established) {
      const names = rest.length === 1 ? `${batchLabel(second.call)} or ${batchLabel(rest[0].cls)}` : "which other batch";
      return `${lead}Not the baseline: ${pct(first.confidence)} that it isn't ${batchLabel(baseline)}. ${names}: the model cannot tell these apart (right ${record(second.record)} times on held-out strips, about what guessing gets), so treat ${batchLabel(second.call)} as a coin flip, not a finding.`;
    }
    const weak = second.confidence < 0.6 || image.confidence_tier === "low" ? " — a weak lean" : "";
    return `${lead}Not the baseline: ${pct(first.confidence)} that it isn't ${batchLabel(baseline)}. ${among} it leans to ${batchLabel(second.call)}, ${Math.round(second.confidence * 100)} to ${Math.round((1 - second.confidence) * 100)}${weak}.`;
  }
  if (first && image.predicted === baseline)
    return `${lead}A weak call: ${batchLabel(baseline)} is the single most likely batch at ${pct(image.confidence)}, but the other batches together are ${pct(first.confidence)}.`;
  const runnerUp = probs.filter((p) => p.cls !== image.predicted).sort((a, b) => b.p - a.p)[0];
  return `${lead}Closest to ${batchLabel(image.predicted)}${runnerUp ? `, with ${batchLabel(runnerUp.cls)} next at ${pct(runnerUp.p)}` : ""}.`;
}

/** Which way a reason pulls: for or against the call of its own stage. */
const pull = (reason: AttributionReason) => {
  const toward = (reason.contribution ?? 0) >= 0;
  return { toward, tag: toward ? "For this call" : "Against this call" };
};

/** A reason's name as people read it: "DINOv2 image pattern 04" -> "Image pattern 04". */
function reasonName(reason: AttributionReason, dict: KpiDictionary | null): string {
  const text = prettyText(reason.label ?? featureLabel(reason.feature, dict)).replace(/^DINOv2 /, "");
  return text[0].toUpperCase() + text.slice(1);
}

/** Pat's sentence without its label prefix, first clause only: "5.6 SD above Batch 3". */
function finding(reason: AttributionReason, label: string): string {
  let text = reason.text ?? "";
  if (text.startsWith(label)) text = text.slice(label.length).replace(/^[:,]\s*/, "");
  text = prettyText(text.split("; ")[0]);
  return text ? text[0].toUpperCase() + text.slice(1) : "—";
}

function ReasonCard({ reason, n, image, baseline, dict }: { reason: AttributionReason; n: number; image: AttributedImage; baseline: string; dict: KpiDictionary | null }) {
  const p = pull(reason);
  const rawLabel = reason.label ?? featureLabel(reason.feature, dict);
  const z = reason.baseline_z;
  const off = z != null && Math.abs(z) > 3;
  const color = batchColor(image.predicted);
  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-[20px] border border-white/10 bg-[#15161A] p-[18px]">
      <div className="flex items-center gap-2.5">
        <span
          className="mono grid h-[26px] w-[26px] flex-none place-items-center rounded-lg text-[13px] font-semibold"
          style={p.toward ? { background: "var(--cx-text-strong)", color: "var(--cx-bg)" } : { color: "var(--cx-text-strong)", boxShadow: "inset 0 0 0 1.5px var(--cx-muted)" }}
        >
          {n}
        </span>
        <span
          className="inline-flex min-h-6 items-center rounded-full border px-2.5 text-xs"
          style={p.toward ? { color: "var(--cx-text)", borderColor: `color-mix(in srgb, ${color} 40%, transparent)`, background: `color-mix(in srgb, ${color} 12%, transparent)` } : { color: "var(--cx-text-2)", borderColor: "rgba(255,255,255,.16)", background: "rgba(255,255,255,.05)" }}
        >
          {p.tag}
        </span>
      </div>
      <h3 className="m-0 text-[17px] leading-[1.3] font-semibold tracking-[-0.01em]">{reasonName(reason, dict)}</h3>
      <p className="m-0 text-[13px] leading-normal text-cx-text-2">{finding(reason, rawLabel)}</p>
      {z != null && (
        <div className="mt-auto flex items-center gap-3 pt-1" title={`Against ${batchLabel(baseline)}: ±1σ and ±2σ shaded${off ? "; beyond ±3σ, off the scale" : ""}`}>
          {off && z < 0 && <span aria-hidden className="text-sm leading-none text-cx-investigate">«</span>}
          <div className="flex-1"><SigmaBand z={z} /></div>
          {off && z > 0 && <span aria-hidden className="text-sm leading-none text-cx-investigate">»</span>}
          <span className={`mono text-xs ${off ? "text-cx-investigate-text" : "text-cx-text-2"}`}>{fmtSigma(z)}</span>
        </div>
      )}
    </article>
  );
}

function ReasonRow({ reason, image, dict, max }: { reason: AttributionReason; image: AttributedImage; dict: KpiDictionary | null; max: number }) {
  const p = pull(reason);
  const c = reason.contribution ?? 0;
  const width = Math.min(50, (Math.abs(c) / max) * 50);
  const rawLabel = reason.label ?? featureLabel(reason.feature, dict);
  return (
    <div className="grid min-h-14 grid-cols-[minmax(0,1.3fr)_minmax(0,1.6fr)_150px] items-center gap-5 border-b border-cx-line-soft py-3">
      <span className="text-sm">{reasonName(reason, dict)}</span>
      <div className="flex min-w-0 flex-col gap-1.5 text-[13px] leading-snug text-cx-text-2">
        {reason.related?.length ? (
          <>
            <span className="text-cx-muted">An image pattern that moves with:</span>
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {reason.related.map((clause) => (
                <li key={clause.feature}>
                  {prettyText(clause.text)}
                  {clause.r != null && <span className="mono text-cx-faint"> · r {prettyText(clause.r.toFixed(2))}</span>}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <span>{finding(reason, rawLabel)}</span>
        )}
      </div>
      <div className="flex flex-col items-end gap-1.5">
        <div className="relative h-1.5 w-full rounded-[3px] bg-white/[0.06]">
          <div className="absolute -top-[3px] -bottom-[3px] left-1/2 w-px bg-white/25" />
          <div
            className="absolute inset-y-0 rounded-[3px]"
            style={p.toward ? { left: "50%", width: `${width}%`, background: batchColor(image.predicted) } : { right: "50%", width: `${width}%`, background: "#6B6D73" }}
          />
        </div>
        <span className="text-right text-xs text-cx-muted">{p.tag}</span>
      </div>
    </div>
  );
}

const FAMILY_NAMES: Record<string, string> = {
  reg: "Regions", edge: "Stitch edges", tex: "Texture", par: "Particles", kpi: "Whole-tile KPIs", img: "Imaging", deep: "DINOv2 image features",
};

/** The model behind this call, and the held-out evaluation when it covers this model. */
function ModelAndRun({ image, attribution, current, evaluation }: { image: AttributedImage; attribution: Attribution; current: ModelStatus | null; evaluation: AttributionEvaluation | null }) {
  const model = attribution.model;
  const stages = model.calibration?.stages;
  const stale = current != null && current.fitted_at !== model.fitted_at;
  const sets = evaluation ? Object.entries(evaluation.family_sets) : [];
  const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  const parts = model.staged ?? (model.families ? [model.families] : []);
  const missing = parts.filter((fams) => !sets.some(([, f]) => sameSet(f.families, fams)));
  const call = (s: string) => prettyText(s).replace(/^./, (c) => c.toUpperCase());
  const rows: [string, React.ReactNode][] = [
    ["Model", modelName(model)],
    ["Fitted", <span className="mono">{localTime(model.fitted_at)}</span>],
  ];
  if (current && !stale) rows.push(["Frozen with the rules", current.matches_frozen ? "Yes" : "No"]);
  if (image.stage_baseline)
    rows.push(["Baseline or not", `${call(image.stage_baseline.call)} · ${pct(image.stage_baseline.confidence)}${image.stage_baseline.interval ? ` (range ${rangeText(image.stage_baseline.interval)})` : ""}${stages?.baseline ? ` · this stage right ${record(stages.baseline)} held-out` : ""}`]);
  if (image.stage_variation)
    rows.push(["Which other batch", `${batchLabel(image.stage_variation.call)} · ${pct(image.stage_variation.confidence)}${stages?.variation ? ` · this stage right ${record(stages.variation)} held-out` : ""}${image.stage_variation.record && !image.stage_variation.record.established ? " · not established: a lean, not a finding" : ""}`]);
  const cal = model.calibration;
  if (cal?.method === "venn_abers")
    rows.push(["Confidence", `Checked on held-out tiles (Venn–Abers)${cal.log_loss != null && cal.raw_log_loss != null ? ` · log loss ${cal.log_loss.toFixed(2)}, ${cal.raw_log_loss.toFixed(2)} unchecked` : ""}`]);
  if (cal?.conformal?.coverage != null) rows.push(["Can't-rule-out sets", setsText(cal.conformal)]);
  if (image.baseline_distance != null)
    rows.push([`Distance from ${batchLabel(model.baseline)}`, `${image.baseline_distance.toFixed(1)} against a limit of ${image.baseline_threshold?.toFixed(1) ?? "?"}${image.outside_baseline ? " · outside the baseline range" : image.outside_baseline === false ? " · inside the baseline range" : ""}`]);
  if (image.predicted_distance != null && image.predicted !== model.baseline)
    rows.push([`Distance from ${batchLabel(image.predicted)}`, `${image.predicted_distance.toFixed(1)} against a limit of ${image.predicted_threshold?.toFixed(1) ?? "?"}`]);
  return (
    <div className="flex flex-col gap-5">
      <dl className="m-0 grid grid-cols-[200px_minmax(0,1fr)] gap-x-6 gap-y-2 text-[13px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-cx-faint">{k}</dt>
            <dd className="m-0 text-cx-text-2">{v}</dd>
          </div>
        ))}
      </dl>
      {sets.length > 0 && !missing.length && (
        <div className="flex flex-col gap-3 border-t border-cx-line-soft pt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <span className="text-sm font-medium">How well each family of features tells the batches apart</span>
            <span className="text-xs text-cx-faint">{evaluation!.n_images} tiles · held-out strips vs the shuffled-label threshold</span>
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            {sets.map(([key, fam]) => {
              const acc = fam.balanced_accuracy;
              const p95 = fam.null?.p95;
              const verdict = !fam.above_null || acc == null || p95 == null ? "within chance" : acc - p95 < 0.05 ? "at the edge of chance" : "above chance";
              return (
                <div key={key} className="flex flex-col gap-1.5 rounded-[14px] border border-cx-line-soft bg-black/20 p-3">
                  <span className="text-[13px]">{fam.families.map((f) => FAMILY_NAMES[f] ?? f).join(" + ")}</span>
                  <div className="relative h-1.5 rounded bg-white/[0.07]">
                    {acc != null && <div className="absolute inset-y-0 left-0 rounded bg-cx-text" style={{ width: `${acc * 100}%` }} />}
                    {p95 != null && <div className="absolute -top-[3px] -bottom-[3px] w-0.5 bg-cx-orange" style={{ left: `${Math.min(100, p95 * 100)}%` }} />}
                  </div>
                  <span className="mono text-[11px] text-cx-faint">
                    {pct(acc)} · random-guess threshold {pct(p95)} · <span className={verdict === "above chance" ? "text-cx-accept-text" : "text-cx-muted"}>{verdict}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const STAGE_TITLES = { all: "Which batch", baseline: "Baseline or not", variation: "Which other batch" } as const;
const STAGE_ORDER = ["all", "baseline", "variation"] as const;
type ModelImportance = NonNullable<AttributionModelInfo["importance"]>;

const stageList = (importance: ModelImportance) =>
  STAGE_ORDER.flatMap((role) => (importance[role] ? [[role, importance[role]] as [typeof role, StageImportance]] : []));

/** "Texture 61% · then DINOv2 image features": the leading family of each stage. */
function leanSummary(importance: ModelImportance): string {
  return stageList(importance)
    .map(([, st]) => {
      const [fam, share] = Object.entries(st.families)[0] ?? [];
      return fam ? `${FAMILY_NAMES[fam] ?? fam}${share < 0.995 ? ` ${pct(share)}` : ""}` : "";
    })
    .filter(Boolean)
    .join(" · then ");
}

/** What each stage weighs across all its training tiles: the families, then the heaviest single inputs. */
function Importance({ importance }: { importance: ModelImportance }) {
  const stages = stageList(importance);
  const name = (label: string) => prettyText(label).replace(/^DINOv2 /, "").replace(/^./, (c) => c.toUpperCase());
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-6" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}>
        {stages.map(([role, st]) => {
          const fams = Object.entries(st.families);
          const max = Math.max(1e-9, ...st.features.map((f) => f.share));
          return (
            <div key={role} className="flex min-w-0 flex-col gap-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium">{STAGE_TITLES[role]}</span>
                <span className="text-xs text-cx-faint">{st.n_features} inputs</span>
              </div>
              <div className="flex h-2 gap-0.5 overflow-hidden rounded">
                {fams.map(([fam, share], i) => (
                  <span key={fam} title={`${FAMILY_NAMES[fam] ?? fam} ${pct(share)}`}
                    style={{ width: `${Math.max(1, share * 100)}%`, background: `rgba(246,245,242,${Math.max(0.18, 0.9 - i * 0.18)})` }} />
                ))}
              </div>
              <span className="mono text-[11px] text-cx-faint">
                {fams.map(([fam, share]) => `${FAMILY_NAMES[fam] ?? fam} ${pct(share)}`).join(" · ")}
              </span>
              <ul className="m-0 flex list-none flex-col p-0">
                {st.features.slice(0, 5).map((f) => (
                  <li key={f.feature} className="flex flex-col gap-1.5 border-t border-cx-line-soft py-2.5">
                    <div className="flex items-baseline justify-between gap-3 text-[13px]">
                      <span className="min-w-0">{name(f.label)}</span>
                      <span className="mono flex-none text-xs text-cx-text-2">{(f.share * 100).toFixed(f.share < 0.1 ? 1 : 0)}%</span>
                    </div>
                    <div className="h-1 rounded bg-white/[0.06]">
                      <div className="h-full rounded bg-cx-text" style={{ width: `${(f.share / max) * 100}%` }} />
                    </div>
                    <span className="text-xs leading-snug text-cx-muted">
                      Higher points to {prettyText(f.higher_means)}
                      {f.related && (f.related.length
                        ? ` · moves with ${f.related.map((r) => `${prettyText(r.label)} (r ${prettyText(r.r.toFixed(2))})`).join(", ")}`
                        : " · no single named measurement tracks it")}
                    </span>
                    {!!f.imaging?.length && (
                      <span className="text-xs leading-snug text-cx-investigate-text">
                        Also tracks imaging, not material: {f.imaging.map((r) => `${prettyText(r.label).replace(/ imaging:/, "")} (r ${prettyText(r.r.toFixed(2))})`).join(", ")}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <p className="m-0 text-[13px] leading-normal text-cx-faint">
        A share is how much of that stage's total pull an input carries across the training tiles. The cards above say what moved this tile; this says what the model weighs in general. An image pattern that tracks imaging may partly reflect the microscope settings.
      </p>
    </div>
  );
}
