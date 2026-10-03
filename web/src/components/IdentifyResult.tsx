import { useState } from "react";
import { getKpiDictionary, getModelStatus, imageUrl } from "../api";
import { batchColor, batchLabel, featureLabel, modelName, record, shortHash, sigmaPos, useApi } from "../lib";
import { href } from "../router";
import type { Attribution, AttributedImage, AttributionReason, KpiDictionary, ModelStatus } from "../types";
import { Cat, Panel } from "./bits";

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
  const dict = useApi(getKpiDictionary);
  const current = useApi(getModelStatus);
  const image = attribution.images[Math.min(index, attribution.images.length - 1)];
  if (!image) return null;
  const detector = "BSE";

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-7 px-10 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="lbl text-cx-orange-text">Identify · result</div>
          <div className="flex items-center gap-3 text-sm text-cx-muted">
            <span className="mono text-[15px] text-cx-text">{image.image_id}</span>
            <span>from {name}</span>
            {attribution.images.length > 1 && (
              <span>· {attribution.images.length} tiles</span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <a className="btn" href={href.library(name, image.image_id)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            Open in viewer
          </a>
          <button className="btn pri" type="button" onClick={onReset}>
            Identify another
          </button>
        </div>
      </div>

      {attribution.images.length > 1 && (
        <div className="flex flex-wrap gap-3">
          {attribution.images.map((img, i) => (
            <button
              key={img.image_id}
              type="button"
              onClick={() => setIndex(i)}
              className="relative block h-16 w-16 cursor-pointer overflow-hidden rounded-xl border-0 bg-black p-0"
              style={{
                boxShadow:
                  i === index
                    ? `0 0 0 2px ${batchColor(img.predicted)}, 0 0 0 4px var(--cx-bg)`
                    : "0 0 0 1px var(--cx-line)",
              }}
            >
              <img
                src={imageUrl(name, img.image_id, detector)}
                alt={img.image_id}
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}

      <Hero name={name} image={image} attribution={attribution} detector={detector} />

      <div className="grid grid-cols-12 gap-4">
        <Panel className="col-span-8 flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-baseline justify-between gap-3 pb-2.5">
            <h2 className="m-0 text-lg font-medium tracking-[-0.01em]">Why {batchLabel(image.predicted)}</h2>
            <span className="flex items-center gap-1.5 text-xs text-cx-muted">
              <span className="h-3 w-0.5 bg-cx-text-strong" />
              This tile · −3σ to +3σ vs {batchLabel(attribution.model.baseline)}
            </span>
          </div>
          <div className="lbl grid grid-cols-[minmax(0,1.3fr)_minmax(0,1.6fr)_140px] gap-5 border-b border-cx-line py-2">
            <span>What the model looked at</span>
            <span>What it found</span>
            <span className="text-right">Pull</span>
          </div>
          {image.reasons.map((reason) => (
            <ReasonRow
              key={reason.feature}
              reason={reason}
              predicted={image.predicted}
              baseline={attribution.model.baseline}
              dict={dict.data}
              maxContribution={Math.max(
                1e-9,
                ...image.reasons.map((r) => Math.abs(r.contribution ?? 0)),
              )}
            />
          ))}
          <p className="m-0 pt-2.5 text-[13px] leading-normal text-cx-faint">
            These are the model's own top reasons (coefficient × standardised value), not a story
            added afterwards.
          </p>
        </Panel>

        <div className="col-span-4 flex min-w-0 flex-col gap-4">
          <CatCard image={image} baseline={attribution.model.baseline} />
          <ModelPanel image={image} attribution={attribution} current={current.data} />
        </div>
      </div>

      <section className="flex flex-col gap-3.5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="m-0 text-lg font-medium tracking-[-0.01em]">Measured against the baseline</h2>
          <span className="text-[13px] text-cx-faint">
            Dot = this tile · shaded = baseline ({batchLabel(attribution.model.baseline)}) ±1σ and ±2σ
          </span>
        </div>
        {image.deviations.length ? (
          <div className="grid grid-cols-4 gap-3">
            {image.deviations.map((dev) => (
              <div key={dev.feature} className="panel flex flex-col gap-3 rounded-[18px] p-[18px]">
                <span className="text-[13px] text-cx-muted">{dev.label ?? featureLabel(dev.feature, dict.data)}</span>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="mono text-[22px] tracking-[-0.02em]">
                    {dev.z != null ? `${dev.z > 0 ? "+" : ""}${dev.z.toFixed(1)}σ` : "—"}
                  </span>
                  <span className="mono text-xs text-cx-faint">{dev.direction}</span>
                </div>
                <div className="relative h-1 rounded-full bg-white/[0.06]">
                  <div className="absolute inset-y-0 rounded-full bg-cx-batch-3/15" style={{ left: `${sigmaPos(-2)}%`, width: `${sigmaPos(2) - sigmaPos(-2)}%` }} />
                  <div className="absolute inset-y-0 rounded-full bg-cx-batch-3/40" style={{ left: `${sigmaPos(-1)}%`, width: `${sigmaPos(1) - sigmaPos(-1)}%` }} />
                  {dev.z != null && (
                    <div
                      className="absolute -top-[3px] h-[10px] w-[10px] rounded-full"
                      style={{
                        left: `calc(${sigmaPos(dev.z)}% - 5px)`,
                        background: Math.abs(dev.z) > 2 ? "var(--cx-investigate)" : "var(--cx-text-strong)",
                        boxShadow: "0 0 0 3px #111215",
                      }}
                    />
                  )}
                </div>
                <span className="mono text-xs text-cx-faint">{dev.feature}</span>
              </div>
            ))}
          </div>
        ) : (
          <Panel className="flex items-center gap-3 text-sm text-cx-muted">
            <Cat mood="ready" size={30} />
            Every feature the model uses sits inside the baseline range — nothing deviates beyond ±2σ.
          </Panel>
        )}
      </section>
    </div>
  );
}

function Hero({
  name,
  image,
  attribution,
  detector,
}: {
  name: string;
  image: AttributedImage;
  attribution: Attribution;
  detector: string;
}) {
  const probs = attribution.model.classes
    .map((cls) => ({ cls, p: image[`p_${cls}`] ?? 0 }))
    .sort((a, b) => b.p - a.p);
  const distance = image.baseline_distance;
  const threshold = image.baseline_threshold;
  const baseline = attribution.model.baseline;
  const alpha = attribution.model.calibration?.conformal?.alpha;
  const own =
    image.predicted_distance != null && image.predicted_threshold != null
      ? ` (${image.predicted_distance.toFixed(1)} against a limit of ${image.predicted_threshold.toFixed(1)})`
      : "";

  return (
    <section aria-label="Verdict" className="flex flex-col">
      <div className="relative aspect-[1800/536] overflow-hidden rounded-[28px] border border-cx-line bg-black">
        <img
          src={imageUrl(name, image.image_id, detector, 2048)}
          alt={`${detector} micrograph of tile ${image.image_id}`}
          className="absolute inset-0 h-full w-full object-cover brightness-[0.7]"
        />
      </div>
      <div
        className="glass relative z-[1] mx-6 -mt-[150px] grid grid-cols-12 gap-8 rounded-[26px] px-8 py-7"
        style={{ background: "linear-gradient(180deg, rgba(30,31,36,.55), rgba(18,19,22,.72))" }}
      >
        <div className="col-span-7 flex min-w-0 flex-col gap-3.5">
          <div className="lbl">Our bet</div>
          <div className="flex flex-wrap items-center gap-4">
            <span
              className="h-[18px] w-[18px] rounded-md"
              style={{ background: batchColor(image.predicted), boxShadow: `0 0 24px ${batchColor(image.predicted)}` }}
            />
            <span className="text-[60px] leading-none font-semibold tracking-[-0.04em]">
              {batchLabel(image.predicted)}
            </span>
            {image.confidence != null && (
              <span className="mono text-[28px] text-cx-text-2">{Math.round(image.confidence * 100)}%</span>
            )}
          </div>
          <p className="m-0 max-w-[520px] text-base leading-normal text-cx-text-2">
            {heroSentence(image, probs, baseline)}
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            {image.confidence_tier && <TierPill image={image} />}
            {image.unfamiliar === true ? (
              <span className="inline-flex min-h-8 items-center gap-2 rounded-full border border-cx-investigate/40 bg-cx-investigate/10 px-3 text-[13px] text-cx-investigate-text">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 4l9 16H3l9-16z" />
                  <path d="M12 10v4M12 17h.01" />
                </svg>
                Unfamiliar: outside the range of the {batchLabel(image.predicted)} tiles we know{own}
              </span>
            ) : image.unfamiliar === false ? (
              <span className="inline-flex min-h-8 items-center gap-2 rounded-full border border-cx-line bg-white/5 px-3 text-[13px] text-cx-text-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M5 12l5 5 9-10" />
                </svg>
                Within the range of the {batchLabel(image.predicted)} tiles we know{own}
              </span>
            ) : null}
          </div>
        </div>
        <div className="col-span-5 flex min-w-0 flex-col justify-center gap-3.5">
          {probs.map(({ cls, p }) => (
            <div key={cls} className="grid grid-cols-[72px_minmax(0,1fr)_44px] items-center gap-3 text-sm">
              <span className={cls === image.predicted ? "" : "text-cx-text-2"}>{batchLabel(cls)}</span>
              <div className="h-2.5 rounded-[5px] bg-white/[0.07]">
                <div
                  className="h-full rounded-[5px]"
                  style={{ width: `${Math.max(1.5, p * 100)}%`, background: batchColor(cls) }}
                />
              </div>
              <span className="mono text-right text-cx-text-2">{Math.round(p * 100)}%</span>
            </div>
          ))}
          <div className="flex flex-col gap-2 border-t border-cx-line pt-3 text-[13px]">
            {image.stage_baseline && (
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-cx-muted">Different from the baseline?</span>
                <span>
                  {image.stage_baseline.call === baseline ? `No, fits ${batchLabel(baseline)}` : `Yes, not ${batchLabel(baseline)}`}{" "}
                  <span className="mono text-cx-text-2">{pct(image.stage_baseline.confidence)}</span>
                </span>
              </div>
            )}
            {image.stage_variation && (
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-cx-muted">In what way?</span>
                <span>
                  Leans to {batchLabel(image.stage_variation.call)}{" "}
                  <span className="mono text-cx-text-2">{pct(image.stage_variation.confidence)}</span>
                </span>
              </div>
            )}
            {image.prediction_set && image.prediction_set.length > 0 && (
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-cx-muted">
                  Could be{alpha != null ? ` (right about ${Math.round((1 - alpha) * 10)} times in 10)` : ""}
                </span>
                <span>{image.prediction_set.map(batchLabel).join(" or ")}</span>
              </div>
            )}
            <div className="flex items-center gap-2.5 text-cx-muted">
              <span>Distance from baseline</span>
              <div className="relative h-1.5 flex-1 rounded-[3px] bg-white/[0.07]">
                {distance != null && threshold ? (
                  <div
                    className="absolute inset-y-0 left-0 rounded-[3px] bg-white/55"
                    style={{ width: `${Math.min(100, (distance / threshold) * 100)}%` }}
                  />
                ) : null}
                <div className="absolute -top-[5px] -bottom-[5px] left-full w-0.5 bg-cx-investigate" />
              </div>
              <span className="mono text-cx-text">
                {distance != null ? `${distance.toFixed(1)} / ${threshold?.toFixed(1) ?? "?"}` : "—"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Folder names as people read them: "Batch_3" -> "Batch 3". */
const plain = (text: string) => text.replace(/Batch_(\w+)/g, "Batch $1");

const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);

const TIER_STYLE: Record<string, string> = {
  high: "border-cx-accept/30 bg-cx-accept/10 text-cx-accept-text",
  medium: "border-cx-line bg-white/5 text-cx-text-2",
  low: "border-cx-investigate/40 bg-cx-investigate/10 text-cx-investigate-text",
};

/** The confidence tier with its record: how often held-out calls this sure were right. */
function TierPill({ image }: { image: AttributedImage }) {
  const tier = image.confidence_tier ?? "low";
  const rec = image.confidence_record;
  return (
    <span className={`inline-flex min-h-8 items-center gap-2 rounded-full border px-3 text-[13px] ${TIER_STYLE[tier]}`}>
      <span className="font-medium capitalize">{tier} confidence</span>
      {rec && <span>· calls this sure were right {record(rec)} times on strips the model never saw</span>}
    </span>
  );
}

function heroSentence(image: AttributedImage, probs: { cls: string; p: number }[], baseline: string): string {
  const first = image.stage_baseline;
  const second = image.stage_variation;
  if (first && first.call === baseline) {
    return `Fits the baseline: ${pct(first.confidence)} that this tile is ${batchLabel(baseline)}.`;
  }
  if (first && second) {
    const weak = image.confidence_tier === "low" ? " That lean is weak; the first half is the reliable part." : "";
    return `Different from the baseline: ${pct(first.confidence)} that it is not ${batchLabel(baseline)}. Between the other batches it leans to ${batchLabel(second.call)} (${pct(second.confidence)}).${weak}`;
  }
  const runnerUp = probs[1];
  return runnerUp
    ? `Closest to ${batchLabel(image.predicted)}, with ${batchLabel(runnerUp.cls)} next at ${pct(runnerUp.p)}.`
    : `Closest to ${batchLabel(image.predicted)}.`;
}

const STAGE_LABEL = (stage: string | undefined, baseline: string) =>
  stage === "baseline" ? `${batchLabel(baseline)} or not` : stage === "variation" ? "Which other batch" : null;

function ReasonRow({
  reason,
  predicted,
  baseline,
  dict,
  maxContribution,
}: {
  reason: AttributionReason;
  predicted: string;
  baseline: string;
  dict: KpiDictionary | null;
  maxContribution: number;
}) {
  const c = reason.contribution ?? 0;
  const toward = c >= 0;
  const width = Math.min(50, (Math.abs(c) / maxContribution) * 50);
  const label = reason.label ?? featureLabel(reason.feature, dict);
  // the pull is toward the call of the reason's own stage
  const target =
    reason.stage === "baseline" ? (predicted === baseline ? batchLabel(baseline) : `not ${batchLabel(baseline)}`) : batchLabel(predicted);
  const stage = STAGE_LABEL(reason.stage, baseline);
  const z = reason.baseline_z;
  const sentence = reason.text?.startsWith(`${label}: `) ? reason.text.slice(label.length + 2) : reason.text;
  return (
    <div className="grid min-h-16 grid-cols-[minmax(0,1.3fr)_minmax(0,1.6fr)_140px] items-center gap-5 border-b border-cx-line-soft py-3">
      <div className="flex min-w-0 flex-col gap-[3px]">
        <span className="text-sm">{label}</span>
        <span className="mono text-[11px] break-all text-cx-faint">
          {stage ? `${stage} · ` : ""}
          {reason.feature}
        </span>
      </div>
      <div className="flex min-w-0 flex-col gap-2 text-[13px] leading-snug text-cx-text-2">
        {reason.related?.length ? (
          <>
            <span className="text-cx-muted">An image pattern that moves with:</span>
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {reason.related.map((clause) => (
                <li key={clause.feature}>{plain(clause.text)}</li>
              ))}
            </ul>
          </>
        ) : (
          <span className="first-letter:uppercase">{sentence ? plain(sentence) : "—"}</span>
        )}
        {z != null && (
          <div className="relative h-[14px]">
            <div className="absolute inset-y-0 left-1/2 w-px bg-white/[0.12]" />
            <div className="absolute inset-x-0 top-1/2 h-px bg-white/[0.06]" />
            <div
              className="absolute inset-y-0 w-0.5 bg-cx-text-strong"
              style={{ left: `calc(${sigmaPos(z)}% - 1px)`, boxShadow: "0 0 0 3px rgba(10,11,13,.9)" }}
            />
          </div>
        )}
        {reason.closest_batch && (
          <span className="text-xs text-cx-faint">Closest to the typical {batchLabel(reason.closest_batch)} tile</span>
        )}
      </div>
      <div className="flex flex-col items-end gap-1.5">
        <div className="relative h-1.5 w-full rounded-[3px] bg-white/[0.06]">
          <div className="absolute -top-[3px] -bottom-[3px] left-1/2 w-px bg-white/25" />
          <div
            className="absolute inset-y-0 rounded-[3px]"
            style={
              toward
                ? { left: "50%", width: `${width}%`, background: batchColor(predicted) }
                : { right: "50%", width: `${width}%`, background: "#6B6D73" }
            }
          />
        </div>
        <span className="text-right text-xs" style={{ color: toward ? "var(--cx-text-2)" : "var(--cx-muted)" }}>
          <span className="mono">{`${c > 0 ? "+" : "−"}${Math.abs(c).toFixed(2)}`}</span>{" "}
          {toward ? `Toward ${target}` : `Away from ${target}`}
        </span>
      </div>
    </div>
  );
}

function CatCard({ image, baseline }: { image: AttributedImage; baseline: string }) {
  const rec = image.confidence_record;
  const right = rec ? `Calls this sure were right ${record(rec)} times on strips the model never saw.` : "";
  const first = image.stage_baseline;
  const [mood, title, body] = image.unfamiliar
    ? ([
        "unsure",
        "Our bet, but an unfamiliar tile.",
        `This tile sits outside the range of the ${batchLabel(image.predicted)} tiles we know. ${batchLabel(image.predicted)} is still the nearest batch — treat the call with care.`,
      ] as const)
    : image.confidence_tier === "high"
      ? (["sure", "A strong call.", right] as const)
      : image.confidence_tier === "medium"
        ? (["sure", "A fair call, not a sure one.", right] as const)
        : ([
            "unsure",
            "A weak lean.",
            `Every tile gets a bet, and this is ours. ${right}${
              first ? ` The more reliable half is "${batchLabel(baseline)} or not": ${pct(first.confidence)}.` : ""
            }`,
          ] as const);
  return (
    <div className="glass flex items-start gap-3.5 rounded-[22px] p-[22px]">
      <Cat mood={mood} size={36} className="shrink-0" />
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-[13px] leading-normal text-cx-muted">{body}</span>
      </div>
    </div>
  );
}

/** Which model made this result, and whether it is the one the app would use now. */
function ModelPanel({
  image,
  attribution,
  current,
}: {
  image: AttributedImage;
  attribution: Attribution;
  current: ModelStatus | null;
}) {
  const model = attribution.model;
  const stages = model.calibration?.stages;
  const stale = current != null && current.fitted_at !== model.fitted_at;
  return (
    <Panel className="flex flex-col gap-3">
      <h3 className="m-0 text-[15px] font-medium">The model behind this call</h3>
      <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-[13px]">
        <dt className="text-cx-faint">Model</dt>
        <dd className="m-0 text-right">{modelName(model)}</dd>
        <dt className="text-cx-faint">Fitted</dt>
        <dd className="mono m-0 text-right">{model.fitted_at.replace("T", " ")}</dd>
        {current && !stale && (
          <>
            <dt className="text-cx-faint">Frozen</dt>
            <dd className="m-0 text-right">
              {current.matches_frozen ? (
                <>
                  Yes · <span className="mono">{shortHash(current.rules_frozen_commit, 7)}</span>
                </>
              ) : (
                "No"
              )}
            </dd>
          </>
        )}
        {stages?.baseline && (
          <>
            <dt className="text-cx-faint">{batchLabel(model.baseline)} or not</dt>
            <dd className="m-0 text-right">right {record(stages.baseline)} held-out</dd>
          </>
        )}
        {stages?.variation && (
          <>
            <dt className="text-cx-faint">Which other batch</dt>
            <dd className="m-0 text-right">right {record(stages.variation)} held-out</dd>
          </>
        )}
        <dt className="text-cx-faint">Deviating</dt>
        <dd className="mono m-0 text-right">{image.n_deviating ?? 0} features</dd>
        {image.strip_id && (
          <>
            <dt className="text-cx-faint">Strip</dt>
            <dd className="mono m-0 text-right">{image.strip_id}</dd>
          </>
        )}
      </dl>
      {stale && (
        <p className="m-0 rounded-xl border border-cx-investigate/40 bg-cx-investigate/10 px-3 py-2 text-[13px] leading-snug text-cx-investigate-text">
          This result was made by an earlier model. Identify the tile again to use the current one.
        </p>
      )}
    </Panel>
  );
}
