import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  askClaude, getConfig, getEvidence, getGuide, getKpiDictionary, getSettings, getTiles, imageUrl, listBatches,
  runBatch, uploadBatch,
} from "../api";
import {
  batchColor, batchLabel, baselineBand, dictEntry, dropTwinShare, fmt, fmtPair, fmtRange, fmtSigma, imagingWords, isFixture,
  joinAnd, isUploadBatch, MIN_BASELINE_TILES, oddByTile, plural, quantityLabel, quantityNote, rankedFindings, shortHash, sigmaOf, statusChip, useApi,
} from "../lib";
import { href } from "../router";
import type {
  BatchSummary, Config, Difference, Evidence, Guide, GuideTarget, KpiDictionary, Settings, Tile,
} from "../types";
import {
  BatchDot, Cat, Details, ErrorPanel, Folds, IconCheck, IconWarn, Panel, Seg, ShiftBand, SlotText, Spinner,
  VerdictPill,
} from "./bits";
import { Peekable, type PeekItem } from "./Peek";

const KPI_ORDER = [
  "si_graphite_ratio", "si_area_frac", "si_d50_um", "si_d90_um", "si_internal_void_frac",
  "si_contrast_ratio", "si_fragments_per_1e4um2", "si_dispersion_cv", "si_agglomerate_frac",
  "si_corr_length_um", "porosity_apparent", "graphite_chord_um", "graphite_anisotropy",
  "pore_chord_um", "pore_connectivity",
];

const VERDICT_TINT: Record<string, string> = {
  ACCEPT: "rgba(74,222,128,.07)",
  INVESTIGATE: "rgba(250,204,21,.07)",
  REJECT: "rgba(248,113,113,.08)",
};

interface RunState {
  batch: string;
  baseline: string | null;
  phase: "uploading" | "measuring";
  done: number;
  total: number;
  tile: string | null;
  error?: string;
}

interface Ctx {
  evidence: Evidence;
  config: Config;
  dict: KpiDictionary | null;
  tiles: Tile[];
}

export default function Compare({ routeBatch, routeBaseline }: { routeBatch?: string; routeBaseline?: string }) {
  const config = useApi(getConfig);
  const settings = useApi(getSettings);
  const [reload, setReload] = useState(0);
  const batches = useApi(listBatches, [reload], { keep: true });
  const tiles = useApi(getTiles, [reload], { keep: true });
  const dict = useApi(getKpiDictionary);
  const [run, setRun] = useState<RunState | null>(null);
  const [picked, setPicked] = useState<string | null>(null);  // a one-off baseline chosen in the picker this visit
  const folder = useRef<HTMLInputElement>(null);

  const defaultBaseline = config.data?.baseline ?? null;
  const candidates = (batches.data ?? []).filter((b) => !isFixture(b.name) || b.name === routeBatch);
  const selected =
    routeBatch && candidates.some((b) => b.name === routeBatch)
      ? routeBatch
      : candidates.find((b) => b.name !== defaultBaseline && b.verdict)?.name ??
        candidates.find((b) => b.verdict)?.name ??
        candidates[0]?.name;
  const oneOff =
    routeBaseline && routeBaseline !== defaultBaseline && routeBaseline !== selected && candidates.some((b) => b.name === routeBaseline)
      ? routeBaseline
      : null;
  const baseline = oneOff ?? defaultBaseline;
  const unknown = !!routeBatch && !!batches.data && !candidates.some((b) => b.name === routeBatch);
  const neverRun = !oneOff && !!selected && !candidates.find((b) => b.name === selected)?.verdict;
  const evidence = useApi(
    () => (selected && defaultBaseline && !neverRun ? getEvidence(selected, oneOff) : Promise.resolve(null)),
    [selected, oneOff, defaultBaseline, neverRun, reload],
  );
  const missing = neverRun || evidence.status === 404;

  // a failed run belongs to the comparison it was for
  useEffect(() => setRun((r) => (r?.error ? null : r)), [selected, oneOff]);

  async function startRun(batch: string, against: string | null, files?: File[]) {
    setRun({ batch, baseline: against, phase: files ? "uploading" : "measuring", done: 0, total: 0, tile: null });
    try {
      if (files) await uploadBatch(batch, files);
      setRun((r) => r && { ...r, phase: "measuring" });
      await runBatch(batch, against, (event) => {
        if (event.type === "progress")
          setRun((r) => r && { ...r, done: event.done, total: event.total, tile: event.tile });
        if (event.type === "error") setRun((r) => r && { ...r, error: event.message });
        if (event.type === "done") {
          setRun(null);
          setReload((n) => n + 1);
          window.location.hash = href.compare(event.evidence.batch, against);
        }
      });
    } catch (err) {
      setRun((r) => r && { ...r, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // A one-off baseline picked in the picker runs right away if it hasn't been compared yet; just opening such
  // a link doesn't start a heavy run (it offers "Compare now"). The default baseline stays as it is.
  const hasImages = (name: string | null) => !!name && !!candidates.find((b) => b.name === name)?.has_images;
  useEffect(() => {
    if (oneOff && picked === oneOff && selected && missing && !run && hasImages(selected) && hasImages(oneOff)) {
      setPicked(null);
      void startRun(selected, oneOff);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oneOff, selected, missing, picked]);

  const ready = evidence.data && selected && config.data && evidence.data.baseline === baseline && evidence.data.batch === selected;

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-6 px-10 pt-9 pb-16">
      <div className="flex flex-wrap items-center gap-2.5">
        <BatchPicker
          batches={candidates}
          selected={selected}
          tiles={tiles.data ?? []}
          onPick={(name) => (window.location.hash = href.compare(name, name === oneOff ? null : oneOff))}
        />
        <span className="mono px-0.5 text-[13px] text-cx-faint">vs</span>
        {baseline && (
          <BaselinePicker
            batches={candidates.filter(
              (b) => b.name === baseline || (b.has_images && !isUploadBatch(b.name) && (tiles.data ?? []).filter((t) => t.batch === b.name).length >= MIN_BASELINE_TILES),
            )}
            selected={selected}
            baseline={baseline}
            defaultBaseline={defaultBaseline}
            tiles={tiles.data ?? []}
            onPick={(name) => {
              setPicked(name === defaultBaseline ? null : name);
              window.location.hash = href.compare(selected, name === defaultBaseline ? null : name);
            }}
          />
        )}
        {oneOff && defaultBaseline && (
          <span className="inline-flex items-center gap-2.5 text-[13px] text-cx-text-2">
            For this comparison only.{" "}
            {settings.data?.rules_frozen_commit ? (
              <span className="text-cx-faint" title="Rules are frozen: the default baseline can't change">Default locked</span>
            ) : (
              <a href={href.settings()}>Make default</a>
            )}
            <a href={href.compare(selected)} className="text-cx-muted">
              Back to {batchLabel(defaultBaseline)}
            </a>
          </span>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          {selected && !missing && hasImages(selected) && hasImages(baseline) && (
            <button className="btn" type="button" disabled={!!run && !run.error} onClick={() => void startRun(selected, oneOff)}>
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
              // the folder becomes the batch name: letters, digits, _ . - only (the API refuses the rest)
              const name = files[0]?.webkitRelativePath.split("/")[0].replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^[_.-]+/, "");
              if (name) void startRun(name, null, files);
              e.target.value = "";
            }}
          />
          <button className="btn" type="button" disabled={!!run && !run.error} onClick={() => folder.current?.click()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
            </svg>
            Upload a new batch
          </button>
        </div>
      </div>

      {run && !run.error && (
        <Panel className="flex items-center gap-4">
          <Spinner size={20} />
          <div className="flex-1">
            <div className="text-sm">
              {run.phase === "uploading"
                ? `Uploading ${batchLabel(run.batch)}…`
                : `Comparing ${batchLabel(run.batch)} with ${batchLabel(run.baseline ?? defaultBaseline ?? "the baseline")}`}
            </div>
            <div className="mono text-xs text-cx-faint">
              {run.total ? `measuring ${run.done}/${run.total} · ${run.tile ?? ""}` : "starting up"}
            </div>
            {/* the same line as Identify's scan: real per-tile progress from /api/runs, indeterminate until the first tile */}
            <div className="relative mt-2.5 h-1 overflow-hidden rounded-full bg-white/[0.07]" role="progressbar" aria-valuemin={0} aria-valuemax={run.total || undefined} aria-valuenow={run.total ? run.done : undefined}>
              {run.total ? (
                <div className="absolute inset-y-0 left-0 rounded-full bg-cx-orange transition-[width] duration-300" style={{ width: `${(100 * run.done) / run.total}%` }} />
              ) : (
                <div className="sweep absolute inset-y-0 w-1/5 rounded-full bg-cx-orange/70" />
              )}
            </div>
          </div>
        </Panel>
      )}
      {run?.error && <ErrorPanel title="Run failed" message={run.error} />}

      {unknown && (
        <ErrorPanel title={`No batch called ${routeBatch}`} message={`There's no folder data/${routeBatch}. Showing ${selected ? batchLabel(selected) : "nothing"} instead.`} />
      )}
      {(evidence.error || missing) && !run && (
        missing && selected && baseline ? (
          <Panel className="flex flex-wrap items-center gap-4 text-sm text-cx-muted">
            <Cat mood="ready" size={34} />
            <span className="flex-1">
              {batchLabel(selected)} hasn't been compared with {batchLabel(baseline)} yet.
            </span>
            {hasImages(selected) && hasImages(baseline) && (
              <button className="btn pri" type="button" onClick={() => void startRun(selected, oneOff)}>
                Compare now
              </button>
            )}
          </Panel>
        ) : (
          <ErrorPanel title={`No evidence for ${selected ?? "this batch"}`} message={evidence.error ?? ""} />
        )
      )}

      {!selected && batches.data && (
        <Panel className="flex items-center gap-3 text-sm text-cx-muted">
          <Cat mood="ready" size={34} />
          Pick a batch, or upload a folder of tiles to compare it against the baseline.
        </Panel>
      )}

      {ready && (
        <Result
          key={`${selected}/${baseline}/${evidence.data!.provenance?.created_at ?? ""}`}
          ctx={{ evidence: evidence.data!, config: config.data!, dict: dict.data, tiles: tiles.data ?? [] }}
          settings={settings.data}
          oneOff={oneOff}
        />
      )}
    </div>
  );
}

const NOT_YET = "Claude hasn't written this one yet.";  // qc/guide.py: nothing cached, nothing asked

function Result({ ctx, settings, oneOff }: { ctx: Ctx; settings: Settings | null; oneOff: string | null }) {
  const { evidence } = ctx;
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [step, setStep] = useState<number | null>(null);
  const [prefer, setPrefer] = useState<"claude" | "template">("claude");
  const template = useApi(() => getGuide(evidence.batch, oneOff, "template"));
  const claudeOn = !!settings?.claude.available;
  const cached = useApi(() => (claudeOn ? getGuide(evidence.batch, oneOff, "claude") : Promise.resolve(null)), [claudeOn]);
  const [asked, setAsked] = useState<{ busy: boolean; data: Guide | null; error: string | null }>({ busy: false, data: null, error: null });
  const claudeResult = asked.data ?? cached.data;
  const claudeOk = claudeResult?.source === "claude" ? claudeResult : null;
  async function ask() {
    setAsked({ busy: true, data: null, error: null });
    try {
      const data = await askClaude(evidence.batch, oneOff);
      setAsked({ busy: false, data, error: null });
      setPrefer("claude");
    } catch (err) {
      setAsked({ busy: false, data: null, error: err instanceof Error ? err.message : String(err) });
    }
  }
  const guide = prefer === "claude" && claudeOk ? claudeOk : template.data;
  const steps = guide?.steps ?? [];
  const current = step != null ? steps[step] : null;
  const target = current?.target ?? null;

  // "tiles" points at the cards' odd tiles, so the walkthrough only ever moves down the page
  const section = target === "tiles" ? "moved" : target;
  useEffect(() => {
    if (!section) return;
    const el = document.querySelector(`[data-tour="${section}"]`);
    window.setTimeout(() => el?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
  }, [step, section]);

  useEffect(() => {
    if (step == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      if (e.key === "ArrowRight") (step >= steps.length - 1 ? finish() : setStep(step + 1));
      if (e.key === "ArrowLeft") setStep((s) => (s == null ? s : Math.max(0, s - 1)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, steps.length]);

  const finish = () => {
    setStep(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
    document.querySelector<HTMLButtonElement>("[data-walkthrough-start]")?.focus({ preventScroll: true });
  };
  const tour = (id?: GuideTarget) => (section == null ? "" : id === section ? "tour-on" : "tour-off");
  const card = (id: GuideTarget) =>
    current && guide && id === section ? (
      <TourCard
        guide={guide}
        index={step!}
        onBack={() => setStep((s) => Math.max(0, (s ?? 0) - 1))}
        onNext={() => (step != null && step >= steps.length - 1 ? finish() : setStep((s) => (s ?? 0) + 1))}
        onExit={finish}
      />
    ) : null;

  return (
    <>
      <div data-tour="verdict" className={`tour-section scroll-mt-6 ${tour("verdict")}`}>
        {card("verdict")}
        <Answer evidence={evidence} />
      </div>
      <div className={`tour-section ${tour()}`}>
        <Caveats ctx={ctx} />
      </div>
      <div className={`tour-section ${tour()}`}>
        <GuidePanel
          guide={guide}
          loading={!template.data && !template.error}
          error={template.error}
          claudeOn={claudeOn}
          asking={asked.busy}
          onAsk={claudeOn && !claudeOk ? () => void ask() : null}
          claudeFallback={asked.error ?? (claudeResult?.source === "template" && claudeResult.fallback_reason !== NOT_YET ? claudeResult.fallback_reason : null)}
          canSwitch={!!claudeOk}
          prefer={prefer}
          onPrefer={setPrefer}
          onStart={() => steps.length && setStep(0)}
          touring={step != null}
          settings={settings}
        />
      </div>
      <div data-tour="moved" className={`tour-section scroll-mt-6 ${tour("moved")}`}>
        {card("moved")}
        <LookHere ctx={ctx} />
      </div>
      <div className={`tour-section ${tour()}`}>
        <WithinTolerance ctx={ctx} />
      </div>
      <div data-tour="next" className={`tour-section scroll-mt-6 ${tour("next")}`}>
        {card("next")}
        <NextSteps evidence={evidence} />
      </div>
      <div className={`tour-section ${tour()}`}>
        <Everything ctx={ctx} open={open} onToggle={(id) => setOpen((o) => ({ ...o, [id]: !o[id] }))} />
      </div>
    </>
  );
}

function BatchPicker({
  batches,
  selected,
  tiles,
  onPick,
}: {
  batches: BatchSummary[];
  selected: string | undefined;
  tiles: Tile[];
  onPick: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = batches.find((b) => b.name === selected);
  return (
    <Dropdown
      open={open}
      setOpen={setOpen}
      label="Batch"
      className="border-cx-line bg-white/[0.06]"
      value={
        <>
          {current && <BatchDot name={current.name} size={10} />}
          {current ? batchLabel(current.name) : "Choose…"}
          <span className="text-[13px] font-normal text-cx-faint">
            {plural(tiles.filter((t) => t.batch === selected).length, "tile")}
          </span>
        </>
      }
    >
      <div className="lbl px-2.5 pt-2 pb-1.5">Compare</div>
      {batches.map((b) => (
        <button
          key={b.name}
          type="button"
          role="option"
          aria-selected={b.name === selected}
          onClick={() => {
            setOpen(false);
            onPick(b.name);
          }}
          className={`flex min-h-11 cursor-pointer items-center gap-2.5 rounded-[10px] border-0 px-2.5 text-left text-sm text-cx-text hover:bg-white/5 ${b.name === selected ? "bg-white/[0.08]" : "bg-transparent"}`}
        >
          <BatchDot name={b.name} size={10} />
          <span className="flex-1">{batchLabel(b.name)}</span>
          <span className="text-xs text-cx-faint">
            {plural(tiles.filter((t) => t.batch === b.name).length, "tile")}{b.verdict ? "" : " · not run"}
          </span>
        </button>
      ))}
    </Dropdown>
  );
}

function BaselinePicker({
  batches,
  selected,
  baseline,
  defaultBaseline,
  tiles,
  onPick,
}: {
  batches: BatchSummary[];
  selected: string | undefined;
  baseline: string;
  defaultBaseline: string | null;
  tiles: Tile[];
  onPick: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const isDefault = baseline === defaultBaseline;
  const count = (name: string) => tiles.filter((t) => t.batch === name).length;
  return (
    <Dropdown
      open={open}
      setOpen={setOpen}
      label="Baseline"
      labelClass="text-[#5EEAD4]"
      className={isDefault ? "border-cx-batch-3/35 bg-cx-batch-3/[0.08]" : "border-cx-batch-2/40 bg-cx-batch-2/[0.08]"}
      value={
        <>
          <BatchDot name={baseline} size={10} />
          {batchLabel(baseline)}
          <span className="text-[13px] font-normal text-cx-faint">
            {plural(count(baseline), "tile")} · {isDefault ? "default" : "one-off"}
          </span>
        </>
      }
    >
      <div className="lbl px-2.5 pt-2 pb-1.5">Compare against</div>
      {batches.map((b) => {
        const disabled = b.name === selected;
        return (
          <button
            key={b.name}
            type="button"
            role="option"
            aria-selected={b.name === baseline}
            aria-disabled={disabled}
            disabled={disabled}
            onClick={() => {
              setOpen(false);
              onPick(b.name);
            }}
            className={`flex min-h-11 items-center gap-2.5 rounded-[10px] border-0 px-2.5 text-left text-sm text-cx-text ${disabled ? "cursor-not-allowed opacity-45" : "cursor-pointer hover:bg-white/5"} ${b.name === baseline ? "bg-white/[0.08]" : "bg-transparent"}`}
          >
            <BatchDot name={b.name} size={10} />
            <span className="flex-1">{batchLabel(b.name)}</span>
            {b.name === defaultBaseline && (
              <span className="mono rounded-[5px] border border-cx-batch-3/45 px-1.5 py-0.5 text-[10px] text-[#5EEAD4]">DEFAULT</span>
            )}
            <span className="text-xs text-cx-faint">{disabled ? "being compared" : plural(count(b.name), "tile")}</span>
          </button>
        );
      })}
      <a
        href={href.settings()}
        onClick={() => setOpen(false)}
        className="mt-1 flex min-h-10 items-center justify-between border-t border-cx-line px-2.5 text-[13px]"
      >
        Change the default baseline
        <span aria-hidden>→</span>
      </a>
    </Dropdown>
  );
}

/** A picker button with a floating glass list; closes on outside click and Escape. */
function Dropdown({
  open,
  setOpen,
  label,
  labelClass = "",
  value,
  className,
  children,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  label: string;
  labelClass?: string;
  value: ReactNode;
  className: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={`flex min-h-[52px] cursor-pointer items-center gap-3 rounded-[14px] border px-3.5 text-cx-text ${className}`}
        style={{ font: "inherit" }}
      >
        <span className="flex flex-col items-start gap-0.5">
          <span className={`lbl text-[10px] ${labelClass}`}>{label}</span>
          <span className="flex items-center gap-2 text-[15px] font-medium">{value}</span>
        </span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={label}
          className="glass absolute top-[60px] left-0 z-20 flex w-[300px] flex-col gap-0.5 rounded-[18px] p-2"
          style={{ background: "rgba(24,25,29,.9)" }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function Answer({ evidence }: { evidence: Evidence }) {
  return (
    <section
      aria-label="Answer"
      className="glass flex flex-wrap items-center gap-x-7 gap-y-4 rounded-[24px] px-7 py-6"
      style={{ background: `linear-gradient(180deg, ${VERDICT_TINT[evidence.verdict]}, rgba(255,255,255,.02))` }}
    >
      <VerdictPill verdict={evidence.verdict} />
      <p className="m-0 flex-[1_1_480px] text-[22px] leading-[1.35] font-medium tracking-[-0.015em]">
        {evidence.explanations.summary}
      </p>
    </section>
  );
}

/** Imaging changed, controls not run, rules not frozen: always shown, never ranked. */
function Caveats({ ctx }: { ctx: Ctx }) {
  const { evidence, dict } = ctx;
  const paused = evidence.differences.filter((d) => d.note === "imaging changed").map((d) => quantityLabel(d.name, dict).toLowerCase());
  const items: { key: string; title: string; body: ReactNode; details?: ReactNode }[] = [];
  if (evidence.imaging.changed)
    items.push({
      key: "imaging",
      title: "Imaging differs from the baseline.",
      body: `${imagingWords(evidence.imaging.changed_metrics)}, so ${joinAnd(paused) || "brightness-based properties"} ${paused.length === 1 ? "is" : "are"} paused. Check the microscope settings.`,
      details: (
        <span className="mono flex flex-wrap gap-1.5 pt-1 text-[11px] text-cx-faint">
          {evidence.imaging.changed_metrics.map((m) => (
            <span key={m} className="rounded border border-cx-line px-1.5 py-0.5">{m}</span>
          ))}
        </span>
      ),
    });
  if (evidence.batch === evidence.baseline)
    items.push({
      key: "self",
      title: "Self-check: the baseline compared with itself.",
      body: "It checks the method, not a delivery: every tile is on both sides.",
    });
  if (!evidence.controls.ran)
    items.push({
      key: "controls",
      title: "Controls not run.",
      body: "Catalyst only says Accept after its known-answer controls pass, so this comparison can't come out Accept yet.",
    });
  else if (evidence.controls.passed === false)
    items.push({ key: "controls", title: "Controls failed.", body: "The method isn't validated on this data; don't trust the verdict." });
  if (evidence.provenance && !evidence.provenance.rules_frozen_commit)
    items.push({
      key: "frozen",
      title: "Rules weren't frozen when this ran.",
      body: "Run it again after the rules-frozen tag, so the audit can tie it to the frozen rules.",
    });
  if (!items.length) return null;
  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <div
          key={item.key}
          role="note"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[14px] border border-cx-investigate/25 bg-cx-investigate/[0.05] px-4 py-3 text-sm"
        >
          <span className="text-cx-investigate"><IconWarn size={16} /></span>
          <span className="flex-1">
            <span className="font-medium">{item.title}</span> <span className="text-cx-text-2">{item.body}</span>
          </span>
          {item.details && <Details>{item.details}</Details>}
        </div>
      ))}
    </div>
  );
}

function GuidePanel({
  guide,
  loading,
  error,
  claudeOn,
  asking,
  onAsk,
  claudeFallback,
  canSwitch,
  prefer,
  onPrefer,
  onStart,
  touring,
  settings,
}: {
  guide: Guide | null;
  loading: boolean;
  error: string | null;
  claudeOn: boolean;
  asking: boolean;
  onAsk: (() => void) | null;
  claudeFallback: string | null | undefined;
  canSwitch: boolean;
  prefer: "claude" | "template";
  onPrefer: (p: "claude" | "template") => void;
  onStart: () => void;
  touring: boolean;
  settings: Settings | null;
}) {
  const [how, setHow] = useState(false);
  if (error) return null;
  const byClaude = guide?.source === "claude";
  const numbers = (guide?.summary ?? []).reduce((n, s) => n + (s.match(/\{(diff|shift|interval|tile|range|whatif|count):[^{}\s]+\}/g)?.length ?? 0), 0);
  const note = !claudeOn
    ? "Claude's summary is off, so this is the fixed wording."
    : claudeFallback && !canSwitch
      ? `Claude's version couldn't be used (${claudeFallback}), so this is the fixed wording.`
      : onAsk
        ? "Fixed wording. Claude can rewrite it from the same evidence; the numbers stay Catalyst's."
        : null;
  const noteTitle = !claudeOn ? settings?.claude.reason ?? undefined : claudeFallback ?? undefined;
  return (
    <section aria-label="What stood out" className="flex flex-col gap-4 rounded-[22px] border border-white/10 bg-[#15161A] px-6 py-5">
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 className="m-0 text-lg font-semibold tracking-[-0.01em]">What stood out</h2>
        {guide && (byClaude ? <span className="tag-claude">WRITTEN BY CLAUDE</span> : (
          <span className="mono rounded-[5px] border border-white/20 px-1.5 py-0.5 text-[10px] text-cx-muted">FIXED TEMPLATE</span>
        ))}
        {asking && (
          <span className="inline-flex items-center gap-2 text-xs text-cx-faint">
            <Spinner size={12} /> Claude is writing…
          </span>
        )}
        {numbers > 0 && (
          <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-cx-accept-text" title="Every number is filled in by Catalyst from the evidence; hover one to see where it comes from.">
            <IconCheck size={13} /> {numbers === 1 ? "1 number" : `${numbers} numbers`}, all from the evidence
          </span>
        )}
      </div>
      {loading ? (
        <div className="flex items-center gap-2.5 text-sm text-cx-muted"><Spinner size={16} /> Reading the evidence…</div>
      ) : guide && (
        <p className={`m-0 max-w-[900px] leading-[1.65] ${byClaude ? "text-[18px] text-cx-text" : "text-base text-cx-text-2"}`}>
          {guide.summary.map((s, i) => (
            <span key={i}>
              <SlotText text={s} slots={guide.slots} />{" "}
            </span>
          ))}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2.5 border-t border-white/[0.07] pt-3.5">
        <button className="btn pri" type="button" data-walkthrough-start disabled={!guide?.steps.length || touring} onClick={onStart}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5 4l14 8-14 8V4z" />
          </svg>
          Walk me through it
        </button>
        {onAsk && (
          <button className="btn" type="button" disabled={asking} onClick={onAsk}>
            <span className="tag-claude">CLAUDE</span> {claudeFallback ? "Try again" : "Ask Claude for a summary"}
          </button>
        )}
        {canSwitch && (
          <button className="btn" type="button" onClick={() => onPrefer(prefer === "claude" ? "template" : "claude")}>
            {prefer === "claude" ? "Show the plain template" : "Show Claude's summary"}
          </button>
        )}
        <span className="ml-auto max-w-[520px] text-right text-xs text-cx-faint" title={noteTitle}>
          {note ?? "Numbers are filled in by Catalyst. Hover one to see where it comes from."}
        </span>
      </div>
      <div className="border-t border-white/[0.07] pt-1">
        <button
          type="button"
          aria-expanded={how}
          onClick={() => setHow((h) => !h)}
          className="flex min-h-10 w-full cursor-pointer items-center gap-3 border-0 bg-transparent p-0 text-left text-[13px] text-cx-muted"
        >
          <span className="tag-claude">CLAUDE</span>
          <span className="flex-1">How Claude is used on this page</span>
          <span aria-hidden>{how ? "−" : "+"}</span>
        </button>
        {how && (
          <ul className="m-0 flex flex-col gap-1.5 pt-1 pb-1 pl-5 text-[13px] leading-normal text-cx-muted">
            <li>Catalyst sets the verdict with fixed rules. Claude never measures, decides or changes it.</li>
            <li>Claude reads the evidence file and the property dictionary. Never the images.</li>
            <li>It can't write numbers: each one is a slot that Catalyst fills in from the evidence.</li>
            <li>It's only asked when you press the button; its checked answer is kept for this comparison.</li>
            <li>A sentence that writes its own number, names a verdict, or gives a property a status it doesn't have is dropped; two drops and the page shows the fixed template.</li>
            <li>Its one what-if, the batch without its odd tiles, is recomputed by Catalyst.</li>
            <li>
              {settings?.claude.available ? `Model: ${settings.claude.model}.` : "Without an API key, the page uses the fixed template."}
            </li>
          </ul>
        )}
      </div>
    </section>
  );
}

function TourCard({
  guide,
  index,
  onBack,
  onNext,
  onExit,
}: {
  guide: Guide;
  index: number;
  onBack: () => void;
  onNext: () => void;
  onExit: () => void;
}) {
  const step = guide.steps[index];
  const last = index >= guide.steps.length - 1;
  return (
    <div
      role="dialog"
      aria-label={`Walkthrough step ${index + 1} of ${guide.steps.length}`}
      className="glass mb-4 flex flex-col gap-3 rounded-[18px] px-5 py-4"
      style={{ background: "rgba(28,29,34,.78)" }}
    >
      <div className="flex items-center gap-2.5">
        <span className="mono text-xs text-cx-muted">
          {index + 1} / {guide.steps.length}
        </span>
        <span className="text-[15px] font-semibold">{step.title}</span>
        <span className="ml-auto">
          {guide.source === "claude" ? <span className="tag-claude">CLAUDE</span> : (
            <span className="mono rounded-[5px] border border-white/20 px-1.5 py-0.5 text-[10px] text-cx-muted">TEMPLATE</span>
          )}
        </span>
      </div>
      <p className="m-0 max-w-[780px] text-base leading-[1.6] text-cx-text">
        {step.sentences.map((s, i) => (
          <span key={i}>
            <SlotText text={s} slots={guide.slots} />{" "}
          </span>
        ))}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {step.source && <span className="mono text-[11px] text-cx-faint">source · {step.source}</span>}
        <span className="ml-auto flex gap-2">
          <button type="button" onClick={onExit} className="min-h-10 cursor-pointer rounded-[10px] border-0 bg-transparent px-3 text-[13px] text-cx-muted">
            Exit
          </button>
          {index > 0 && (
            <button className="btn min-h-10" type="button" onClick={onBack}>
              Back
            </button>
          )}
          <button className="btn pri min-h-10" type="button" onClick={onNext} autoFocus>
            {last ? "Finish" : "Next"}
          </button>
        </span>
      </div>
    </div>
  );
}

const RANK_WHY = ["Largest", "Second-largest", "Third-largest"];

/** At most three cards from the top of the backend's ranking (evidence.drivers). */
function LookHere({ ctx }: { ctx: Ctx }) {
  const cards = rankedFindings(ctx.evidence).slice(0, 3);
  return (
    <section aria-label="Look here first" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-[22px] font-semibold tracking-[-0.02em]">Look here first</h2>
        <span className="text-[13px] text-cx-faint">
          The key properties that moved most against their tolerance and aren't settled as similar, from the comparison's own ranking.
        </span>
      </div>
      {cards.length ? (
        <div className="grid grid-cols-3 gap-3.5">
          {cards.map((d, i) => (
            <FindingCard key={d.name} ctx={ctx} d={d} n={i + 1} />
          ))}
        </div>
      ) : (
        <Panel className="flex items-center gap-3 text-sm text-cx-muted">
          <Cat mood="sure" size={30} />
          Nothing to look at first: every key property is within the tolerance of the baseline.
        </Panel>
      )}
    </section>
  );
}

function FindingCard({ ctx, d, n }: { ctx: Ctx; d: Difference; n: number }) {
  const { evidence, config, dict } = ctx;
  const m = config.similar_margin;
  const unit = d.unit || dictEntry(d.name, dict).unit;
  const entry = dictEntry(d.name, dict);
  const odd = [...oddByTile(evidence).entries()]
    .flatMap(([tile, odds]) => odds.filter((o) => o.quantity === d.name).map((o) => ({ tile, o })))
    .slice(0, 3);
  const status = { UNCLEAR: ["Not settled", "text-cx-investigate-text"], DIFFERENT: ["Differs", "text-cx-reject-text"], SIMILAR: ["Similar", "text-cx-accept-text"] }[d.status];
  const note = quantityNote(d.name, dict);
  return (
    <article className="flex min-w-0 flex-col gap-3.5 rounded-[22px] border border-white/10 bg-[#15161A] p-5" style={{ boxShadow: "0 20px 40px -28px rgba(0,0,0,.9)" }}>
      <div className="flex items-center gap-2.5">
        <span className="mono grid h-[26px] w-[26px] flex-none place-items-center rounded-lg bg-cx-text-strong text-[13px] font-semibold text-cx-bg">{n}</span>
        <span className={`text-xs ${status[1]}`}>{status[0]}</span>
        <span className="mono ml-auto text-[13px] text-cx-text-2">{fmtSigma(sigmaOf(d, d.difference, config))}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        <h3 className="m-0 text-[19px] leading-[1.25] font-semibold tracking-[-0.015em]">{quantityLabel(d.name, dict)}</h3>
        {note && <span className="text-xs text-cx-faint">{note}</span>}
        <span className="mono text-[13px] text-cx-text-2">{fmtPair(d.reference, d.batch, unit)}</span>
      </div>
      <div>
        <ShiftBand
          s={sigmaOf(d, d.difference, config)}
          lo={sigmaOf(d, d.interval?.[0], config)}
          hi={sigmaOf(d, d.interval?.[1], config)}
          margin={m}
          color={batchColor(evidence.batch)}
        />
        <div className="mono mt-1 flex justify-between text-[10px] text-cx-faint">
          <span>−4σ</span>
          <span className="text-[#5EEAD4]">baseline · tolerance ±{m}σ</span>
          <span>+4σ</span>
        </div>
      </div>
      {odd.length > 0 ? (
        <div className="flex gap-2">
          {odd.map(({ tile, o }, i) => (
            <Peekable
              key={tile}
              items={odd.map(({ tile: t, o: x }) => ({
                batch: evidence.batch,
                imageId: t,
                title: `Tile ${t}`,
                note: `${quantityLabel(d.name, dict)} ${fmt(x.value, unit)}, outside the baseline range ${fmtRange(x.range[0], x.range[1], unit)}.`,
                hasLayers: ctx.tiles.find((tt) => tt.batch === evidence.batch && tt.image_id === t)?.has_layers,
              }))}
              index={i}
              label={`Tile ${tile}: peek, click to pin`}
              className="relative block flex-1 overflow-hidden rounded-xl bg-black"
              style={{ aspectRatio: "4 / 3", boxShadow: "0 0 0 1.5px rgba(250,204,21,.7)" }}
            >
              <img src={imageUrl(evidence.batch, tile, "BSE")} alt="" loading="lazy" className="block h-full w-full object-cover" />
              <span className="mono absolute right-1.5 bottom-1.5 left-1.5 flex justify-between rounded-md px-1.5 py-0.5 text-[10px] text-cx-text" style={{ background: "rgba(10,11,13,.78)" }}>
                <span>{tile}</span>
                <span className="text-cx-investigate-text">{fmt(o.value, unit)}</span>
              </span>
            </Peekable>
          ))}
        </div>
      ) : (
        <span className="text-xs text-cx-faint">No single tile sits outside the baseline range on this property.</span>
      )}
      {(entry.why_it_matters || entry.supplier_check) && (
        <p className="m-0 text-[13px] leading-normal text-cx-text-2">
          {entry.why_it_matters} {entry.supplier_check && <span className="text-cx-muted">At the supplier: {entry.supplier_check}</span>}
        </p>
      )}
      <div className="mt-auto flex items-start gap-2 border-t border-white/[0.07] pt-3 text-xs leading-snug text-cx-faint">
        <span aria-hidden>ⓘ</span>
        <span>Why it's here: {RANK_WHY[n - 1]} shift against its tolerance among the key properties that aren't settled.</span>
      </div>
    </article>
  );
}

function WithinTolerance({ ctx }: { ctx: Ctx }) {
  const [all, setAll] = useState(false);
  const byName = new Map(ctx.evidence.differences.map((d) => [d.name, d]));
  const similar = ctx.evidence.explanations.within_tolerance.map((q) => byName.get(q)!).filter(Boolean);
  if (!similar.length) return null;
  const shown = all ? similar : similar.slice(0, 6);
  return (
    <div className="flex flex-wrap items-center gap-2 text-[13px] text-cx-muted">
      <span className="mr-1.5 inline-flex items-center gap-2 text-cx-accept-text">
        <IconCheck size={14} />
        {similar.length} {similar.length === 1 ? "property" : "properties"} within tolerance
      </span>
      {shown.map((d) => (
        <span key={d.name} title={d.name} className="rounded-full border border-cx-line px-2.5 py-1">
          {quantityLabel(d.name, ctx.dict)}
        </span>
      ))}
      {similar.length > shown.length && (
        <button type="button" onClick={() => setAll(true)} className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-cx-faint underline decoration-dotted">
          +{similar.length - shown.length} more
        </button>
      )}
    </div>
  );
}

function NextSteps({ evidence }: { evidence: Evidence }) {
  const steps = evidence.explanations.next_steps;
  if (!steps.length) return null;
  return (
    <section aria-label="Next steps" className="flex flex-col gap-3 rounded-[22px] border border-cx-line bg-cx-surface p-5">
      <h2 className="m-0 text-base font-medium">Next steps</h2>
      <div className="grid grid-cols-3 gap-3">
        {steps.map((s, i) => (
          <div key={i} className="flex items-start gap-3 rounded-[14px] border border-white/[0.07] bg-black/25 p-3.5 text-sm leading-snug">
            <span className="mono grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-white/[0.08] text-xs">{i + 1}</span>
            <span className="text-cx-text-2">{s}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Everything({ ctx, open, onToggle }: { ctx: Ctx; open: Record<string, boolean>; onToggle: (id: string) => void }) {
  const { evidence, tiles } = ctx;
  const shown = dropTwinShare(evidence.differences, evidence);
  const isPaused = (d: Difference) => d.note === "imaging changed";
  const count = (f: (d: Difference) => boolean) => shown.filter(f).length;
  const parts = [
    [count((d) => !isPaused(d) && d.status === "DIFFERENT"), "differ"],
    [count((d) => !isPaused(d) && d.status === "UNCLEAR"), "unclear"],
    [count((d) => !isPaused(d) && d.status === "SIMILAR"), "similar"],
    [count(isPaused), "paused"],
  ].filter(([n]) => n).map(([n, w]) => `${n} ${w}`).join(" · ");
  const odd = oddByTile(evidence).size;
  const batchTiles = tiles.filter((t) => t.batch === evidence.batch).length;
  const baseTiles = tiles.filter((t) => t.batch === evidence.baseline).length;
  const prov = evidence.provenance;
  return (
    <Folds
      open={open}
      onToggle={onToggle}
      rows={[
        { id: "props", title: `All ${shown.length} properties`, summary: parts, body: () => <Differences ctx={ctx} /> },
        {
          id: "tiles",
          title: "Every tile, property by property",
          summary: `${odd} of ${evidence.n_images.batch} ${evidence.unit === "image" ? "tiles" : "strips"} outside the baseline range`,
          body: () => <TileBands ctx={ctx} />,
        },
        {
          id: "gallery",
          title: "All tiles",
          summary: `${batchTiles} ${batchLabel(evidence.batch)} · ${baseTiles} ${batchLabel(evidence.baseline)} · ${odd} flagged`,
          body: () => <Galleries ctx={ctx} />,
        },
        { id: "explain", title: "Explain it to an operator, engineer, scientist or manager", summary: "4 versions", body: () => <Explain evidence={evidence} /> },
        {
          id: "run",
          title: "Run details",
          summary: `${evidence.n_images.batch} vs ${evidence.n_images.baseline} tiles · commit ${shortHash(prov?.git_commit, 7)} · ${prov?.rules_frozen_commit ? "frozen" : "not frozen"}`,
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
    <div className="flex flex-col gap-1">
      <div className="overflow-x-auto">
        <div className="min-w-[820px]">
          <div className="lbl grid grid-cols-[240px_minmax(0,1fr)_150px_88px] items-end gap-5 border-b border-cx-line py-2">
            <span>Property</span>
            <div className="mono relative h-3.5 text-[10px] normal-case">
              <span className="absolute left-0">−4σ</span>
              <span className="absolute left-1/2 -translate-x-1/2 text-cx-batch-3">baseline · ±{m}σ tolerance</span>
              <span className="absolute right-0">+4σ</span>
            </div>
            <span className="text-right">{batchLabel(evidence.baseline)} → {batchLabel(evidence.batch)}</span>
            <span className="text-right">Status</span>
          </div>
          {rows.map((d) => {
            const paused = d.note === "imaging changed";
            const s = sigmaOf(d, d.difference, config);
            const chip = statusChip(d.status, paused);
            const notMeasured = d.note === "not measured" || (d.reference == null && d.batch == null);
            const unit = d.unit || dictEntry(d.name, dict).unit;
            return (
              <div key={d.name} className={`grid min-h-[52px] grid-cols-[240px_minmax(0,1fr)_150px_88px] items-center gap-5 border-b border-cx-line-soft ${paused ? "opacity-55" : ""}`}>
                <div className="flex min-w-0 flex-col gap-[3px]">
                  <span className="flex items-center gap-2 text-sm">
                    {quantityLabel(d.name, dict)}
                    {d.key && <span className="mono rounded border border-cx-orange-text/50 px-1 py-px text-[9px] text-cx-orange-text">KEY</span>}
                  </span>
                  <span className="mono truncate text-[11px] text-cx-faint" title={quantityNote(d.name, dict) ?? undefined}>{d.name}</span>
                </div>
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
                      <span className="mono text-[11px] whitespace-nowrap text-cx-faint">
                        {fmtSigma(s)}
                        {d.p != null ? ` · p ${Number(d.p.toPrecision(2))}` : paused ? " · imaging changed" : ""}
                      </span>
                    </div>
                    <span className={`inline-flex min-h-[26px] items-center justify-self-end rounded-full px-2.5 text-xs ${chip.className}`}>{chip.label}</span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <p className="m-0 pt-3 text-[13px] leading-normal text-cx-faint">
        Bar = {Math.round(config.ci_level * 100)}% interval of the shift. Different = the interval clears the tolerance and the
        family-wise p is below {config.alpha}. Similar = the interval sits inside the tolerance. Anything else is unclear, and we
        say so. Brightness-based properties pause when the microscope settings changed. Of two complementary particle-type
        shares, one is shown.
      </p>
    </div>
  );
}

const JITTER = [8, 22, 14, 30, 4, 18, 26, 10, 34, 2, 20, 28, 12, 6, 24, 16, 32];

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
      values: tiles.filter((t) => t.batch === evidence.batch && t.kpis?.[kpi] != null).map((t) => ({ id: t.image_id, v: t.kpis![kpi]! })),
    }))
    .filter((row) => row.band && row.band.sd > 0 && row.values.length);
  if (!rows.length)
    return (
      <div className="flex items-center gap-3 text-sm text-cx-muted">
        <Cat mood="ready" size={30} />
        No measured KPIs for this batch yet: run it first.
      </div>
    );
  return (
    <div className="flex flex-col gap-1.5">
      <span className="pb-1 text-[13px] text-cx-faint">
        Shaded = {batchLabel(evidence.baseline)} ±1σ, ±2σ, ±3σ · small dots = baseline tiles · ringed = outside the baseline range on that key property
      </span>
      {rows.map(({ kpi, key, band, values }) => {
        const { mean, sd, values: base } = band!;
        const lo = mean - 3.5 * sd;
        const hi = mean + 3.5 * sd;
        const x = (v: number) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
        const bandX = (k: number) => ({ left: `${x(mean - k * sd)}%`, width: `${x(mean + k * sd) - x(mean - k * sd)}%` });
        const unit = dictEntry(kpi, dict).unit;
        return (
          <div key={kpi} className="grid grid-cols-[230px_minmax(0,1fr)] items-center gap-4">
            <div className="flex min-w-0 flex-col gap-[2px]">
              <span className="flex flex-wrap items-center gap-x-1.5 text-[13px] leading-snug" title={kpi}>
                {quantityLabel(kpi, dict)}
                {key && <span className="mono rounded border border-cx-orange-text/50 px-1 py-px text-[9px] text-cx-orange-text">KEY</span>}
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
              {base.map((v, i) => (
                <div key={i} className="absolute h-[5px] w-[5px] rounded-full bg-cx-batch-3 opacity-90" style={{ left: `calc(${x(v)}% - 2.5px)`, top: JITTER[i % JITTER.length] % 12 }} />
              ))}
              {values.map((tile, i) => {
                const isOdd = oddOn.has(`${tile.id}|${kpi}`);
                return (
                  <a
                    key={tile.id}
                    href={href.library(evidence.batch, tile.id)}
                    title={`${tile.id} · ${fmt(tile.v, unit)}`}
                    className="absolute rounded-full"
                    style={{
                      left: `calc(${x(tile.v)}% - ${isOdd ? 6 : 4}px)`,
                      bottom: JITTER[(i + 3) % JITTER.length] % 12,
                      width: isOdd ? 12 : 8,
                      height: isOdd ? 12 : 8,
                      background: batchColor(evidence.batch),
                      boxShadow: isOdd ? "0 0 0 2px #111215, 0 0 0 4px var(--cx-investigate)" : "none",
                    }}
                  />
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
  const columns = [
    { name: evidence.batch, tiles: tiles.filter((t) => t.batch === evidence.batch).sort(byOdd) },
    { name: evidence.baseline, tiles: tiles.filter((t) => t.batch === evidence.baseline), baseline: true },
  ];
  return (
    <div className="grid grid-cols-2 gap-4">
      {columns.map((col, c) => (
        <div key={`${c}-${col.name}`} className={`flex flex-col gap-3 rounded-[18px] border p-4 ${col.baseline ? "border-cx-batch-3/20" : "border-cx-line"}`}>
          <div className="flex items-center justify-between">
            <h3 className="m-0 flex items-center gap-2 text-[15px] font-medium">
              <BatchDot name={col.name} size={10} />
              {batchLabel(col.name)}
              {col.baseline && <span className="font-normal text-cx-faint">baseline</span>}
            </h3>
            <span className="text-[13px] text-cx-faint">{col.tiles.length} tiles</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
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
                  {tile.image_id}{oddIds.has(tile.image_id) ? " · odd" : ""}
                </span>
              </Peekable>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** A gallery tile as a peek: the whole tile, with what made it odd if it is. */
function peekItem(tile: Tile, ctx: Ctx, oddIds: Set<string>): PeekItem {
  const odds = oddByTile(ctx.evidence).get(tile.image_id) ?? [];
  const unit = (q: string) => ctx.evidence.differences.find((d) => d.name === q)?.unit;
  return {
    batch: tile.batch,
    imageId: tile.image_id,
    title: `Tile ${tile.image_id}`,
    note: oddIds.has(tile.image_id)
      ? `Outside the baseline range on ${joinAnd(odds.map((o) => `${quantityLabel(o.quantity, ctx.dict).toLowerCase()} (${fmt(o.value, unit(o.quantity))})`))}.`
      : `${batchLabel(tile.batch)}${tile.batch === ctx.evidence.baseline ? ", the baseline" : ""}.`,
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
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cx-orange/70" />
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
    <div className="flex flex-col gap-4">
      <dl className="m-0 grid grid-cols-[220px_minmax(0,1fr)] gap-x-6 gap-y-2 text-[13px]">
        {facts.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-cx-faint">{k}</dt>
            <dd className="mono m-0 text-cx-text-2">{v}</dd>
          </div>
        ))}
      </dl>
      {evidence.explanations.rules.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="lbl">Rules that fired</span>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
            {evidence.explanations.rules.map((r) => (
              <li key={r} className="flex items-center gap-2.5">
                <span className="h-2 w-2 rounded-full" style={{ background: evidence.verdict === "REJECT" ? "var(--cx-reject)" : "var(--cx-investigate)" }} />
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-cx-faint">
        Every reason as the rules wrote it: <Details label="show">
          <ul className="mono m-0 flex flex-col gap-1 pt-2 pl-4 text-[11px] leading-normal text-cx-muted">
            {evidence.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </Details>
      </div>
    </div>
  );
}

