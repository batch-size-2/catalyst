import { useState, type ReactNode } from "react";
import { imageUrl } from "../api";
import { rankedWhatIf, summaryWhatIf } from "../compare/pageBlocks";
import {
  baselineBand, batchColor, batchLabel, dictEntry, dropTwinShare, fmt, fmtPair, fmtRange, fmtSigma, imagingWords,
  joinAnd, oddByTile, plural, quantityLabel, rankedFindings, shortHash, sigmaOf, statusChip,
} from "../lib";
import { href } from "../router";
import type { Config, Difference, Evidence, Guide, KpiDictionary, Tile } from "../types";
import {
  BatchDot, Folds, IconCheck, Seg, ShiftBand, VerdictPill,
} from "./bits";
import { Peekable, type PeekItem } from "./Peek";

export interface Ctx {
  evidence: Evidence;
  config: Config;
  dict: KpiDictionary | null;
  tiles: Tile[];
}

const COUNT = ["none", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const countWord = (n: number) => COUNT[n] ?? String(n);

/** Same −4σ…+4σ axis as ShiftBand's default span, so a strip under the bar lines up with it. */
const SIGMA_SPAN = 4;
const sigmaX = (z: number) => ((Math.max(-SIGMA_SPAN, Math.min(SIGMA_SPAN, z)) + SIGMA_SPAN) / (2 * SIGMA_SPAN)) * 100;

const COLS = "grid-cols-[minmax(0,1.15fr)_minmax(0,1.7fr)_minmax(4.75rem,7.5rem)_1rem]";
const KPI_ORDER = [
  "si_graphite_ratio", "si_area_frac", "si_d50_um", "si_d90_um", "si_internal_void_frac",
  "si_contrast_ratio", "si_fragments_per_1e4um2", "si_dispersion_cv", "si_agglomerate_frac",
  "si_corr_length_um", "porosity_apparent", "graphite_chord_um", "graphite_anisotropy",
  "pore_chord_um", "pore_connectivity",
];
const JITTER = [8, 22, 14, 30, 4, 18, 26, 10, 34, 2, 20, 28, 12, 6, 24, 16, 32];

function leaveOutLine(evidence: Evidence, guide: Guide | null): string | null {
  const what = summaryWhatIf(guide);
  if (!what) return null;
  const pair = guide?.slots[`diff:${what.slot.quantity}`]?.text.split(" → ");
  if (!pair || pair.length < 2) return null;
  const n = evidence.n_images["batch"];
  return `${what.slot.text} without them · baseline ${pair[0]} · all ${n} tiles ${pair[1]}`;
}

interface ReasonCard { key: string; title: string; text: string }

function reasonCards(ctx: Ctx): ReasonCard[] {
  const { evidence, dict } = ctx;
  if (evidence.verdict === "ACCEPT") return [];
  const cards: ReasonCard[] = [];
  if (evidence.verdict === "REJECT") {
    const different = evidence.differences.filter((d) => d.used && d.status === "DIFFERENT" && d.note !== "imaging changed");
    if (different.length)
      cards.push({
        key: "differs",
        title: "Differs beyond the tolerance",
        text: `${joinAnd(different.map((d) => quantityLabel(d.name, dict)))}.`,
      });
  }
  if (evidence.imaging.changed) {
    const paused = evidence.differences.filter((d) => d.note === "imaging changed").map((d) => quantityLabel(d.name, dict));
    const words = imagingWords(evidence.imaging.changed_metrics);
    const held = paused.length ? `${joinAnd(paused)} ${paused.length === 1 ? "is" : "are"} paused` : "brightness-based properties are paused";
    cards.push({
      key: "imaging",
      title: "Imaging differs from the baseline",
      text: words ? `${words}, so ${held}.` : held + ".",
    });
  }
  const odd = oddByTile(evidence);
  if (odd.size) {
    const quantities = [...new Set([...odd.values()].flatMap((rows) => rows.map((o) => quantityLabel(o.quantity, dict))))];
    const n = evidence.n_images["batch"];
    cards.push({
      key: "odd",
      title: `${odd.size} of ${n} ${odd.size === 1 ? "tile is" : "tiles are"} outside the baseline range`,
      text: `${joinAnd([...odd.keys()])}, on ${joinAnd(quantities)}.`,
    });
  }
  if (!evidence.controls.ran)
    cards.push({
      key: "controls",
      title: "Controls haven't run",
      text: "Catalyst only says Accept after its known-answer controls pass.",
    });
  else if (evidence.controls.passed === false)
    cards.push({
      key: "controls",
      title: "Controls failed",
      text: "The method isn't validated on this data.",
    });
  return cards.slice(0, 3);
}

export function VerdictBlock({
  ctx, guide, onWalk, touring,
}: {
  ctx: Ctx;
  guide: Guide | null;
  onWalk: () => void;
  touring: boolean;
}) {
  const { evidence, tiles } = ctx;
  const oddId = [...oddByTile(evidence).keys()][0];
  const imageId = oddId ?? tiles.find((t) => t.batch === evidence.batch)?.image_id;
  const line = leaveOutLine(evidence, guide);
  const reasons = reasonCards(ctx);
  const why = evidence.verdict === "REJECT" ? "Why it's Reject" : "Why it isn't Accept";
  const badge = evidence.verdict === "REJECT"
    ? { bg: "rgba(248,113,113,.12)", fg: "var(--cx-reject)" }
    : { bg: "rgba(250,204,21,.12)", fg: "var(--cx-investigate)" };
  return (
    <section aria-label="Answer" className="relative overflow-hidden rounded-[28px] border border-white/10">
      {imageId && (
        <img src={imageUrl(evidence.batch, imageId, "BSE")} alt="" className="absolute inset-0 h-full w-full object-cover grayscale" style={{ opacity: 0.32 }} />
      )}
      <div className="absolute inset-0" style={{ background: "linear-gradient(90deg, rgba(10,11,13,.92) 0%, rgba(10,11,13,.72) 55%, rgba(10,11,13,.5) 100%)" }} />
      <div className="glass relative m-5 flex flex-col gap-5 rounded-[22px] px-7 py-6" style={{ background: "rgba(14,15,18,.5)" }}>
        <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
          <VerdictPill verdict={evidence.verdict} />
          <div className="flex min-w-0 flex-[1_1_520px] flex-col gap-2">
            <p className="m-0 text-2xl leading-snug font-medium tracking-[-0.02em] text-cx-text-strong">{evidence.explanations.summary}</p>
            {line && <p className="mono m-0 text-[13px] text-cx-muted">{line}</p>}
          </div>
          <button className="btn shrink-0" type="button" data-walkthrough-start disabled={!guide?.steps.length || touring} onClick={onWalk}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M7 5l12 7-12 7V5z" />
            </svg>
            Walk me through it
          </button>
        </div>
        {reasons.length > 0 && (
          <div className="flex flex-col gap-2.5">
            <div className="lbl">{why}</div>
            <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))" }}>
              {reasons.map((card, i) => (
                <div key={card.key} className="flex gap-3 rounded-2xl border border-white/8 px-4 py-3.5" style={{ background: "rgba(10,11,13,.55)" }}>
                  <span className="mono grid h-7 w-7 shrink-0 place-items-center rounded-[9px] text-[13px] font-semibold" style={{ background: badge.bg, color: badge.fg }}>{i + 1}</span>
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="text-sm font-medium text-cx-text-strong">{card.title}</span>
                    <span className="text-[13px] leading-snug text-cx-muted">{card.text}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function movedRows(ctx: Ctx): { rows: Difference[]; quiet: boolean } {
  const ranked = rankedFindings(ctx.evidence).slice(0, 4);
  if (ranked.length) return { rows: ranked, quiet: false };
  const rows = ctx.evidence.differences
    .filter((d) => d.key && d.name !== ctx.evidence.explanations.twin)
    .sort((a, b) => Math.abs(sigmaOf(b, b.difference, ctx.config) ?? 0) - Math.abs(sigmaOf(a, a.difference, ctx.config) ?? 0))
    .slice(0, 4);
  return { rows, quiet: true };
}

function TileStrip({ ctx, kpi }: { ctx: Ctx; kpi: string }) {
  const { evidence, tiles, dict } = ctx;
  const band = baselineBand(tiles, evidence.baseline, kpi);
  if (!band || !(band.sd > 0)) return null;
  const unit = dictEntry(kpi, dict).unit;
  const label = quantityLabel(kpi, dict);
  const z = (v: number) => (v - band.mean) / band.sd;
  const oddOn = new Set([...oddByTile(evidence)].flatMap(([id, odds]) => odds.some((o) => o.quantity === kpi) ? [id] : []));
  const side = (batch: string) => tiles.filter((t) => t.batch === batch && t.kpis?.[kpi] != null);
  const base = side(evidence.baseline);
  const batch = side(evidence.batch);
  const item = (t: Tile): PeekItem => ({
    batch: t.batch,
    imageId: t.image_id,
    title: `Tile ${t.image_id}`,
    note: `${label} ${fmt(t.kpis?.[kpi], unit)}${oddOn.has(t.image_id) ? ", outside the baseline range" : ""}.`,
    detectors: t.detectors,
    hasLayers: t.has_layers,
  });
  const baseItems = base.map(item);
  const batchItems = batch.map(item);
  const bandBox = (k: number) => ({ left: `${sigmaX(-k)}%`, width: `${sigmaX(k) - sigmaX(-k)}%` });
  return (
    <div className="relative h-11">
      <div className="absolute top-1/2 h-2.5 -translate-y-1/2 rounded-[3px] bg-cx-batch-3/[0.07]" style={bandBox(3)} />
      <div className="absolute top-1/2 h-2.5 -translate-y-1/2 rounded-[3px] bg-cx-batch-3/[0.16]" style={bandBox(2)} />
      <div className="absolute top-1/2 h-2.5 -translate-y-1/2 rounded-[3px] bg-cx-batch-3/[0.38]" style={bandBox(1)} />
      <div className="absolute inset-y-0 w-px bg-cx-batch-3/70" style={{ left: "50%" }} />
      {base.map((t, i) => (
        <Peekable
          key={`b-${t.image_id}`}
          items={baseItems}
          index={i}
          label={`Baseline tile ${t.image_id}: peek, click to pin`}
          className="absolute h-[5px] w-[5px] rounded-full bg-cx-batch-3"
          style={{ left: `calc(${sigmaX(z(t.kpis![kpi]!))}% - 2.5px)`, top: JITTER[i % JITTER.length] % 28 }}
        />
      ))}
      {batch.map((t, i) => {
        const odd = oddOn.has(t.image_id);
        const size = odd ? 12 : 8;
        return (
          <Peekable
            key={t.image_id}
            items={batchItems}
            index={i}
            label={`Tile ${t.image_id}: peek, click to pin`}
            className="absolute rounded-full"
            style={{
              left: `calc(${sigmaX(z(t.kpis![kpi]!))}% - ${size / 2}px)`,
              top: JITTER[(i + 3) % JITTER.length] % 24,
              width: size,
              height: size,
              background: batchColor(evidence.batch),
              boxShadow: odd ? "0 0 0 2px #111215, 0 0 0 4px var(--cx-investigate)" : "none",
            }}
          />
        );
      })}
    </div>
  );
}

export function MovedBlock({ ctx, onSeeAll }: { ctx: Ctx; onSeeAll: () => void }) {
  const { evidence, config, dict } = ctx;
  const { rows, quiet } = movedRows(ctx);
  const [open, setOpen] = useState<string | null>(rows[0]?.name ?? null);
  const all = dropTwinShare(evidence.differences, evidence);
  const shown = new Set(rows.map((d) => d.name));
  const rest = all.filter((d) => !shown.has(d.name));
  const paused = (d: Difference) => d.note === "imaging changed";
  const count = (f: (d: Difference) => boolean) => rest.filter(f).length;
  const same = count((d) => !paused(d) && d.status === "SIMILAR");
  const unsettled = count((d) => !paused(d) && d.status === "UNCLEAR");
  const differs = count((d) => !paused(d) && d.status === "DIFFERENT");
  const held = count(paused);
  const unclearShown = rows.length > 0 && rows.every((d) => d.status === "UNCLEAR" && d.note !== "imaging changed");
  const subtitle = quiet
    ? "The key properties with the largest shift."
    : unclearShown
      ? `The ${rows.length === 1 ? "property" : `${rows.length} properties`} that moved most. None is settled: each range still crosses the tolerance edge, so more tiles would decide it.`
      : `The ${rows.length === 1 ? "property" : `${rows.length} properties`} that moved most.`;
  return (
    <section aria-label={quiet ? "Nothing moved beyond the tolerance" : "What moved"} className="overflow-hidden rounded-[22px] border border-white/8 bg-cx-surface">
      <div className="flex flex-wrap items-end justify-between gap-3 px-6 pt-5 pb-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="m-0 text-xl font-semibold tracking-[-0.02em]">{quiet ? "Nothing moved beyond the tolerance" : "What moved"}</h2>
          {rows.length > 0 && <span className="text-[13px] text-cx-muted">{subtitle}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-cx-muted">
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-cx-text-strong" />{batchLabel(evidence.batch)} average</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-1 w-5 rounded-sm" style={{ background: batchColor(evidence.batch) }} />likely range (90%)</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-5 rounded-[3px] border-x border-dashed border-cx-batch-3/60 bg-cx-batch-3/20" />
            baseline ±{config.similar_margin}σ tolerance
          </span>
        </div>
      </div>
      {rows.length > 0 && (
        <div className={`grid ${COLS} gap-x-5 px-6 pb-2`}>
          <span className="lbl text-[10px]">Property</span>
          <span className="mono flex justify-between text-[10px] text-cx-faint"><span>−4σ</span><span className="text-[#5EEAD4]">baseline</span><span>+4σ</span></span>
          <span className="lbl text-right text-[10px]">Status</span>
          <span />
        </div>
      )}
      {rows.map((d) => {
        const isOpen = open === d.name;
        const unit = d.unit || dictEntry(d.name, dict).unit;
        const entry = dictEntry(d.name, dict);
        const chip = statusChip(d.status, d.note === "imaging changed");
        const odds = [...oddByTile(evidence).entries()].flatMap(([tile, list]) => list.filter((o) => o.quantity === d.name).map((o) => ({ tile, o })));
        return (
          <div key={d.name} className="border-t border-white/[0.06]">
            <div className={`grid ${COLS} gap-x-5 px-6`}>
              <div
                role="button"
                tabIndex={0}
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : d.name)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setOpen(isOpen ? null : d.name);
                  }
                }}
                className="col-span-4 grid min-h-[68px] cursor-pointer grid-cols-subgrid items-center py-2.5 text-left text-cx-text hover:bg-white/[0.03]"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[15px] font-medium">{quantityLabel(d.name, dict)}</span>
                  <span className="mono text-xs text-cx-muted">{fmtPair(d.reference, d.batch, unit)}</span>
                </span>
                <ShiftBand
                  s={sigmaOf(d, d.difference, config)}
                  lo={sigmaOf(d, d.interval?.[0], config)}
                  hi={sigmaOf(d, d.interval?.[1], config)}
                  margin={config.similar_margin}
                  color={batchColor(evidence.batch)}
                  height={28}
                />
                <span className="flex flex-col items-end gap-1">
                  <span className={`inline-flex min-h-[22px] items-center rounded-full px-2 text-xs whitespace-nowrap ${chip.className}`}>{chip.label}</span>
                  <span className="mono text-xs text-cx-text-2">{fmtSigma(sigmaOf(d, d.difference, config))}</span>
                </span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-cx-muted" style={{ transform: isOpen ? "rotate(180deg)" : "none" }}>
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </div>
              {isOpen && (
                <>
                  <div className="flex flex-col gap-2 pb-5 text-[13px] leading-normal text-cx-text-2">
                    {entry.why_it_matters && <span>{entry.why_it_matters}</span>}
                    {entry.supplier_check && (
                      <span className="text-cx-muted"><span className="text-cx-text">At the supplier:</span> {entry.supplier_check}</span>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-col gap-2 pb-5">
                    <TileStrip ctx={ctx} kpi={d.name} />
                    <span className="text-xs text-cx-faint">{odds.length ? "Carried by these tiles" : "No single tile sits outside the baseline range here."}</span>
                    {odds.length > 0 && (
                      <div className="flex gap-2">
                        {odds.slice(0, 3).map(({ tile, o }, i) => (
                          <Peekable
                            key={tile}
                            items={odds.map(({ tile: id, o: x }) => ({
                              batch: evidence.batch,
                              imageId: id,
                              title: `Tile ${id}`,
                              note: `${quantityLabel(d.name, dict)} ${fmt(x.value, unit)}, outside the baseline range ${fmtRange(x.range[0], x.range[1], unit)}.`,
                              hasLayers: ctx.tiles.find((tt) => tt.batch === evidence.batch && tt.image_id === id)?.has_layers,
                            }))}
                            index={i}
                            label={`Tile ${tile}: peek, click to pin`}
                            className="relative block max-w-[200px] flex-1 overflow-hidden rounded-xl bg-black"
                            style={{ aspectRatio: "16 / 9", boxShadow: "0 0 0 1.5px rgba(250,204,21,.7)" }}
                          >
                            <img src={imageUrl(evidence.batch, tile, "BSE")} alt="" loading="lazy" className="block h-full w-full object-cover" />
                            <span className="mono absolute right-1.5 bottom-1.5 left-1.5 flex justify-between rounded-md px-1.5 py-0.5 text-[10px] text-cx-text" style={{ background: "rgba(10,11,13,.78)" }}>
                              <span>{tile}</span>
                              <span className="text-cx-investigate-text">{fmt(o.value, unit)}</span>
                            </span>
                          </Peekable>
                        ))}
                      </div>
                    )}
                  </div>
                  <span />
                  <span />
                </>
              )}
            </div>
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/[0.06] px-6 py-4 text-[13px] text-cx-muted">
        {rest.length > 0 && <span className="text-cx-text">{rest.length} more {rest.length === 1 ? "property" : "properties"}</span>}
        {same > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <span className="text-cx-accept-text"><IconCheck size={14} /></span>
            {same} same as the baseline
          </span>
        )}
        {unsettled > 0 && <span>{unsettled} not settled{quiet ? "" : ", smaller moves"}</span>}
        {differs > 0 && <span>{differs} differ</span>}
        {held > 0 && <span>{held} paused until imaging matches</span>}
        <button type="button" onClick={onSeeAll} className="ml-auto cursor-pointer border-0 bg-transparent p-0 text-cx-orange-text">
          See all {all.length}
        </button>
      </div>
    </section>
  );
}

function parseNum(text: string): number {
  const n = parseFloat(text.replace(/[^\d.eE+-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function TilesBlock({ ctx, guide, onSeeAll }: { ctx: Ctx; guide: Guide | null; onSeeAll: () => void }) {
  const { evidence, dict } = ctx;
  const grouped = [...oddByTile(evidence).entries()];
  const shown = grouped.slice(0, 4);
  const more = grouped.length - shown.length;
  const quantities = [...new Set(shown.flatMap(([, odds]) => odds.map((o) => o.quantity)))];
  const what = rankedWhatIf(evidence, guide);
  const diff = what ? evidence.differences.find((d) => d.name === what.slot.quantity) : undefined;
  const pair = what ? guide?.slots[`diff:${what.slot.quantity}`]?.text.split(" → ") : undefined;
  const bars = what && diff ? [
    { label: `${batchLabel(evidence.batch)}, all ${evidence.n_images["batch"]} tiles`, text: pair?.[1] ?? fmt(diff.batch, diff.unit), color: batchColor(evidence.batch) },
    { label: `${batchLabel(evidence.batch)}, without the ${countWord(what.slot.tiles?.length ?? 0)}`, text: what.slot.text, color: batchColor(evidence.batch) },
    { label: `Baseline, ${batchLabel(evidence.baseline)}`, text: pair?.[0] ?? fmt(diff.reference, diff.unit), color: batchColor(evidence.baseline) },
  ] : [];
  const max = Math.max(1e-9, ...bars.map((b) => parseNum(b.text)));
  const nLeave = what?.slot.tiles?.length ?? 0;
  const sits = what?.slot.status === "SIMILAR";
  return (
    <section aria-label="The tiles behind it" className={`grid gap-3.5 ${bars.length ? "grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" : ""}`}>
      <div className="flex flex-col gap-4 rounded-[22px] border border-white/8 bg-cx-surface px-6 py-5">
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-xl font-semibold tracking-[-0.02em]">
            The {countWord(grouped.length)} {grouped.length === 1 ? "tile" : "tiles"} behind it
          </h2>
          <span className="text-[13px] text-cx-muted">
            Outside the baseline range on {plural(quantities.length, "property")}. Click one to look closer.
          </span>
        </div>
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))" }}>
          {shown.map(([id, odds]) => (
            <div key={id} className="flex min-w-0 flex-col gap-2.5">
              <Peekable
                items={shown.map(([tileId, tileOdds]) => ({
                  batch: evidence.batch,
                  imageId: tileId,
                  title: `Tile ${tileId}`,
                  note: `Outside the baseline range on ${joinAnd(tileOdds.map((o) => quantityLabel(o.quantity, dict)))}.`,
                  hasLayers: ctx.tiles.find((t) => t.batch === evidence.batch && t.image_id === tileId)?.has_layers,
                }))}
                index={shown.findIndex(([tileId]) => tileId === id)}
                label={`Tile ${id}: peek, click to pin`}
                className="block overflow-hidden rounded-[14px] bg-black"
                style={{ aspectRatio: "16 / 9", boxShadow: "0 0 0 1.5px rgba(250,204,21,.7)" }}
              >
                <img src={imageUrl(evidence.batch, id, "BSE")} alt="" loading="lazy" className="block h-full w-full object-cover" />
              </Peekable>
              <span className="mono text-[13px] text-cx-text-strong">{id}</span>
              <span className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-xs text-cx-muted">
                {odds.map((o) => {
                  const unit = evidence.differences.find((d) => d.name === o.quantity)?.unit || dictEntry(o.quantity, dict).unit;
                  return (
                    <span key={o.quantity} className="contents">
                      <span className="truncate">{quantityLabel(o.quantity, dict)}</span>
                      <span className="mono text-cx-investigate-text">{fmt(o.value, unit)}</span>
                    </span>
                  );
                })}
              </span>
            </div>
          ))}
        </div>
        {more > 0 && (
          <button type="button" onClick={onSeeAll} className="cursor-pointer self-start border-0 bg-transparent p-0 text-sm text-cx-orange-text">
            +{more} more
          </button>
        )}
        <span className="mono text-[11px] text-cx-faint">
          Baseline range: {quantities.map((q) => {
            const odd = shown.flatMap(([, odds]) => odds).find((o) => o.quantity === q);
            const unit = evidence.differences.find((d) => d.name === q)?.unit || dictEntry(q, dict).unit;
            return odd ? `${quantityLabel(q, dict)} ${fmtRange(odd.range[0], odd.range[1], unit)}` : quantityLabel(q, dict);
          }).join(" · ")}
        </span>
      </div>
      {bars.length > 0 && what && (
        <div className="glass flex flex-col gap-4 rounded-[22px] px-6 py-5">
          <div className="lbl">{quantityLabel(what.slot.quantity ?? "", dict)}</div>
          <div className="flex flex-col gap-3.5">
            {bars.map((bar) => (
              <div key={bar.label} className="flex flex-col gap-1.5">
                <div className="flex justify-between gap-3 text-[13px]">
                  <span className="text-cx-text-2">{bar.label}</span>
                  <span className="mono text-cx-text-strong">{bar.text}</span>
                </div>
                <div className="h-2 rounded bg-white/[0.06]">
                  <div className="h-2 rounded" style={{ width: `${Math.min(100, (parseNum(bar.text) / max) * 100)}%`, background: bar.color }} />
                </div>
              </div>
            ))}
          </div>
          <p className="m-0 mt-auto text-[13px] leading-normal text-cx-muted">
            {sits
              ? `Leave the ${countWord(nLeave)} ${nLeave === 1 ? "tile" : "tiles"} out and ${batchLabel(evidence.batch)} sits on the baseline for this property.`
              : `Leave the ${countWord(nLeave)} ${nLeave === 1 ? "tile" : "tiles"} out and ${batchLabel(evidence.batch)} still averages ${what.slot.text} on this property.`}
          </p>
        </div>
      )}
    </section>
  );
}

export function NextBlock({ evidence }: { evidence: Evidence }) {
  const steps = evidence.explanations.next_steps;
  return (
    <section aria-label="Next steps" className="flex flex-col gap-3.5 rounded-[22px] border border-white/8 bg-cx-surface px-6 py-5">
      <h2 className="m-0 text-xl font-semibold tracking-[-0.02em]">Next steps</h2>
      <ol className="m-0 grid list-none gap-2.5 p-0" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))" }}>
        {steps.map((text, i) => (
          <li key={i} className="flex gap-3 rounded-2xl border border-white/7 bg-white/[0.03] px-4 py-3.5 text-sm leading-normal text-cx-text-2">
            <span className="mono grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-white/8 text-xs text-cx-text-strong">{i + 1}</span>
            <span>{text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function propertySummary(ctx: Ctx): string {
  const shown = dropTwinShare(ctx.evidence.differences, ctx.evidence);
  const paused = (d: Difference) => d.note === "imaging changed";
  const n = (status: Difference["status"]) => shown.filter((d) => !paused(d) && d.status === status).length;
  return [
    [n("UNCLEAR"), "not settled"],
    [n("SIMILAR"), "same"],
    [n("DIFFERENT"), "differ"],
    [shown.filter(paused).length, "paused"],
  ].filter(([count]) => count).map(([count, word]) => `${count} ${word}`).join(" · ");
}

export function FoldedBlock({ ctx, open, onToggle }: { ctx: Ctx; open: Record<string, boolean>; onToggle: (id: string) => void }) {
  const { evidence } = ctx;
  const shown = dropTwinShare(evidence.differences, evidence);
  const prov = evidence.provenance;
  return (
    <Folds
      bare
      open={open}
      onToggle={onToggle}
      rows={[
        {
          id: "props",
          title: `All ${shown.length} properties, tile by tile`,
          summary: propertySummary(ctx),
          body: () => (
            <div className="flex min-w-0 flex-col gap-8">
              <Differences ctx={ctx} />
              <TileBands ctx={ctx} />
              <Galleries ctx={ctx} />
            </div>
          ),
        },
        {
          id: "explain",
          title: "Explain it for an operator, engineer, scientist or manager",
          summary: "4 versions",
          body: () => <Explain evidence={evidence} />,
        },
        {
          id: "run",
          title: "Run details",
          summary: `${evidence.n_images["batch"]} vs ${evidence.n_images["baseline"]} tiles · commit ${shortHash(prov?.git_commit, 7)} · ${prov?.rules_frozen_commit ? "frozen" : "not frozen"}`,
          body: () => <RunDetails ctx={ctx} />,
        },
      ]}
    />
  );
}

function Differences({ ctx }: { ctx: Ctx }) {
  const { evidence, config, dict } = ctx;
  const m = config.similar_margin;
  const rows = dropTwinShare(evidence.differences, evidence);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="overflow-x-auto">
        <div className="min-w-[820px]">
          <div className="lbl grid grid-cols-[240px_minmax(0,1fr)_150px_88px] items-end gap-5 border-b border-cx-line py-2">
            <span>Property</span>
            <div className="mono relative h-3.5 text-[10px] normal-case">
              <span className="absolute left-0">−4σ</span>
              <span className="absolute left-1/2 -translate-x-1/2 text-cx-batch-3">baseline · tolerance ±{m}σ</span>
              <span className="absolute right-0">+4σ</span>
            </div>
            <span className="text-right">{batchLabel(evidence.baseline)} → {batchLabel(evidence.batch)}</span>
            <span className="text-right">Status</span>
          </div>
          {rows.map((d) => {
            const held = d.note === "imaging changed";
            const s = sigmaOf(d, d.difference, config);
            const chip = statusChip(d.status, held);
            const notMeasured = d.note === "not measured" || (d.reference == null && d.batch == null);
            const unit = d.unit || dictEntry(d.name, dict).unit;
            return (
              <div key={d.name} className={`grid min-h-[52px] grid-cols-[240px_minmax(0,1fr)_150px_88px] items-center gap-5 border-b border-cx-line-soft ${held ? "opacity-55" : ""}`}>
                <span className="min-w-0 text-sm">{quantityLabel(d.name, dict)}</span>
                <ShiftBand s={s} lo={sigmaOf(d, d.interval?.[0], config)} hi={sigmaOf(d, d.interval?.[1], config)} margin={m}
                  color={d.status === "SIMILAR" ? "var(--cx-accept-text)" : batchColor(evidence.batch)} height={30} />
                {notMeasured ? (
                  <>
                    <span className="mono text-right text-[13px] text-cx-faint">not measured</span>
                    <span />
                  </>
                ) : (
                  <>
                    <div className="flex flex-col items-end gap-[3px]">
                      <span className="mono text-[13px]">{fmtPair(d.reference, d.batch, unit)}</span>
                      <span className="mono text-[11px] whitespace-nowrap text-cx-faint">{fmtSigma(s)}</span>
                    </div>
                    <span className={`inline-flex min-h-[26px] items-center justify-self-end rounded-full px-2.5 text-xs ${chip.className}`}>{chip.label}</span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TileBands({ ctx }: { ctx: Ctx }) {
  const { evidence, tiles, dict } = ctx;
  const oddOn = new Set([...oddByTile(evidence)].flatMap(([tile, odds]) => odds.map((o) => `${tile}|${o.quantity}`)));
  const keySet = new Set(evidence.differences.filter((d) => d.key).map((d) => d.name));
  const ordered = [...KPI_ORDER.filter((k) => keySet.has(k)), ...KPI_ORDER.filter((k) => !keySet.has(k))];
  const rows = ordered
    .map((kpi) => ({
      kpi,
      key: keySet.has(kpi),
      band: baselineBand(tiles, evidence.baseline, kpi),
      values: tiles.filter((t) => t.batch === evidence.batch && t.kpis?.[kpi] != null),
    }))
    .filter((row) => row.band && row.band.sd > 0 && row.values.length);
  if (!rows.length) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="pb-1 text-[13px] text-cx-faint">
        Shaded = {batchLabel(evidence.baseline)} ±1σ, ±2σ, ±3σ. Small dots are baseline tiles. Ringed dots sit outside the baseline range.
      </span>
      {rows.map(({ kpi, key, band, values }) => {
        const { mean, sd, values: baseValues } = band!;
        const lo = mean - 3.5 * sd;
        const hi = mean + 3.5 * sd;
        const x = (v: number) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
        const bandX = (k: number) => ({ left: `${x(mean - k * sd)}%`, width: `${x(mean + k * sd) - x(mean - k * sd)}%` });
        const unit = dictEntry(kpi, dict).unit;
        const label = quantityLabel(kpi, dict);
        const baseTiles = tiles.filter((t) => t.batch === evidence.baseline && t.kpis?.[kpi] != null);
        const baseItems: PeekItem[] = baseTiles.map((t) => ({
          batch: t.batch, imageId: t.image_id, title: `Tile ${t.image_id}`,
          note: `${label} ${fmt(t.kpis?.[kpi], unit)}.`, detectors: t.detectors, hasLayers: t.has_layers,
        }));
        const batchItems: PeekItem[] = values.map((t) => ({
          batch: t.batch, imageId: t.image_id, title: `Tile ${t.image_id}`,
          note: `${label} ${fmt(t.kpis?.[kpi], unit)}${oddOn.has(`${t.image_id}|${kpi}`) ? ", outside the baseline range" : ""}.`,
          detectors: t.detectors, hasLayers: t.has_layers,
        }));
        return (
          <div key={kpi} className="grid grid-cols-[minmax(0,230px)_minmax(0,1fr)] items-center gap-4">
            <div className="flex min-w-0 flex-col gap-[2px]">
              <span className="text-[13px] leading-snug">{label}</span>
              <span className="mono text-[11px] text-cx-faint">{fmt(mean, unit)} <span className="opacity-60">±{fmt(sd, unit)}</span></span>
            </div>
            <div className="relative h-9 min-w-0">
              <div className="absolute top-1/2 h-[10px] -translate-y-1/2 rounded-[3px] bg-cx-batch-3/[0.07]" style={bandX(3)} />
              <div className="absolute top-1/2 h-[10px] -translate-y-1/2 rounded-[3px] bg-cx-batch-3/[0.16]" style={bandX(2)} />
              <div className="absolute top-1/2 h-[10px] -translate-y-1/2 rounded-[3px] bg-cx-batch-3/[0.38]" style={bandX(1)} />
              <div className="absolute inset-y-0 w-px bg-cx-batch-3/70" style={{ left: `${x(mean)}%` }} />
              {baseValues.map((v, i) => {
                const t = baseTiles[i];
                if (!t) return null;
                return (
                  <Peekable key={t.image_id} items={baseItems} index={i} label={`Baseline tile ${t.image_id}: peek, click to pin`}
                    className="absolute h-[5px] w-[5px] rounded-full bg-cx-batch-3"
                    style={{ left: `calc(${x(v)}% - 2.5px)`, top: JITTER[i % JITTER.length] % 12 }} />
                );
              })}
              {values.map((tile, i) => {
                const odd = oddOn.has(`${tile.image_id}|${kpi}`);
                const size = odd ? 12 : 8;
                return (
                  <Peekable key={tile.image_id} items={batchItems} index={i} label={`Tile ${tile.image_id}: peek, click to pin`}
                    className="absolute rounded-full"
                    style={{
                      left: `calc(${x(tile.kpis![kpi]!)}% - ${size / 2}px)`,
                      bottom: JITTER[(i + 3) % JITTER.length] % 12,
                      width: size, height: size, background: batchColor(evidence.batch),
                      boxShadow: odd ? "0 0 0 2px #111215, 0 0 0 4px var(--cx-investigate)" : "none",
                    }} />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Galleries({ ctx }: { ctx: Ctx }) {
  const { evidence, tiles } = ctx;
  const oddIds = new Set(oddByTile(evidence).keys());
  const byOdd = (a: Tile, b: Tile) => Number(oddIds.has(b.image_id)) - Number(oddIds.has(a.image_id));
  const self = evidence.batch === evidence.baseline;
  const columns = [
    { name: evidence.batch, tiles: tiles.filter((t) => t.batch === evidence.batch).sort(byOdd), baseline: self },
    { name: evidence.baseline, tiles: tiles.filter((t) => t.batch === evidence.baseline), baseline: true },
  ].slice(0, self ? 1 : 2);
  return (
    <div className={`grid min-w-0 gap-4 ${self ? "" : "grid-cols-2"}`}>
      {columns.map((col, c) => (
        <div key={`${c}-${col.name}`} className={`flex min-w-0 flex-col gap-3 rounded-[18px] border p-4 ${col.baseline ? "border-cx-batch-3/20" : "border-cx-line"}`}>
          <div className="flex items-center justify-between">
            <h3 className="m-0 flex items-center gap-2 text-[15px] font-medium">
              <BatchDot name={col.name} size={10} />
              {batchLabel(col.name)}
              {col.baseline && <span className="font-normal text-cx-faint">baseline</span>}
            </h3>
            <span className="text-[13px] text-cx-faint">{plural(col.tiles.length, "tile")}</span>
          </div>
          <div className={`grid gap-2 ${self ? "grid-cols-6" : "grid-cols-3"}`}>
            {col.tiles.map((tile, i) => (
              <Peekable
                key={tile.image_id}
                items={col.tiles.map((t) => peekItem(t, ctx, oddIds))}
                index={i}
                label={`Tile ${tile.image_id}: peek, click to pin`}
                className="relative block aspect-square overflow-hidden rounded-xl bg-black"
                style={oddIds.has(tile.image_id) ? { boxShadow: "0 0 0 2px var(--cx-investigate)" } : { boxShadow: "inset 0 0 0 1px var(--cx-line)" }}
              >
                <img src={imageUrl(tile.batch, tile.image_id, "BSE")} alt="" loading="lazy" className="block h-full w-full object-cover" />
                <span className="mono absolute bottom-2 left-2 rounded-md px-1.5 py-0.5 text-[11px]" style={{ background: "rgba(10,11,13,.75)", color: oddIds.has(tile.image_id) ? "var(--cx-investigate-text)" : "var(--cx-text)" }}>
                  {tile.image_id}
                </span>
              </Peekable>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function peekItem(tile: Tile, ctx: Ctx, oddIds: Set<string>): PeekItem {
  const odds = oddByTile(ctx.evidence).get(tile.image_id) ?? [];
  const unit = (q: string) => ctx.evidence.differences.find((d) => d.name === q)?.unit;
  return {
    batch: tile.batch,
    imageId: tile.image_id,
    title: `Tile ${tile.image_id}`,
    note: oddIds.has(tile.image_id)
      ? `Outside the baseline range on ${joinAnd(odds.map((o) => `${quantityLabel(o.quantity, ctx.dict)} (${fmt(o.value, unit(o.quantity))})`))}.`
      : undefined,
    detectors: tile.detectors,
    hasLayers: tile.has_layers,
  };
}

const AUDIENCES = [
  ["operator", "Operator"],
  ["engineer", "Process engineer"],
  ["scientist", "Materials scientist"],
  ["manager", "Manager"],
] as const;

function Explain({ evidence }: { evidence: Evidence }) {
  const [audience, setAudience] = useState<(typeof AUDIENCES)[number][0]>("engineer");
  const sentences = evidence.explanations[audience];
  const textClass = audience === "scientist" ? "mono text-[13px] text-cx-text-2" : "text-[15px] text-cx-text";
  return (
    <div className="flex flex-col gap-4">
      <Seg options={AUDIENCES.map(([value, label]) => ({ value, label }))} value={audience} onChange={setAudience} className="self-start" />
      {sentences.length ? (
        <ul className="m-0 flex max-w-[900px] list-none flex-col gap-2 p-0">
          {sentences.map((sentence, i) => (
            <li key={i} className={`flex gap-2.5 leading-[1.55] ${textClass}`}>
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cx-text-2/70" />
              <span>{sentence}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-sm text-cx-muted">Nothing written for this audience.</p>
      )}
    </div>
  );
}

function RunDetails({ ctx }: { ctx: Ctx }) {
  const { evidence, config } = ctx;
  const prov = evidence.provenance;
  const p = evidence.power;
  const facts: [string, ReactNode][] = [
    ["Compared", `${p.n_segments[0]} vs ${p.n_segments[1]} ${evidence.unit === "image" ? "tiles" : "strips"}`],
    ["Smallest possible p", `${p.min_p < 1e-3 ? p.min_p.toExponential(1) : p.min_p.toPrecision(2)} (${p.n_arrangements.toLocaleString()} arrangements)`],
    ["α · interval · tolerance", `${config.alpha} · ${Math.round(config.ci_level * 100)}% · ±${config.similar_margin}σ`],
    ["Per strip", `${evidence.other_unit.power.n_segments[0]} vs ${evidence.other_unit.power.n_segments[1]} strips${evidence.other_unit.contradictions.length ? ` · changes status: ${evidence.other_unit.contradictions.join(", ")}` : ", no status changes"}`],
    ["Inputs", `${prov?.inputs.length ?? 0} files, SHA-256 in the audit log`],
    ["Code", `${shortHash(prov?.git_commit, 12)}${prov?.git_dirty ? " (uncommitted changes)" : ""}`],
    ["Rules", prov?.rules_frozen_commit ? `frozen at ${shortHash(prov.rules_frozen_commit, 7)}` : "not frozen when this ran"],
    ["Ran", prov?.created_at.replace("T", " ").replace("+00:00", " UTC") ?? "—"],
  ];
  if (evidence.imaging.outliers_in_reference.length)
    facts.push(["Left out of the imaging range", evidence.imaging.outliers_in_reference.join(", ")]);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <dl className="m-0 grid grid-cols-[220px_minmax(0,1fr)] gap-x-6 gap-y-2 text-[13px]">
        {facts.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-cx-faint">{k}</dt>
            <dd className="mono m-0 break-all text-cx-text-2">{v}</dd>
          </div>
        ))}
      </dl>
      {evidence.explanations.rules.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="lbl">Rules that fired</span>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
            {evidence.explanations.rules.map((r) => (
              <li key={r} className="flex items-center gap-2.5">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: evidence.verdict === "REJECT" ? "var(--cx-reject)" : "var(--cx-investigate)" }} />
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
