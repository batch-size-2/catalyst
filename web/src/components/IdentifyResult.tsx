import { useState } from "react";
import { getKpiDictionary, imageUrl } from "../api";
import { batchColor, batchLabel, featureLabel, sigmaPos, useApi } from "../lib";
import { href } from "../router";
import type { Attribution, AttributedImage } from "../types";
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
              This tile · −3σ to +3σ vs the baseline
            </span>
          </div>
          <div className="lbl grid grid-cols-[minmax(0,1.3fr)_minmax(0,1.6fr)_140px] gap-5 border-b border-cx-line py-2">
            <span>Feature the model used</span>
            <span>Score vs baseline (σ)</span>
            <span className="text-right">Pull</span>
          </div>
          {image.reasons.map((reason) => (
            <ReasonRow
              key={reason.feature}
              reason={reason}
              predicted={image.predicted}
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
          <CatCard image={image} classes={attribution.model.classes} />
          <Panel className="flex flex-col gap-3">
            <h3 className="m-0 text-[15px] font-medium">The counts</h3>
            <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-[13px]">
              <dt className="text-cx-faint">Fitted</dt>
              <dd className="mono m-0 text-right">{attribution.model.fitted_at.slice(0, 10)}</dd>
              <dt className="text-cx-faint">Deviating</dt>
              <dd className="mono m-0 text-right">{image.n_deviating ?? 0} features</dd>
              {image.strip_id && (
                <>
                  <dt className="text-cx-faint">Strip</dt>
                  <dd className="mono m-0 text-right">{image.strip_id}</dd>
                </>
              )}
            </dl>
          </Panel>
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
                <span className="text-[13px] text-cx-muted">{featureLabel(dev.feature, dict.data)}</span>
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
            Every measured feature sits inside the baseline range — nothing deviates beyond ±2σ.
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
  const accuracy = attribution.model.loso_balanced_accuracy;
  const chance = attribution.model.classes.length ? 1 / attribution.model.classes.length : null;
  const distance = image.baseline_distance;
  const threshold = image.baseline_threshold;

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
          <div className="lbl">Closest match</div>
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
            {heroSentence(image, probs)}
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            {image.unfamiliar === true ? (
              <span className="inline-flex min-h-8 items-center gap-2 rounded-full border border-cx-investigate/40 bg-cx-investigate/10 px-3 text-[13px] text-cx-investigate-text">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 4l9 16H3l9-16z" />
                  <path d="M12 10v4M12 17h.01" />
                </svg>
                Unfamiliar: outside the range of known tiles
              </span>
            ) : (
              <span className="inline-flex min-h-8 items-center gap-2 rounded-full border border-cx-accept/30 bg-cx-accept/10 px-3 text-[13px] text-cx-accept-text">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M5 12l5 5 9-10" />
                </svg>
                Familiar: within the range of known tiles
              </span>
            )}
            {accuracy != null && chance != null && (
              <span className="inline-flex min-h-8 items-center gap-2 rounded-full border border-cx-line bg-white/5 px-3 text-[13px] text-cx-text-2">
                Model is right {Math.round(accuracy * 100)}% of the time · chance {Math.round(chance * 100)}%
              </span>
            )}
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
          <div className="flex items-center gap-2.5 border-t border-cx-line pt-2.5 text-[13px] text-cx-muted">
            <span>Distance from baseline</span>
            <div className="relative h-1.5 flex-1 rounded-[3px] bg-white/[0.07]">
              {distance != null && threshold ? (
                <>
                  <div
                    className="absolute inset-y-0 left-0 rounded-[3px] bg-white/55"
                    style={{ width: `${Math.min(100, (distance / threshold) * 100)}%` }}
                  />
                  <div className="absolute -top-[5px] -bottom-[5px] left-full w-0.5 bg-cx-investigate" />
                </>
              ) : (
                <div className="absolute -top-[5px] -bottom-[5px] left-full w-0.5 bg-cx-investigate" />
              )}
            </div>
            <span className="mono text-cx-text">
              {distance != null ? `${distance.toFixed(1)} / ${threshold?.toFixed(1) ?? "?"}` : "—"}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

function heroSentence(image: AttributedImage, probs: { cls: string; p: number }[]): string {
  const second = probs[1];
  if (image.unfamiliar) {
    return `Closest to ${batchLabel(image.predicted)}, but the tile sits outside what the model knows — treat the call with care.`;
  }
  if (second && image.confidence != null && image.confidence - second.p > 0.3) {
    return `Clearly closer to ${batchLabel(image.predicted)} than to the others. ${batchLabel(second.cls)} is a distant second at ${Math.round(second.p * 100)}%.`;
  }
  if (second) {
    return `Closest to ${batchLabel(image.predicted)}, with ${batchLabel(second.cls)} not far behind at ${Math.round(second.p * 100)}%.`;
  }
  return `Closest to ${batchLabel(image.predicted)}.`;
}

function ReasonRow({
  reason,
  predicted,
  dict,
  maxContribution,
}: {
  reason: { feature: string; z: number | null; contribution: number | null };
  predicted: string;
  dict: import("../types").KpiDictionary | null;
  maxContribution: number;
}) {
  const z = reason.z ?? 0;
  const c = reason.contribution ?? 0;
  const toward = c >= 0;
  const width = Math.min(50, (Math.abs(c) / maxContribution) * 50);
  return (
    <div className="grid min-h-16 grid-cols-[minmax(0,1.3fr)_minmax(0,1.6fr)_140px] items-center gap-5 border-b border-cx-line-soft">
      <div className="flex min-w-0 flex-col gap-[3px]">
        <span className="text-sm">{featureLabel(reason.feature, dict)}</span>
        <span className="mono text-[11px] text-cx-faint">
          {reason.feature} · {reason.z != null ? `${z > 0 ? "+" : ""}${z.toFixed(1)}σ` : "—"}
        </span>
      </div>
      <div className="relative h-[38px]">
        <div className="absolute inset-y-0 left-1/2 w-px bg-white/[0.12]" />
        <div className="absolute inset-y-0 left-[16.7%] w-px bg-white/[0.05]" />
        <div className="absolute inset-y-0 left-[33.3%] w-px bg-white/[0.05]" />
        <div className="absolute inset-y-0 left-[66.7%] w-px bg-white/[0.05]" />
        <div className="absolute inset-y-0 left-[83.3%] w-px bg-white/[0.05]" />
        {reason.z != null && (
          <div
            className="absolute inset-y-0 w-0.5 bg-cx-text-strong"
            style={{ left: `calc(${sigmaPos(z)}% - 1px)`, boxShadow: "0 0 0 3px rgba(10,11,13,.9)" }}
          />
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
        <span className="text-xs" style={{ color: toward ? "var(--cx-text-2)" : "var(--cx-muted)" }}>
          <span className="mono">{`${c > 0 ? "+" : "−"}${Math.abs(c).toFixed(2)}`}</span>{" "}
          {toward ? `Toward ${batchLabel(predicted)}` : `Away from ${batchLabel(predicted)}`}
        </span>
      </div>
    </div>
  );
}

function CatCard({ image, classes }: { image: AttributedImage; classes: string[] }) {
  const sure = (image.confidence ?? 0) >= 0.5 && !image.unfamiliar;
  const [mood, title, body] = image.unfamiliar
    ? ([
        "unsure",
        "Looks like none of them.",
        "This tile is outside the range the model was fitted on. The batch call is a guess, not a match — compare it as a batch instead.",
      ] as const)
    : sure
      ? ([
          "sure",
          "Fairly sure, not certain.",
          `At ${Math.round((image.confidence ?? 0) * 100)}% this is one of the model's stronger calls. Below 50% we'd say so up front and suggest imaging another field.`,
        ] as const)
      : ([
          "unsure",
          "Not sure enough.",
          `Below half a chance across ${classes.length} batches, this is a hint rather than a call. Image another field, or compare the whole batch.`,
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
