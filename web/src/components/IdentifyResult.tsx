import { useEffect, useState } from "react";
import { getAttributionEvaluation, getKpiDictionary, getModelStatus, getTiles, imageUrl, measureFolder } from "../api";
import { batchColor, batchLabel, featureLabel, modelName, prettyText, record, shortHash, sigmaPos, useApi } from "../lib";
import { href } from "../router";
import type {
  Attribution, AttributedImage, AttributionEvaluation, AttributionModelInfo, AttributionReason, KpiDictionary, ModelStatus,
} from "../types";
import { Folds, IconCheck, IconWarn, kpisBeyond, TileKpiGrid } from "./bits";

export default function IdentifyResult({
  name,
  attribution,
  onReset,
}: {
  name: string;
  attribution: Attribution;
  onReset: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [measured, setMeasured] = useState(0);
  const [measuring, setMeasuring] = useState<string | null>(null);
  const dict = useApi(getKpiDictionary);
  const current = useApi(getModelStatus);
  const evaluation = useApi(getAttributionEvaluation);
  const tiles = useApi(getTiles, [measured]);
  const image = attribution.images[Math.min(index, attribution.images.length - 1)];
  const baseline = attribution.model.baseline;
  const tile = tiles.data?.find((t) => t.batch === name && t.image_id === image?.image_id);

  // Identify only scores the tile; measure its KPIs in the background so the property grid can show them.
  useEffect(() => {
    if (!tiles.data || measuring || !tile || tile.kpis) return;
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
  const picks = [...toward.slice(0, away.length ? 2 : 3), ...away.slice(0, 1)];
  const beyond = kpisBeyond(tile, tiles.data ?? [], baseline);

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-6 px-10 pt-9 pb-16">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3 text-sm text-cx-muted">
          <span className="lbl text-cx-orange-text">Identify · result</span>
          <span>
            from <span className="mono">{name}</span>
            {attribution.images.length > 1 ? ` · ${attribution.images.length} tiles` : ""}
          </span>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <a className="btn" href={href.library(name, image.image_id)}>Open in viewer</a>
          <button className="btn pri" type="button" onClick={onReset}>Identify another</button>
        </div>
      </div>

      {attribution.images.length > 1 && (
        <div className="flex flex-wrap gap-3" role="tablist" aria-label="Tiles in this drop">
          {attribution.images.map((img, i) => (
            <button
              key={img.image_id}
              type="button"
              role="tab"
              aria-selected={i === index}
              title={`${img.image_id} · ${batchLabel(img.predicted)}`}
              onClick={() => setIndex(i)}
              className="relative block h-16 w-16 cursor-pointer overflow-hidden rounded-xl border-0 bg-black p-0"
              style={{ boxShadow: i === index ? `0 0 0 2px ${batchColor(img.predicted)}, 0 0 0 4px var(--cx-bg)` : "0 0 0 1px var(--cx-line)" }}
            >
              <img src={imageUrl(name, img.image_id, "BSE")} alt="" className="h-full w-full object-cover" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
              <span className="mono absolute inset-x-0 bottom-0 truncate bg-black/70 px-1 text-[9px] text-cx-text">{img.image_id}</span>
            </button>
          ))}
        </div>
      )}

      {current.data && current.data.fitted_at !== attribution.model.fitted_at && (
        <div role="note" className="flex items-start gap-3 rounded-[14px] border border-cx-investigate/25 bg-cx-investigate/[0.05] px-4 py-3 text-sm">
          <span className="mt-0.5 text-cx-investigate"><IconWarn size={16} /></span>
          <span>
            <span className="font-medium">Made by an earlier model.</span>{" "}
            <span className="text-cx-text-2">Fitted {attribution.model.fitted_at.replace("T", " ")}; the app now uses the one fitted {current.data.fitted_at.replace("T", " ")}. Identify the tile again for a current call.</span>
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
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-[22px] font-semibold tracking-[-0.02em]">Look here first</h2>
          <span className="text-[13px] text-cx-faint">
            The model's strongest reasons for this call{away.length ? ", plus the strongest one against it" : "; none points against it"}.
          </span>
        </div>
        <div className="relative overflow-hidden rounded-[22px] border border-white/10 bg-black" style={{ aspectRatio: "1800 / 536" }}>
          <span className="absolute inset-0 grid place-items-center text-[13px] text-cx-faint">The images of this drop are no longer in data/{name}.</span>
          <img src={imageUrl(name, image.image_id, "BSE", 2048)} alt={`BSE micrograph of tile ${image.image_id}`} className="absolute inset-0 h-full w-full object-cover brightness-[0.85]"
            onError={(e) => (e.currentTarget.style.display = "none")} />
          <span className="glass mono absolute bottom-3 left-3 rounded-[10px] px-2.5 py-1 text-[11px] text-cx-text-2" style={{ background: "rgba(14,15,18,.5)" }}>
            BSE · {image.image_id}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-3.5">
          {picks.map((r, i) => (
            <ReasonCard key={r.feature} reason={r} n={i + 1} image={image} baseline={baseline} dict={dict.data} />
          ))}
        </div>
        {image.unfamiliar === false && (
          <div className="flex items-center gap-2.5 text-[13px] text-cx-accept-text">
            <IconCheck size={14} />
            Familiar: within the range of the {batchLabel(image.predicted)} tiles the model knows.
          </div>
        )}
      </section>

      <Folds
        open={open}
        onToggle={(id) => setOpen((o) => ({ ...o, [id]: !o[id] }))}
        rows={[
          {
            id: "reasons",
            title: `All ${image.reasons.length} model reasons`,
            summary: `${toward.length} toward · ${away.length} away`,
            body: () => (
              <div className="flex flex-col">
                <div className="lbl grid grid-cols-[minmax(0,1.3fr)_minmax(0,1.6fr)_150px] gap-5 border-b border-cx-line py-2">
                  <span>What the model looked at</span>
                  <span>What it found</span>
                  <span className="text-right">Pull</span>
                </div>
                {reasons.map((r) => (
                  <ReasonRow key={r.feature} reason={r} image={image} baseline={baseline} dict={dict.data}
                    max={Math.max(1e-9, ...reasons.map((x) => Math.abs(x.contribution ?? 0)))} />
                ))}
                <p className="m-0 pt-2.5 text-[13px] leading-normal text-cx-faint">
                  Pull = how far this feature moves the call of its stage. "Image patterns" are components of DINOv2 image
                  features; they are described by the named measurements they move with (r = correlation).
                </p>
              </div>
            ),
          },
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
            summary: `${pct(attribution.model.loso_balanced_accuracy)} held-out · chance ${pct(1 / attribution.model.classes.length)} · fitted ${attribution.model.fitted_at.slice(0, 10)}`,
            body: () => <ModelAndRun image={image} attribution={attribution} current={current.data} evaluation={evaluation.data} />,
          },
        ]}
      />
    </div>
  );
}

const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);

const distanceText = (d: number | null | undefined, limit: number | null | undefined) =>
  d != null && limit != null ? ` (distance ${d.toFixed(1)} against a limit of ${limit.toFixed(1)})` : "";

function Answer({ image, model }: { image: AttributedImage; model: AttributionModelInfo }) {
  const probs = model.classes.map((cls) => ({ cls, p: image[`p_${cls}`] ?? 0 })).sort((a, b) => b.p - a.p);
  const rec = image.confidence_record;
  const others = (image.prediction_set ?? []).filter((c) => c !== image.predicted);
  const alpha = model.calibration?.conformal?.alpha;
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
            <Chip tone={image.confidence_tier === "high" ? "good" : image.confidence_tier === "low" ? "warn" : "plain"}>
              When it's this sure, it was right {record(rec)} times
            </Chip>
          )}
          {others.length > 0 && (
            <Chip tone="plain" title={alpha != null ? `Prediction set at ${Math.round((1 - alpha) * 100)}% coverage` : undefined}>
              Can't rule out {others.map(batchLabel).join(" or ")}
            </Chip>
          )}
          {image.unfamiliar === true ? (
            <Chip tone="warn">Unfamiliar tile</Chip>
          ) : image.unfamiliar === false ? (
            <Chip tone="good">Familiar tile</Chip>
          ) : null}
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
  if (first && first.call === baseline) return `Fits the baseline: ${pct(first.confidence)} that this tile is ${batchLabel(baseline)}.`;
  if (first && second) {
    const other = probs.map((p) => p.cls).find((c) => c !== baseline && c !== second.call);
    const weak = image.confidence_tier === "low" ? " That lean is weak; the first part is the reliable one." : "";
    return `Different from the baseline: ${pct(first.confidence)} that it is not ${batchLabel(baseline)}. Between ${batchLabel(second.call)}${other ? ` and ${batchLabel(other)}` : " and the rest"} it leans to ${batchLabel(second.call)}, ${Math.round(second.confidence * 100)} to ${Math.round((1 - second.confidence) * 100)}.${weak}`;
  }
  if (first && image.predicted === baseline)
    return `A weak call: ${batchLabel(baseline)} is the single most likely batch at ${pct(image.confidence)}, but the other batches together are ${pct(first.confidence)}.`;
  const runnerUp = probs[1];
  return runnerUp
    ? `Closest to ${batchLabel(image.predicted)}, with ${batchLabel(runnerUp.cls)} next at ${pct(runnerUp.p)}.`
    : `Closest to ${batchLabel(image.predicted)}.`;
}

/** Which way a reason pulls: for or against the call of its own stage. */
function pull(reason: AttributionReason, baseline: string) {
  const toward = (reason.contribution ?? 0) >= 0;
  const stage = reason.stage === "baseline" ? `Stage 1: ${batchLabel(baseline)} or not` : reason.stage === "variation" ? "Stage 2: which other batch" : null;
  return { toward, tag: toward ? "For this call" : "Against this call", stage };
}

/** Pat's sentence without its label prefix, first clause only: "5.6 SD above Batch 3". */
function finding(reason: AttributionReason, label: string): string {
  let text = reason.text ?? "";
  if (text.startsWith(label)) text = text.slice(label.length).replace(/^[:,]\s*/, "");
  text = prettyText(text.split("; ")[0]);
  return text ? text[0].toUpperCase() + text.slice(1) : "—";
}

function ReasonCard({ reason, n, image, baseline, dict }: { reason: AttributionReason; n: number; image: AttributedImage; baseline: string; dict: KpiDictionary | null }) {
  const p = pull(reason, baseline);
  const rawLabel = reason.label ?? featureLabel(reason.feature, dict);
  const label = prettyText(rawLabel);
  const c = reason.contribution ?? 0;
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
        <span className="mono ml-auto text-xs text-cx-muted" title="How far this feature moves the call of its stage">
          pull {c > 0 ? "+" : "−"}{Math.abs(c).toFixed(2)}
        </span>
      </div>
      <h3 className="m-0 text-[17px] leading-[1.3] font-semibold tracking-[-0.01em]">{label[0].toUpperCase() + label.slice(1)}</h3>
      <p className="m-0 text-[13px] leading-normal text-cx-text-2">{finding(reason, rawLabel)}</p>
      {reason.baseline_z != null && (
        <div className="flex flex-col gap-1">
          <div className="relative h-[14px]">
            <div className="absolute inset-y-[4px] rounded bg-cx-batch-3/30" style={{ left: `${sigmaPos(-1)}%`, width: `${sigmaPos(1) - sigmaPos(-1)}%` }} />
            <div className="absolute inset-y-0 left-1/2 w-px bg-white/[0.15]" />
            <div className="absolute inset-y-0 w-0.5 bg-cx-text-strong" style={{ left: `calc(${sigmaPos(reason.baseline_z)}% - 1px)`, boxShadow: "0 0 0 3px #15161A" }} />
          </div>
          <span className="mono flex justify-between text-[10px] text-cx-faint">
            <span>−3σ</span>
            <span className="text-[#5EEAD4]">{batchLabel(baseline)} ±1σ</span>
            <span>+3σ</span>
          </span>
        </div>
      )}
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-white/[0.07] pt-2.5">
        <span className="mono truncate text-[11px] text-cx-faint" title={reason.feature}>
          {p.stage ? `${p.stage} · ` : ""}{reason.feature}
        </span>
      </div>
    </article>
  );
}

function ReasonRow({ reason, image, baseline, dict, max }: { reason: AttributionReason; image: AttributedImage; baseline: string; dict: KpiDictionary | null; max: number }) {
  const p = pull(reason, baseline);
  const c = reason.contribution ?? 0;
  const width = Math.min(50, (Math.abs(c) / max) * 50);
  const rawLabel = reason.label ?? featureLabel(reason.feature, dict);
  return (
    <div className="grid min-h-16 grid-cols-[minmax(0,1.3fr)_minmax(0,1.6fr)_150px] items-center gap-5 border-b border-cx-line-soft py-3">
      <div className="flex min-w-0 flex-col gap-[3px]">
        <span className="text-sm first-letter:uppercase">{prettyText(rawLabel)}</span>
        <span className="mono text-[11px] break-all text-cx-faint">
          {p.stage ? `${p.stage} · ` : ""}{reason.feature}
        </span>
      </div>
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
        <span className="text-right text-xs text-cx-muted">
          <span className="mono">{`${c > 0 ? "+" : "−"}${Math.abs(c).toFixed(2)}`}</span> {p.toward ? "for" : "against"} the call
        </span>
      </div>
    </div>
  );
}

const FAMILY_NAMES: Record<string, string> = {
  reg: "regions", edge: "stitch edges", tex: "texture", par: "particles", kpi: "whole-tile KPIs", img: "imaging", deep: "DINOv2 image features",
};

/** The model behind this call, and the held-out evaluation, flagged when it doesn't cover this model. */
function ModelAndRun({ image, attribution, current, evaluation }: { image: AttributedImage; attribution: Attribution; current: ModelStatus | null; evaluation: AttributionEvaluation | null }) {
  const model = attribution.model;
  const stages = model.calibration?.stages;
  const stale = current != null && current.fitted_at !== model.fitted_at;
  const sets = evaluation ? Object.entries(evaluation.family_sets) : [];
  const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  const parts = model.staged ?? (model.families ? [model.families] : []);
  const missing = parts.filter((fams) => !sets.some(([, f]) => sameSet(f.families, fams)));
  const rows: [string, React.ReactNode][] = [
    ["Model", modelName(model)],
    ["Fitted", <span className="mono">{model.fitted_at.replace("T", " ")}</span>],
    ["Held-out accuracy", `${pct(model.loso_balanced_accuracy)} balanced accuracy on strips the model never saw · chance ${pct(1 / model.classes.length)}`],
  ];
  if (current && !stale)
    rows.push(["Frozen", current.matches_frozen ? <>Yes · <span className="mono">{shortHash(current.rules_frozen_commit, 7)}</span></> : "No"]);
  if (image.stage_baseline)
    rows.push([`${batchLabel(model.baseline)} or not`, `${prettyText(image.stage_baseline.call)} · ${pct(image.stage_baseline.confidence)}${stages?.baseline ? ` · this stage right ${record(stages.baseline)} held-out` : ""}`]);
  if (image.stage_variation)
    rows.push(["Which other batch", `${batchLabel(image.stage_variation.call)} · ${pct(image.stage_variation.confidence)}${stages?.variation ? ` · this stage right ${record(stages.variation)} held-out` : ""}`]);
  if (image.baseline_distance != null)
    rows.push([`Distance from ${batchLabel(model.baseline)}`, `${image.baseline_distance.toFixed(1)} against a limit of ${image.baseline_threshold?.toFixed(1) ?? "?"}${image.outside_baseline ? " · outside the baseline range" : image.outside_baseline === false ? " · inside the baseline range" : ""}`]);
  if (image.predicted_distance != null && image.predicted !== model.baseline)
    rows.push([`Distance from ${batchLabel(image.predicted)}`, `${image.predicted_distance.toFixed(1)} against a limit of ${image.predicted_threshold?.toFixed(1) ?? "?"}`]);
  if (image.strip_id) rows.push(["Strip", <span className="mono">{image.strip_id}</span>]);
  return (
    <div className="flex flex-col gap-5">
      {stale && (
        <p className="m-0 rounded-xl border border-cx-investigate/40 bg-cx-investigate/10 px-3 py-2 text-[13px] leading-snug text-cx-investigate-text">
          This result was made by an earlier model. Identify the tile again to use the current one.
        </p>
      )}
      <dl className="m-0 grid grid-cols-[200px_minmax(0,1fr)] gap-x-6 gap-y-2 text-[13px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-cx-faint">{k}</dt>
            <dd className="m-0 text-cx-text-2">{v}</dd>
          </div>
        ))}
      </dl>
      {sets.length > 0 && (
        <div className="flex flex-col gap-3 border-t border-cx-line-soft pt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <span className="text-sm font-medium">How well each family of features tells the batches apart</span>
            <span className="text-xs text-cx-faint">{evaluation!.n_images} tiles · held-out strips vs the shuffled-label threshold</span>
          </div>
          {missing.length > 0 && (
            <p className="m-0 rounded-xl border border-cx-investigate/30 bg-cx-investigate/[0.06] px-3 py-2 text-[13px] leading-snug text-cx-investigate-text">
              This evaluation predates the model above: no row scores {missing.map((f) => f.map((x) => FAMILY_NAMES[x] ?? x).join(" + ")).join(" or ")} on
              {missing.length === 1 && missing[0].length === 1 ? " its own" : " their own"}, the part of the model that makes this call, so read these rows as background, not as this model's record.
            </p>
          )}
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
