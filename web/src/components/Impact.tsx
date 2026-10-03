import { useState, type ReactNode } from "react";
import { getConfig, getKpiDictionary, getTiles } from "../api";
import { batchColor, batchLabel, quantityLabel, useApi } from "../lib";
import {
  fmtChange, fmtUnit, getImpact, type Effect, type Impact as ImpactItem, type ImpactReport, type Interval,
} from "../impact";
import { href } from "../router";
import type { KpiDictionary } from "../types";
import { BatchDot, Cat, ErrorPanel, Panel, Spinner } from "./bits";
import ImpactPlot from "./ImpactPlot";
import { WarningStylePicker, WorstBanner, WorstLadder, WorstOnCard, useWarningStyle } from "./ImpactWarnings";

const EFFECT: Record<Effect, { label: string; className: string; bar: string }> = {
  better: {
    label: "Better in these images",
    className: "text-cx-accept-text border border-cx-accept/30 bg-cx-accept/10",
    bar: "var(--cx-accept)",
  },
  worse: {
    label: "Worse in these images",
    className: "text-cx-reject-text border border-cx-reject/30 bg-cx-reject/10",
    bar: "var(--cx-reject)",
  },
  unsettled: {
    label: "Not settled",
    className: "text-cx-investigate-text border border-cx-investigate/30 bg-cx-investigate/10",
    bar: "var(--cx-investigate)",
  },
  similar: {
    label: "About the same",
    className: "text-cx-muted border border-cx-line bg-white/5",
    bar: "var(--cx-text-2)",
  },
};

const INPUT_LABELS: Record<string, string> = {
  graphite_area_frac: "Graphite share of image area (silicon share ÷ Si:graphite ratio)",
  si_d32_um: "Silicon Sauter diameter D32",
};

const PHASES = [
  ["silicon", "Silicon", "var(--cx-phase-si)"],
  ["graphite", "Graphite + binder", "var(--cx-phase-graphite)"],
  ["pores", "Pores", "var(--cx-phase-pore)"],
  ["other", "Other", "var(--cx-phase-binder)"],
] as const;

export default function Impact({ routeBatch, routeBaseline }: { routeBatch?: string; routeBaseline?: string }) {
  const config = useApi(getConfig);
  const tiles = useApi(getTiles);
  const dict = useApi(getKpiDictionary);
  const defaultBaseline = config.data?.baseline ?? null;
  const measured = [...new Set((tiles.data ?? []).filter((t) => t.kpis).map((t) => t.batch))].sort();
  const baseline = routeBaseline && measured.includes(routeBaseline) ? routeBaseline : defaultBaseline;
  const candidates = measured.filter((b) => b !== baseline);
  const batch = routeBatch && candidates.includes(routeBatch) ? routeBatch : candidates[0];
  const report = useApi(
    () => (batch && baseline ? getImpact(batch, baseline) : Promise.resolve(null)),
    [batch, baseline],
  );
  const go = (b: string | undefined, r: string | null) =>
    (window.location.hash = href.impact(b, r && r !== defaultBaseline ? r : undefined));

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-7 px-10 py-10">
      <div className="flex flex-col gap-2.5">
        <div className="lbl flex items-center gap-2 text-cx-orange-text">
          Labs · Wear &amp; impact
          <span className="mono rounded-md border border-cx-orange/40 px-1.5 py-0.5 text-[10px]">EXPERIMENTAL</span>
        </div>
        <h1 className="m-0 text-[40px] leading-[1.1] font-semibold tracking-[-0.03em]">
          What could this batch mean for the cell?
        </h1>
        <p className="m-0 max-w-[760px] text-[15px] leading-relaxed text-cx-muted">
          Textbook relations applied to the measured microstructure: which way capacity, swelling, fast charging
          and wear would move against the baseline, and roughly how far. Never part of the verdict.
        </p>
      </div>

      <div className="glass flex flex-wrap items-center gap-2.5 rounded-[20px] p-2.5">
        <div className="flex flex-wrap gap-1.5">
          {candidates.map((b) => (
            <button key={b} type="button" onClick={() => go(b, baseline)}
              className={`flex min-h-12 cursor-pointer items-center gap-2 rounded-[14px] border px-4 text-[15px] ${
                b === batch ? "border-cx-line bg-white/[0.09] text-cx-text-strong" : "border-transparent bg-transparent text-cx-muted hover:text-cx-text"
              }`}
              style={{ font: "inherit" }}
              aria-pressed={b === batch}>
              <BatchDot name={b} size={9} />
              {batchLabel(b)}
            </button>
          ))}
        </div>
        <span className="mono px-1 text-[13px] text-cx-faint">vs</span>
        {baseline && (
          <label className="flex min-h-12 items-center gap-2.5 rounded-[14px] border border-cx-batch-3/35 bg-cx-batch-3/[0.08] px-4">
            <span className="lbl text-[10px] text-cx-batch-3">Baseline</span>
            <select value={baseline} onChange={(e) => go(batch === e.target.value ? undefined : batch, e.target.value)}
              className="cursor-pointer border-0 bg-transparent text-[15px] font-medium text-cx-text outline-none"
              style={{ font: "inherit" }}>
              {measured.map((b) => (
                <option key={b} value={b} className="bg-cx-bg">
                  {batchLabel(b)}{b === defaultBaseline ? " (default)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {tiles.error && <ErrorPanel title="Could not load tiles" message={tiles.error} />}
      {tiles.data && !measured.length && (
        <ErrorPanel title="No measured batches" message="Measure the images first; impact reads out/kpis.csv."
          command="uv run python -m qc.measure" />
      )}
      {tiles.data && config.data && measured.length > 0 && !baseline && (
        <ErrorPanel title="The baseline is not measured" message={`${batchLabel(defaultBaseline ?? "The baseline")} has no rows in out/kpis.csv; measure it or pick another baseline.`}
          command="uv run python -m qc.measure" />
      )}
      {report.error && <ErrorPanel title="Could not compute the impact" message={report.error} />}
      {!report.data && !report.error && batch && baseline && (
        <div className="flex items-center gap-3 text-cx-muted"><Spinner /> Working out the impact…</div>
      )}
      {report.data && <Report report={report.data} dict={dict.data} />}
    </div>
  );
}

function Report({ report, dict }: { report: ImpactReport; dict: KpiDictionary | null }) {
  const { batch, baseline } = report;
  const [warnings, setWarnings] = useWarningStyle();
  return (
    <>
      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <Panel className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div className="lbl">In short</div>
            <span className="mono rounded-md border border-cx-line px-1.5 py-0.5 text-[10px] text-cx-faint">FIXED TEMPLATE · NO LANGUAGE MODEL</span>
          </div>
          <div className="flex items-start gap-3">
            <Cat mood="sniffing" size={40} />
            <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[15px] leading-relaxed">
              {report.summary.map((s, i) => (
                <li key={i} className={i === 0 ? "text-cx-muted" : "text-cx-text"}>{s}</li>
              ))}
            </ul>
          </div>
          <p className="m-0 border-t border-cx-line-soft pt-3 text-[12.5px] leading-relaxed text-cx-faint">
            {report.label} {report.n_images[batch]} images in {report.n_strips[batch]} strips against{" "}
            {report.n_images[baseline]} in {report.n_strips[baseline]}; {Math.round(report.interval * 100)}% intervals
            from sampling only (see the end of the page).
          </p>
        </Panel>
        <Panel className="flex flex-col gap-3">
          <div className="lbl">What the section is made of</div>
          {[baseline, batch].map((name) => (
            <div key={name} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 text-sm"><BatchDot name={name} />{batchLabel(name)}</div>
              <div className="flex h-5 overflow-hidden rounded-md" role="img"
                aria-label={PHASES.map(([key, label]) => `${label} ${fmtUnit(report.composition[name]?.[key], "fraction")}`).join(", ")}>
                {PHASES.map(([key, label, color]) => {
                  const v = report.composition[name]?.[key] ?? 0;
                  return v > 0 ? <div key={key} title={`${label}: ${fmtUnit(v, "fraction")}`} style={{ width: `${v * 100}%`, background: color }} /> : null;
                })}
              </div>
              <div className="mono text-[11.5px] text-cx-faint">
                Silicon {fmtUnit(report.composition[name]?.silicon, "fraction")} · pores {fmtUnit(report.composition[name]?.pores, "fraction")}
              </div>
            </div>
          ))}
          <div className="mono flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-cx-faint">
            {PHASES.map(([key, label, color]) => (
              <span key={key} className="flex items-center gap-1">
                <span style={{ width: 7, height: 7, borderRadius: 2, background: color }} />{label}
              </span>
            ))}
          </div>
          <p className="m-0 text-xs leading-relaxed text-cx-faint">
            Area shares of the imaged section. Silicon is a small share but drives most of what changes.
          </p>
        </Panel>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-[22px] font-semibold tracking-[-0.015em]">What could change in the cell</h2>
        <WarningStylePicker value={warnings} onChange={setWarnings} />
      </div>
      {warnings === "banner" && <WorstBanner report={report} />}

      <div className="grid gap-5 lg:grid-cols-2">
        {report.impacts.map((impact) => (
          <ImpactCard key={impact.id} impact={impact} report={report} dict={dict} showWorst={warnings === "cards"} />
        ))}
      </div>

      {warnings === "ladder" && <WorstLadder report={report} />}

      <ScenarioPanel report={report} />

      <Panel className="flex flex-col gap-3">
        <div className="lbl">What this cannot tell you</div>
        <ul className="m-0 flex flex-col gap-1.5 pl-5 text-sm leading-relaxed text-cx-muted">
          {report.caveats.map((c) => <li key={c}>{c}</li>)}
        </ul>
        <details className="text-sm">
          <summary className="cursor-pointer text-cx-text-2">References</summary>
          <ul className="mt-2 flex flex-col gap-1.5 pl-5 text-[13px] leading-relaxed text-cx-faint">
            {Object.entries(report.references).map(([key, ref]) => (
              <li key={key} id={`ref-${key}`}><span className="mono text-cx-muted">[{key}]</span> {linkify(ref)}</li>
            ))}
          </ul>
        </details>
      </Panel>
    </>
  );
}

function linkify(text: string) {
  const m = text.match(/(https?:\/\/\S+)$/);
  if (!m) return text;
  return <>{text.slice(0, m.index)}<a href={m[1]} target="_blank" rel="noreferrer">{m[1].replace(/^https?:\/\//, "")}</a></>;
}

function ChangeBar({ change, effect, tol, higherIs }: { change: Interval; effect: Effect; tol: number; higherIs: "better" | "worse" }) {
  const ext = Math.max(Math.abs(change.low ?? 0), Math.abs(change.high ?? 0), tol * 2);
  const span = [0.1, 0.25, 0.5, 1, 2, 5].find((s) => s >= ext) ?? 5;
  const pos = (v: number) => ((Math.max(-span, Math.min(span, v)) + span) / (2 * span)) * 100;
  const color = EFFECT[effect].bar;
  return (
    <div className="flex flex-col gap-1">
      <div className="relative h-7">
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/[0.06]" />
        <div className="absolute top-1/2 h-3 -translate-y-1/2 rounded-sm bg-white/[0.08]"
          style={{ left: `${pos(-tol)}%`, width: `${pos(tol) - pos(-tol)}%` }} title={`±${Math.round(tol * 100)}%: about the same`} />
        <div className="absolute inset-y-0 w-px bg-cx-faint" style={{ left: "50%" }} />
        {change.low != null && change.high != null && (
          <div className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full"
            style={{ left: `${pos(change.low)}%`, width: `${Math.max(pos(change.high) - pos(change.low), 0.8)}%`, background: color }} />
        )}
        {change.value != null && (
          <div className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ left: `${pos(change.value)}%`, background: "var(--cx-text-strong)", boxShadow: "0 0 0 3px #111215" }} />
        )}
      </div>
      <div className="mono grid grid-cols-3 text-[10.5px] text-cx-faint">
        <span>−{Math.round(span * 100)}%</span>
        <span className="text-center">0</span>
        <span className="text-right">+{Math.round(span * 100)}%</span>
        <span>← {higherIs === "better" ? "worse" : "better"}</span>
        <span />
        <span className="text-right">{higherIs === "better" ? "better" : "worse"} →</span>
      </div>
    </div>
  );
}

function RangeText({ range, unit }: { range: Interval; unit: string }) {
  return (
    <>
      <span className="text-cx-text">{fmtUnit(range.value, unit)}</span>
      <span className="text-cx-faint"> ({fmtUnit(range.low, unit)} to {fmtUnit(range.high, unit)})</span>
    </>
  );
}

function ImpactCard({ impact, report, dict, showWorst }: {
  impact: ImpactItem; report: ImpactReport; dict: KpiDictionary | null; showWorst: boolean;
}) {
  const [open, setOpen] = useState(false);
  const effect = EFFECT[impact.effect];
  const { batch, baseline } = report;
  return (
    <Panel className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="m-0 text-[19px] font-semibold tracking-[-0.01em]">{impact.property}</h3>
          <div className="text-[13px] text-cx-faint">{impact.measure}</div>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-medium ${effect.className}`}>{effect.label}</span>
      </div>

      <div className="flex items-baseline gap-3">
        <span className="text-[30px] font-semibold tracking-[-0.02em]" style={{ color: effect.bar }}>
          {fmtChange(impact.change.value)}
        </span>
        <span className="mono text-[13px] text-cx-faint">
          {fmtChange(impact.change.low)} to {fmtChange(impact.change.high)} vs {batchLabel(baseline)}
        </span>
      </div>
      <ChangeBar change={impact.change} effect={impact.effect} tol={report.similar_within} higherIs={impact.higher_is} />

      {impact.absolute ? (
        <div className="grid grid-cols-2 gap-3 text-[13px]">
          {[baseline, batch].map((name) => (
            <div key={name} className="flex flex-col gap-0.5">
              <span className="flex items-center gap-1.5 text-cx-faint"><BatchDot name={name} size={7} />{batchLabel(name)}</span>
              <span className="mono"><RangeText range={name === batch ? impact.batch : impact.baseline} unit={impact.unit} /></span>
            </div>
          ))}
        </div>
      ) : (
        <p className="m-0 text-[12.5px] text-cx-faint">Read the change: the value for each batch is not meaningful on its own (see the caveats).</p>
      )}

      <p className="m-0 text-[14.5px] leading-relaxed text-cx-text">{impact.consequence}</p>
      <p className="m-0 text-[13px] leading-relaxed text-cx-muted">{impact.mechanism}</p>

      {impact.facts.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-[12px] border border-cx-line-soft bg-white/[0.02] p-3">
          {impact.facts.map((f) => (
            <div key={f.label} className="flex flex-col gap-0.5 text-[12.5px]">
              <span className="text-cx-muted">{f.label}</span>
              <span className="mono flex flex-wrap gap-x-4">
                {[baseline, batch].map((name) => (
                  <span key={name} style={{ color: batchColor(name) }}>
                    {batchLabel(name)}: <RangeText range={name === batch ? f.batch : f.baseline} unit={f.unit} />
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      )}

      {showWorst && <WorstOnCard impact={impact} />}

      <button type="button" className="btn w-fit" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? "Hide" : "Show"} the textbook relation
      </button>
      {open && (
        <div className="flex flex-col gap-4 border-t border-cx-line-soft pt-4">
          {impact.curve && (
            <div className="flex flex-col gap-2">
              <div className="text-[14px] font-medium">{impact.curve.title}</div>
              <ImpactPlot xLabel={impact.curve.x_label} xUnit={impact.curve.x_unit} yLabel={impact.curve.y_label}
                yUnit={impact.curve.y_unit} xLog={impact.curve.x_log} yLog={impact.curve.y_log}
                lines={impact.curve.lines} markers={impact.curve.markers} thresholds={impact.curve.thresholds}
                markerNote={`Dots: batch means; bars: ${Math.round(report.interval * 100)}% intervals`} />
            </div>
          )}
          <code className="mono w-fit rounded-lg border border-cx-line bg-black/40 px-3 py-2 text-[12.5px] text-cx-text-2">{impact.formula}</code>
          <Detail title="Measured inputs">
            {impact.inputs.map((i) => (
              <li key={i.kpi}>
                {INPUT_LABELS[i.kpi] ?? quantityLabel(i.kpi, dict)}:{" "}
                <span className="mono">
                  {batchLabel(baseline)} <RangeText range={i.baseline} unit={i.unit} />, {batchLabel(batch)}{" "}
                  <RangeText range={i.batch} unit={i.unit} />
                </span>
              </li>
            ))}
          </Detail>
          <Detail title="Assumptions">{impact.assumptions.map((a) => <li key={a}>{a}</li>)}</Detail>
          <Detail title="Caveats">{impact.caveats.map((c) => <li key={c}>{c}</li>)}</Detail>
          <div className="text-[12px] text-cx-faint">
            Sources: {impact.refs.map((r, i) => (
              <span key={r}>{i > 0 && ", "}<a href={`#ref-${r}`} onClick={(e) => {
                e.preventDefault();
                document.getElementById(`ref-${r}`)?.closest("details")?.setAttribute("open", "");
                document.getElementById(`ref-${r}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
              }}>{r}</a></span>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}

function Detail({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="lbl text-[10px]">{title}</div>
      <ul className="m-0 flex flex-col gap-1 pl-5 text-[13px] leading-relaxed text-cx-muted">{children}</ul>
    </div>
  );
}

function ScenarioPanel({ report }: { report: ImpactReport }) {
  const s = report.scenario;
  if (!s)
    return (
      <Panel className="flex flex-col gap-1">
        <div className="lbl">Wear over time · scenario</div>
        <p className="m-0 text-sm text-cx-muted">Not drawn: too few strips, or the inputs it needs are missing.</p>
      </Panel>
    );
  const zip = (ys: number[]) => s.cycles.map((c, i) => [c, ys[i]] as [number, number]);
  const color = batchColor(report.batch);
  const fmtN = (v: number | null) => (v == null ? "—" : Math.round(v).toLocaleString());
  const ratio = (v: number | null) => (v == null ? "—" : `${Number(v.toPrecision(2))}×`);
  return (
    <Panel className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="lbl">Wear over time · scenario</div>
          <h2 className="m-0 text-[19px] font-semibold tracking-[-0.01em]">
            {batchLabel(report.batch)} would fade {ratio(s.fade_scale.low)} to {ratio(s.fade_scale.high)} as fast as{" "}
            {batchLabel(report.baseline)}
          </h2>
          <div className="text-[13px] text-cx-faint">
            For the picture only: if {batchLabel(report.baseline)} reached 80% after {fmtN(s.baseline_cycles_to_80)} cycles,{" "}
            {batchLabel(report.batch)} would get there after about {fmtN(s.cycles_to_80.low)} to {fmtN(s.cycles_to_80.high)}.
          </div>
        </div>
        <span className="mono rounded-md border border-cx-line px-1.5 py-0.5 text-[10px] text-cx-faint">SCENARIO · NOT A PREDICTION</span>
      </div>
      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <ImpactPlot xLabel="Cycles" xUnit="" yLabel="Capacity retained" yUnit="fraction"
          lines={[
            { name: `${batchLabel(report.baseline)} (assumed)`, points: zip(s.baseline), batch: report.baseline },
            { name: `${batchLabel(report.batch)}, middle of the range`, points: zip(s.batch_mid), batch: report.batch, dash: true },
          ]}
          bands={[{ lower: zip(s.batch_low), upper: zip(s.batch_high), color }]}
          thresholds={[{ axis: "y", value: 0.8, label: "80%: a common end-of-life mark" }]}
          yMin={0.5} />
        <Detail title="How the scenario is built">{s.assumptions.map((a) => <li key={a}>{a}</li>)}</Detail>
      </div>
    </Panel>
  );
}
