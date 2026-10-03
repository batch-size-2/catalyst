import { useRef, useState } from "react";
import {
  getAttributionEvaluation, getConfig, getEvidence, getKpiDictionary, getTiles, imageUrl,
  listBatches, runBatch, uploadBatch,
} from "../api";
import {
  batchColor, batchLabel, baselineBand, dictEntry, featureLabel, fmt, quantityLabel,
  statusChip, useApi,
} from "../lib";
import { href } from "../router";
import type { Difference, Evidence, Tile } from "../types";
import {
  BatchDot, Cat, ErrorPanel, IconWarn, Panel, Seg, Spinner, TileThumb, VerdictPill,
} from "./bits";

const KPI_ORDER = [
  "si_graphite_ratio", "si_area_frac", "si_d50_um", "si_d90_um", "si_internal_void_frac",
  "si_contrast_ratio", "si_fragments_per_1e4um2", "si_dispersion_cv", "si_agglomerate_frac",
  "si_corr_length_um", "porosity_apparent", "graphite_chord_um", "graphite_anisotropy",
  "pore_chord_um", "pore_connectivity",
];

interface RunState {
  batch: string;
  phase: "uploading" | "measuring";
  done: number;
  total: number;
  tile: string | null;
  error?: string;
}

export default function Compare({ routeBatch }: { routeBatch?: string }) {
  const config = useApi(getConfig);
  const batches = useApi(listBatches);
  const tiles = useApi(getTiles);
  const dict = useApi(getKpiDictionary);
  const evaluation = useApi(getAttributionEvaluation);
  const [run, setRun] = useState<RunState | null>(null);
  const [reload, setReload] = useState(0);
  const folder = useRef<HTMLInputElement>(null);

  const baseline = config.data?.baseline ?? null;
  const candidates = batches.data ?? [];
  const selected =
    routeBatch && candidates.some((b) => b.name === routeBatch)
      ? routeBatch
      : candidates.find((b) => b.name !== baseline && b.verdict)?.name ??
        candidates.find((b) => b.verdict)?.name ??
        candidates[0]?.name;
  const evidence = useApi(
    () => (selected ? getEvidence(selected) : Promise.resolve(null)),
    [selected, reload],
  );

  async function startRun(batch: string, files?: File[]) {
    setRun({ batch, phase: files ? "uploading" : "measuring", done: 0, total: 0, tile: null });
    try {
      if (files) await uploadBatch(batch, files);
      setRun((r) => r && { ...r, phase: "measuring" });
      await runBatch(batch, (event) => {
        if (event.type === "progress")
          setRun((r) => r && { ...r, done: event.done, total: event.total, tile: event.tile });
        if (event.type === "error") setRun((r) => r && { ...r, error: event.message });
        if (event.type === "done") {
          setRun(null);
          setReload((n) => n + 1);
          window.location.hash = href.compare(event.evidence.batch);
        }
      });
    } catch (err) {
      setRun((r) => r && { ...r, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const batchTiles = tiles.data?.filter((t) => t.batch === selected) ?? [];
  const heroTile = batchTiles[0];

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-7 px-10 py-10">
      <div className="flex flex-col gap-2.5">
        <div className="lbl text-cx-orange-text">Compare</div>
        <h1 className="m-0 text-[40px] leading-[1.1] font-semibold tracking-[-0.03em]">
          How far is a batch from baseline?
        </h1>
      </div>

      <div className="glass flex flex-wrap items-center gap-2.5 rounded-[20px] p-2.5">
        <BatchPicker
          batches={candidates}
          selected={selected}
          tiles={tiles.data ?? []}
          onPick={(name) => (window.location.hash = href.compare(name))}
        />
        <span className="mono px-1 text-[13px] text-cx-faint">vs</span>
        {baseline && (
          <div className="flex min-h-14 items-center gap-3 rounded-[14px] border border-cx-batch-3/35 bg-cx-batch-3/[0.08] px-4">
            <span className="flex flex-col items-start gap-0.5">
              <span className="lbl text-[10px] text-cx-batch-3">Baseline</span>
              <span className="flex items-center gap-2 text-base font-medium">
                <BatchDot name={baseline} size={10} />
                {batchLabel(baseline)}
                <span className="text-[13px] font-normal text-cx-faint">
                  {tiles.data?.filter((t) => t.batch === baseline).length ?? "—"} tiles · default
                </span>
              </span>
            </span>
          </div>
        )}
        <div className="ml-auto flex flex-wrap gap-2 pr-1.5">
          {selected && candidates.find((b) => b.name === selected)?.has_images && (
            <button
              className="btn"
              type="button"
              disabled={!!run && !run.error}
              onClick={() => void startRun(selected)}
            >
              Run again
            </button>
          )}
          <input
            ref={folder}
            type="file"
            multiple
            className="hidden"
            {...{ webkitdirectory: "" }}
            onChange={(e) => {
              const files = [...(e.target.files ?? [])].filter((f) => /\.tiff?$/i.test(f.name));
              const name = files[0]?.webkitRelativePath.split("/")[0];
              if (name) void startRun(name, files);
              e.target.value = "";
            }}
          />
          <button className="btn" type="button" disabled={!!run && !run.error} onClick={() => folder.current?.click()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
            </svg>
            New batch
          </button>
        </div>
      </div>

      {run && (
        <Panel className="flex items-center gap-4">
          <Spinner size={20} />
          <div className="flex-1">
            <div className="text-sm">
              {run.phase === "uploading" ? `Uploading ${run.batch}…` : `Measuring ${run.batch}`}
            </div>
            <div className="mono text-xs text-cx-faint">
              {run.error ?? (run.total ? `${run.done}/${run.total} · ${run.tile ?? ""}` : "starting up")}
            </div>
          </div>
          {run.error && <IconWarn size={16} />}
        </Panel>
      )}
      {run?.error && <ErrorPanel title="Run failed" message={run.error} />}

      {evidence.error && (
        <ErrorPanel title={`No evidence for ${selected ?? "this batch"}`} message={evidence.error} />
      )}

      {!evidence.data && !evidence.error && !selected && (
        <Panel className="flex items-center gap-3 text-sm text-cx-muted">
          <Cat mood="ready" size={34} />
          Pick a batch, or upload a folder of tiles to compare it against the baseline.
        </Panel>
      )}

      {evidence.data && selected && config.data && (
        <>
          <Hero evidence={evidence.data} tile={heroTile} batch={selected} />
          <Counts evidence={evidence.data} config={config.data} tiles={batchTiles} />
          <WhatsDifferent evidence={evidence.data} config={config.data} />
          <Differences evidence={evidence.data} config={config.data} dict={dict.data} />
          <TileBands evidence={evidence.data} tiles={tiles.data ?? []} batch={selected} dict={dict.data} />
          <Galleries evidence={evidence.data} tiles={tiles.data ?? []} batch={selected} />
          <Explain evidence={evidence.data} />
          <Separates evaluation={evaluation.data} dict={dict.data} />
        </>
      )}
    </div>
  );
}

function BatchPicker({
  batches,
  selected,
  tiles,
  onPick,
}: {
  batches: { name: string; verdict: string | null; has_images: boolean }[];
  selected: string | undefined;
  tiles: Tile[];
  onPick: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = batches.find((b) => b.name === selected);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-14 cursor-pointer items-center gap-3 rounded-[14px] border border-cx-line bg-white/[0.07] px-4 text-cx-text"
        style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,.12)", font: "inherit" }}
      >
        <span className="flex flex-col items-start gap-0.5">
          <span className="lbl text-[10px]">Batch</span>
          <span className="flex items-center gap-2 text-base font-medium">
            {current && <BatchDot name={current.name} size={10} />}
            {current ? batchLabel(current.name) : "Choose…"}
            <span className="text-[13px] font-normal text-cx-faint">
              {tiles.filter((t) => t.batch === selected).length || "—"} tiles
            </span>
          </span>
        </span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="glass absolute top-full left-0 z-10 mt-2 flex min-w-[240px] flex-col gap-1 rounded-[14px] p-2">
          {batches.map((b) => (
            <button
              key={b.name}
              type="button"
              onClick={() => {
                setOpen(false);
                onPick(b.name);
              }}
              className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-[10px] border-0 bg-transparent px-2.5 text-left text-sm text-cx-muted hover:bg-white/5 hover:text-cx-text"
            >
              <BatchDot name={b.name} size={8} />
              <span className="flex-1">{batchLabel(b.name)}</span>
              <span className="mono text-[11px] text-cx-faint">
                {tiles.filter((t) => t.batch === b.name).length} tiles{b.verdict ? "" : " · not run"}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Hero({ evidence, tile, batch }: { evidence: Evidence; tile: Tile | undefined; batch: string }) {
  const next = [evidence.next_action, ...oddSteps(evidence)];
  return (
    <section
      className="relative overflow-hidden rounded-[26px] border border-cx-line bg-black"
      style={{ minHeight: 360 }}
    >
      {tile && (
        <img
          src={imageUrl(tile.batch, tile.image_id, tile.detectors.includes("BSE") ? "BSE" : tile.detectors[0], 2048)}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover opacity-45 brightness-[0.7]"
        />
      )}
      <div
        className="glass relative m-6 grid min-h-[280px] grid-cols-12 gap-8 rounded-[22px] px-8 py-7"
        style={{ background: "linear-gradient(180deg, rgba(30,31,36,.6), rgba(18,19,22,.75))" }}
      >
        <div className="col-span-7 flex min-w-0 flex-col gap-4">
          <VerdictPill verdict={evidence.verdict} />
          <p className="m-0 text-[26px] leading-[1.3] font-medium tracking-[-0.02em]">
            {evidence.explanations.operator || `${batchLabel(batch)} ${evidence.verdict.toLowerCase()}s against the baseline.`}
          </p>
          {evidence.reasons.length > 0 && (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm text-cx-muted">
              {evidence.reasons.slice(0, 4).map((reason) => (
                <li key={reason} className="flex gap-2">
                  <span className="text-cx-faint">·</span>
                  {reason}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="col-span-5 flex min-w-0 flex-col gap-3">
          <div className="lbl">Next steps</div>
          {next.map((step, i) => (
            <div
              key={i}
              className="flex items-start gap-3 rounded-[14px] border border-cx-line bg-black/25 p-3.5 text-sm leading-snug"
            >
              <span className="mono grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-white/[0.08] text-xs">
                {i + 1}
              </span>
              <span className="text-cx-text-2">{step}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function oddSteps(evidence: Evidence): string[] {
  const odd = evidence.unit === "image" ? evidence.odd_images : evidence.odd_strips;
  return odd.slice(0, 2).map((o) => `Look at ${o.image_ids.join(", ")}: outside the baseline range on ${o.quantity}.`);
}

function Counts({ evidence, config, tiles }: { evidence: Evidence; config: import("../types").Config; tiles: Tile[] }) {
  const used = evidence.differences.filter((d) => d.used);
  const different = used.filter((d) => d.status === "DIFFERENT").length;
  const unclear = used.filter((d) => d.status === "UNCLEAR").length;
  const similar = used.filter((d) => d.status === "SIMILAR").length;
  const odd = evidence.unit === "image" ? evidence.odd_images : evidence.odd_strips;
  const paused = evidence.imaging.changed
    ? used.filter((d) => config.imaging_sensitive?.includes(d.name)).length
    : 0;
  const cells = [
    {
      label: "Key properties",
      big: `${different} `,
      bigSuffix: "clearly different",
      sub: `${unclear} unclear · ${similar} settled as similar`,
    },
    {
      label: "Odd tiles",
      big: `${odd.length} `,
      bigSuffix: `of ${tiles.length || evidence.n_images.batch}`,
      sub: "Outside the baseline range",
    },
    {
      label: "Imaging",
      big: evidence.imaging.changed ? "Changed" : "Unchanged",
      warn: evidence.imaging.changed,
      sub: evidence.imaging.changed
        ? `${evidence.imaging.changed_metrics.length} settings${paused ? ` · ${paused} properties paused` : ""}`
        : "Within the baseline imaging range",
    },
    {
      label: "Evidence",
      big: `${evidence.n_images.batch} `,
      bigSuffix: `vs ${evidence.n_images.baseline} tiles`,
      sub: evidence.power.limited
        ? `Not enough to settle (smallest p ${evidence.power.min_p})`
        : "Enough to detect a real shift",
    },
  ];
  return (
    <div className="panel grid grid-cols-4 overflow-hidden p-0">
      {cells.map((cell, i) => (
        <div key={cell.label} className={`flex flex-col gap-2 p-5 ${i < 3 ? "border-r border-cx-line" : ""}`}>
          <span className="lbl">{cell.label}</span>
          <span className={`text-[28px] font-semibold tracking-[-0.02em] ${cell.warn ? "text-cx-investigate-text" : ""}`}>
            {cell.big}
            <span className="text-sm font-normal text-cx-muted">{cell.bigSuffix}</span>
          </span>
          <span className="text-[13px] text-cx-muted">{cell.sub}</span>
        </div>
      ))}
    </div>
  );
}

function Differences({
  evidence,
  config,
  dict,
}: {
  evidence: Evidence;
  config: import("../types").Config;
  dict: import("../types").KpiDictionary | null;
}) {
  const margin = config.similar_margin;
  const paused = (d: Difference) => evidence.imaging.changed && config.imaging_sensitive?.includes(d.name);
  const sigma = (d: Difference, v: number | null) =>
    d.margin ? (v ?? 0) / d.margin * margin : null;
  const pos = (s: number) => ((Math.max(-4, Math.min(4, s)) + 4) / 8) * 100;

  return (
    <Panel className="flex flex-col gap-1">
      <div className="flex flex-wrap items-baseline justify-between gap-3 pb-3">
        <h2 className="m-0 text-lg font-medium tracking-[-0.01em]">What moved, and how sure we are</h2>
        <span className="text-[13px] text-cx-faint">
          Shift in baseline standard deviations · bar = {Math.round(config.ci_level * 100)}% interval ·
          shaded = tolerance ±{margin}σ
        </span>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[820px]">
          <div className="lbl grid grid-cols-[220px_minmax(0,1fr)_150px_150px_96px] items-end gap-5 border-b border-cx-line py-2">
            <span>Property</span>
            <div className="mono relative h-3.5 text-[10px]">
              <span className="absolute left-0">−4σ</span>
              <span className="absolute left-1/4 -translate-x-1/2">−2σ</span>
              <span className="absolute left-1/2 -translate-x-1/2 text-cx-batch-3">baseline</span>
              <span className="absolute left-3/4 -translate-x-1/2">+2σ</span>
              <span className="absolute right-0">+4σ</span>
            </div>
            <span className="text-right">Baseline → {batchLabel(evidence.batch)}</span>
            <span className="text-right">Spread (SD ×)</span>
            <span className="text-right">Status</span>
          </div>
          {evidence.differences.map((d) => {
            const isPaused = paused(d);
            const s = sigma(d, d.difference);
            const lo = sigma(d, d.interval?.[0] ?? null);
            const hi = sigma(d, d.interval?.[1] ?? null);
            const chip = statusChip(d.status, !!isPaused);
            const notMeasured = d.note === "not measured" || (d.reference == null && d.batch == null);
            const unit = d.unit || dictEntry(d.name, dict).unit;
            return (
              <div
                key={d.name}
                className={`grid min-h-[54px] grid-cols-[220px_minmax(0,1fr)_150px_150px_96px] items-center gap-5 border-b border-cx-line-soft ${isPaused ? "opacity-55" : ""}`}
              >
                <div className="flex min-w-0 flex-col gap-[3px]">
                  <span className="flex items-center gap-2 text-sm">
                    {quantityLabel(d.name, dict)}
                    {d.key && (
                      <span className="mono rounded border border-cx-orange-text/50 px-1 py-px text-[9px] text-cx-orange-text">
                        KEY
                      </span>
                    )}
                  </span>
                  <span className="mono text-[11px] text-cx-faint">{d.name}</span>
                </div>
                <div className="relative h-8">
                  {/* tolerance zone ±similar_margin σ */}
                  <div
                    className="absolute inset-y-0 border-x border-dashed border-cx-batch-3/45 bg-cx-batch-3/[0.12]"
                    style={{ left: `${pos(-margin)}%`, width: `${pos(margin) - pos(-margin)}%` }}
                  />
                  {[-3, -2, -1, 1, 2, 3].map((g) => (
                    <div key={g} className="absolute inset-y-0 w-px bg-white/[0.05]" style={{ left: `${pos(g)}%` }} />
                  ))}
                  <div className="absolute inset-y-0 w-px bg-cx-batch-3/60" style={{ left: "50%" }} />
                  {lo != null && hi != null && (
                    <div
                      className="absolute top-1/2 h-1 rounded-[2px] -translate-y-1/2"
                      style={{
                        left: `${pos(lo)}%`,
                        width: `${Math.max(0.5, pos(hi) - pos(lo))}%`,
                        background: d.status === "SIMILAR" ? "var(--cx-accept-text)" : batchColor(evidence.batch),
                      }}
                    />
                  )}
                  {s != null && (
                    <div
                      className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cx-text-strong"
                      style={{ left: `${pos(s)}%`, boxShadow: "0 0 0 3px #111215" }}
                    />
                  )}
                </div>
                {notMeasured ? (
                  <>
                    <span className="mono text-right text-[13px] text-cx-faint">not measured</span>
                    <span />
                    <span className="justify-self-end" />
                  </>
                ) : (
                  <>
                    <div className="flex flex-col items-end gap-[3px]">
                      <span className="mono text-[13px]">
                        <span className="text-cx-faint">{fmt(d.reference, unit)} →</span> {fmt(d.batch, unit)}
                      </span>
                      <span className="mono text-[11px] text-cx-faint">
                        {s != null ? `${s > 0 ? "+" : ""}${s.toFixed(1)}σ` : ""}
                        {d.p != null ? ` p ${Number(d.p.toPrecision(2))}` : isPaused ? "imaging changed" : ""}
                      </span>
                    </div>
                    <Spread d={d} other={evidence.other_unit.variance_ratios?.[d.name]} otherUnit={evidence.other_unit.unit} />
                    <span
                      className={`inline-flex min-h-[26px] items-center justify-self-end rounded-full px-2.5 text-xs ${chip.className}`}
                    >
                      {chip.label}
                    </span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <p className="m-0 pt-3 text-[13px] leading-normal text-cx-faint">
        Different = interval clears the tolerance and family-wise p &lt; {config.alpha}. Similar = interval
        sits inside the tolerance. Anything else is unclear, and we say so. Brightness-based properties
        pause when imaging changed. Spread = batch SD / baseline SD per {evidence.unit}, with its{" "}
        {Math.round(config.ci_level * 100)}% F interval and the {evidence.other_unit.unit} view beside it;
        reported only, never part of the verdict.
      </p>
    </Panel>
  );
}

const ratio = (r: number) => `${r.toFixed(1)}×`;

function Spread({
  d,
  other,
  otherUnit,
}: {
  d: Difference;
  other: import("../types").VarianceRatio | undefined;
  otherUnit: string;
}) {
  if (d.variance_ratio == null) return <span />;
  const [lo, hi] = d.variance_ratio_interval ?? [null, null];
  return (
    <div className="flex flex-col items-end gap-[3px]">
      <span className="mono text-[13px]">{ratio(d.variance_ratio)}</span>
      <span className="mono text-[11px] text-cx-faint">
        {lo != null && hi != null ? `${lo.toFixed(1)}–${hi.toFixed(1)}` : ""}
        {other?.ratio != null ? ` · ${otherUnit} ${ratio(other.ratio)}` : ""}
      </span>
    </div>
  );
}

const SILICON_ROWS = [
  ["si_area_frac", "Share of the image area"],
  ["si_solid_frac", "Share of the solid: Si / (Si + graphite + binder)"],
] as const;

function WhatsDifferent({ evidence, config }: { evidence: Evidence; config: import("../types").Config }) {
  const statements = evidence.explanations.statements ?? [];
  const pictures = evidence.explanations.pictures ?? [];
  const silicon = evidence.silicon_content ?? { batch: [], baseline: [] };
  const spread = evidence.differences.find((d) => d.name === "si_area_frac");
  const otherSpread = evidence.other_unit.variance_ratios?.si_area_frac;
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const cell = (side: "batch" | "baseline", name: string) => {
    const d = silicon[side].find((x) => x.name === name);
    if (d?.value == null) return <span className="mono text-[13px] text-cx-faint">—</span>;
    return (
      <span className="flex flex-col items-end gap-[3px]">
        <span className="mono text-[15px]">{pct(d.value)}</span>
        <span className="mono text-[11px] text-cx-faint">
          {d.interval ? `${pct(d.interval[0])}–${pct(d.interval[1])}` : "no interval"}
        </span>
      </span>
    );
  };
  if (!statements.length && !silicon.batch.length) return null;
  return (
    <Panel className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="m-0 text-lg font-medium tracking-[-0.01em]">What's different</h2>
        <span className="text-[13px] text-cx-faint">From this batch's evidence · fixed statements</span>
      </div>
      {statements.length > 0 && (
        <ul className="m-0 flex max-w-[900px] list-none flex-col gap-2 p-0">
          {statements.map((sentence, i) => (
            <li key={i} className={`flex gap-2.5 leading-[1.55] ${i === statements.length - 1 ? "text-sm text-cx-muted" : "text-base text-cx-text"}`}>
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cx-orange/70" />
              <span>{sentence}</span>
            </li>
          ))}
        </ul>
      )}
      {pictures.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {pictures.map((pic) => (
            <figure key={`${pic.image_id}-${pic.detector}`} className="m-0 flex flex-col gap-2">
              <img
                src={imageUrl(evidence.batch, pic.image_id, pic.detector, 2048)}
                alt={pic.caption}
                loading="lazy"
                className="block aspect-[16/10] w-full rounded-[14px] border border-cx-line object-cover"
              />
              <figcaption className="text-[13px] text-cx-muted">
                {pic.caption}{" "}<span className="mono ml-1 text-cx-faint">{pic.image_id} · {pic.detector}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      {silicon.batch.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-cx-line-soft pt-4">
          <div className="lbl grid grid-cols-[minmax(0,1fr)_150px_150px_170px] items-end gap-5 border-b border-cx-line py-2">
            <span>Silicon content · mean, {Math.round(config.ci_level * 100)}% interval</span>
            <span className="text-right">{batchLabel(evidence.batch)}</span>
            <span className="text-right">{batchLabel(evidence.baseline)} (baseline)</span>
            <span className="text-right">Spread (SD ×)</span>
          </div>
          {SILICON_ROWS.map(([name, text]) => (
            <div key={name} className="grid min-h-[54px] grid-cols-[minmax(0,1fr)_150px_150px_170px] items-center gap-5 border-b border-cx-line-soft">
              <span className="flex flex-col gap-[3px]">
                <span className="text-sm">{text}</span>
                <span className="mono text-[11px] text-cx-faint">{name}</span>
              </span>
              <span className="justify-self-end">{cell("batch", name)}</span>
              <span className="justify-self-end">{cell("baseline", name)}</span>
              {name === "si_area_frac" && spread ? (
                <Spread d={spread} other={otherSpread} otherUnit={evidence.other_unit.unit} />
              ) : (
                <span />
              )}
            </div>
          ))}
          {evidence.explanations.silicon_note && (
            <p className="m-0 pt-2 text-[13px] leading-normal text-cx-faint">{evidence.explanations.silicon_note}</p>
          )}
        </div>
      )}
    </Panel>
  );
}

const JITTER = [8, 22, 14, 30, 4, 18, 26, 10, 34, 2, 20, 28, 12, 6, 24, 16, 32];

function TileBands({
  evidence,
  tiles,
  batch,
  dict,
}: {
  evidence: Evidence;
  tiles: Tile[];
  batch: string;
  dict: import("../types").KpiDictionary | null;
}) {
  const oddIds = new Set(evidence.odd_images.flatMap((o) => o.image_ids));
  const keySet = new Set(evidence.differences.filter((d) => d.key).map((d) => d.name));
  const ordered = [
    ...KPI_ORDER.filter((k) => keySet.has(k)),
    ...KPI_ORDER.filter((k) => !keySet.has(k)),
  ];
  const rows = ordered.map((kpi) => ({
    kpi,
    key: keySet.has(kpi),
    band: baselineBand(tiles, evidence.baseline, kpi),
    batchValues: tiles
      .filter((t) => t.batch === batch && t.kpis?.[kpi] != null)
      .map((t) => ({ id: t.image_id, v: t.kpis![kpi]! })),
  })).filter((row) => row.band && row.band.sd > 0 && row.batchValues.length);

  return (
    <Panel className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="m-0 text-lg font-medium tracking-[-0.01em]">
          Every tile, on the baseline band <span className="font-normal text-cx-faint">· per property</span>
        </h2>
        <span className="text-[13px] text-cx-faint">Bands = baseline ±1σ, ±2σ, ±3σ</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {rows.map(({ kpi, key, band, batchValues }) => {
          const { mean, sd, values } = band!;
          const lo = mean - 3.5 * sd;
          const hi = mean + 3.5 * sd;
          const x = (v: number) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
          const bandX = (k: number) => ({
            left: `${x(mean - k * sd)}%`,
            width: `${x(mean + k * sd) - x(mean - k * sd)}%`,
          });
          const unit = dictEntry(kpi, dict).unit;
          return (
            <div key={kpi} className="grid grid-cols-[170px_minmax(0,1fr)] items-center gap-4">
              <div className="flex min-w-0 flex-col gap-[2px]">
                <span className="flex items-center gap-1.5 truncate text-[13px]" title={kpi}>
                  {quantityLabel(kpi, dict)}
                  {key && (
                    <span className="mono rounded border border-cx-orange-text/50 px-1 py-px text-[9px] text-cx-orange-text">
                      KEY
                    </span>
                  )}
                </span>
                <span className="mono text-[11px] text-cx-faint">
                  {fmt(mean, unit)} <span className="opacity-60">±{fmt(sd, unit)}</span>
                </span>
              </div>
              <div className="relative h-9">
                <div className="absolute top-1/2 h-[10px] -translate-y-1/2 rounded-[3px] bg-cx-batch-3/[0.07]" style={bandX(3)} />
                <div className="absolute top-1/2 h-[10px] -translate-y-1/2 rounded-[3px] bg-cx-batch-3/[0.16]" style={bandX(2)} />
                <div className="absolute top-1/2 h-[10px] -translate-y-1/2 rounded-[3px] bg-cx-batch-3/[0.38]" style={bandX(1)} />
                <div className="absolute inset-y-0 w-px bg-cx-batch-3/70" style={{ left: `${x(mean)}%` }} />
                {values.map((v, i) => (
                  <div
                    key={i}
                    className="absolute h-[5px] w-[5px] rounded-full bg-cx-batch-3 opacity-90"
                    style={{ left: `calc(${x(v)}% - 2.5px)`, top: JITTER[i % JITTER.length] % 12 }}
                  />
                ))}
                {batchValues.map((tile, i) => {
                  const odd = oddIds.has(tile.id);
                  return (
                    <div
                      key={tile.id}
                      title={`${tile.id} · ${fmt(tile.v, unit)}`}
                      className="absolute rounded-full"
                      style={{
                        left: `calc(${x(tile.v)}% - ${odd ? 6 : 4}px)`,
                        bottom: JITTER[(i + 3) % JITTER.length] % 12,
                        width: odd ? 12 : 8,
                        height: odd ? 12 : 8,
                        background: batchColor(batch),
                        boxShadow: odd ? "0 0 0 2px #111215, 0 0 0 4px var(--cx-investigate)" : "none",
                      }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
        {!rows.length && (
          <div className="flex items-center gap-3 text-sm text-cx-muted">
            <Cat mood="ready" size={30} />
            No measured KPIs for this batch yet — run it first.
          </div>
        )}
      </div>
    </Panel>
  );
}

function Galleries({ evidence, tiles, batch }: { evidence: Evidence; tiles: Tile[]; batch: string }) {
  const oddIds = new Set(evidence.odd_images.flatMap((o) => o.image_ids));
  const columns = [
    { name: batch, tiles: tiles.filter((t) => t.batch === batch) },
    { name: evidence.baseline, tiles: tiles.filter((t) => t.batch === evidence.baseline), baseline: true },
  ];
  return (
    <section className="grid grid-cols-2 gap-4">
      {columns.map((col) => (
        <div
          key={col.name}
          className={`flex flex-col gap-3.5 rounded-[22px] border p-5 ${col.baseline ? "border-cx-batch-3/20" : "border-cx-line"}`}
          style={{ background: "rgba(14,15,18,.82)" }}
        >
          <div className="flex items-center justify-between">
            <h2 className="m-0 flex items-center gap-2 text-[15px] font-medium">
              <BatchDot name={col.name} size={10} />
              {batchLabel(col.name)}
              {col.baseline && <span className="font-normal text-cx-faint">baseline</span>}
            </h2>
            <a href={href.library()} className="text-[13px]">
              All {col.tiles.length} tiles
            </a>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {col.tiles.map((tile) => (
              <TileThumb
                key={tile.image_id}
                batch={tile.batch}
                imageId={tile.image_id}
                odd={oddIds.has(tile.image_id)}
              />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

const AUDIENCES = [
  ["operator", "Operator"],
  ["engineer", "Process engineer"],
  ["scientist", "Materials scientist"],
  ["manager", "Manager"],
] as const;

function Explain({ evidence }: { evidence: Evidence }) {
  const [audience, setAudience] = useState<(typeof AUDIENCES)[number][0]>("engineer");
  const text = evidence.explanations[audience];
  const sentences = text.split(/(?<=\.)\s+/).map((s) => s.trim()).filter(Boolean);
  const textClass = audience === "scientist" ? "mono text-[13px] text-cx-text-2" : "text-base text-cx-text";
  return (
    <Panel className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-lg font-medium tracking-[-0.01em]">Explain it to…</h2>
        <Seg
          options={AUDIENCES.map(([value, label]) => ({ value, label }))}
          value={audience}
          onChange={setAudience}
        />
      </div>
      {sentences.length <= 1 ? (
        <p className={`m-0 max-w-[900px] leading-[1.55] ${textClass}`}>
          {text || "Nothing written for this audience."}
        </p>
      ) : (
        <ul className="m-0 flex max-w-[900px] list-none flex-col gap-2 p-0">
          {sentences.map((sentence, i) => (
            <li key={i} className={`flex gap-2.5 leading-[1.55] ${textClass}`}>
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-cx-orange/70" />
              <span>{sentence}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Separates({
  evaluation,
  dict,
}: {
  evaluation: import("../types").AttributionEvaluation | null;
  dict: import("../types").KpiDictionary | null;
}) {
  if (!evaluation) return null;
  const sets = Object.entries(evaluation.family_sets);
  if (!sets.length) return null;
  return (
    <Panel className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="m-0 text-lg font-medium tracking-[-0.01em]">What separates the known batches</h2>
        <span className="text-[13px] text-cx-faint">
          {evaluation.n_images} tiles · held-out strips vs a shuffled-label null
        </span>
      </div>
      <div className="grid grid-cols-4 gap-3">
        {sets.map(([name, fam]) => {
          const acc = fam.balanced_accuracy;
          const p95 = fam.null?.p95;
          return (
            <div key={name} className="panel flex flex-col gap-2 rounded-[16px] border-cx-line-soft bg-black/25 p-4">
              <span className="text-[13px] font-medium">{humanizeFam(name)}</span>
              <span className="mono text-[26px] font-semibold tracking-[-0.02em]">
                {acc != null ? `${Math.round(acc * 100)}%` : "—"}
              </span>
              <div className="relative h-1.5 rounded bg-white/[0.07]">
                {acc != null && (
                  <div className="absolute inset-y-0 left-0 rounded bg-cx-text" style={{ width: `${acc * 100}%` }} />
                )}
                {p95 != null && (
                  <div className="absolute -top-[3px] -bottom-[3px] w-0.5 bg-cx-orange" style={{ left: `${Math.min(100, p95 * 100)}%` }} />
                )}
              </div>
              <span className="text-xs text-cx-faint">
                null p95 {p95 != null ? `${Math.round(p95 * 100)}%` : "—"} ·{" "}
                {fam.above_null ? (
                  <span className="text-cx-accept-text">separates batches</span>
                ) : (
                  <span className="text-cx-muted">within chance</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
      {evaluation.top_features.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-cx-line-soft pt-3">
          <span className="lbl">Top single features</span>
          <div className="flex flex-wrap gap-2">
            {evaluation.top_features.slice(0, 8).map((f) => (
              <span
                key={f.feature}
                title={f.feature}
                className="inline-flex items-center gap-2 rounded-full border border-cx-line bg-white/[0.04] px-3 py-1.5 text-[13px]"
              >
                {featureLabel(f.feature, dict)}
                <span className="mono text-[11px] text-cx-faint">
                  {f.effect_size != null ? `d ${Number(f.effect_size.toPrecision(2))}` : ""}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}

function humanizeFam(name: string): string {
  const known: Record<string, string> = {
    regional: "Regional",
    texture: "Texture",
    kpis: "Whole-tile KPIs",
    material: "All material features",
    imaging: "Imaging",
    particles: "Particles",
    edges: "Stitch edges",
    deep: "Deep (DINOv2)",
  };
  return known[name] ?? name[0].toUpperCase() + name.slice(1);
}
