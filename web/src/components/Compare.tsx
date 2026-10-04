import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  askClaude, getConfig, getEvidence, getGuide, getKpiDictionary, getSettings, getTiles, imageUrl, listBatches,
  runBatch, uploadBatch,
} from "../api";
import {
  batchColor, batchLabel, baselineBand, dictEntry, dropTwinShare, fmt, fmtPair, fmtRange, fmtSigma, imagingWords, isFixture,
  joinAnd, isUploadBatch, MIN_BASELINE_TILES, oddByTile, plural, quantityLabel, quantityNote, rankedFindings, shortHash, sigmaOf, statusChip, useApi,
} from "../lib";
import { href, replaceRoute } from "../router";
import type {
  BatchSummary, Config, Difference, Evidence, Guide, GuideTarget, KpiDictionary, Settings, Tile,
} from "../types";
import {
  BatchDot, Cat, ErrorPanel, Folds, IconCheck, IconWarn, Note, PAGE, Panel, Seg, ShiftBand, SlotText, Spinner,
  VerdictPill,
} from "./bits";
import { Peekable, type PeekItem } from "./Peek";
import { BatchSelect } from "./Pickers";

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
  const [notice, setNotice] = useState<{ text: string; at: string } | null>(null);
  const [finished, setFinished] = useState<{ batch: string; baseline: string; to: string } | null>(null);
  const folder = useRef<HTMLInputElement>(null);

  const defaultBaseline = config.data?.baseline ?? null;
  const unfrozen = !!settings.data && !settings.data.rules_frozen_commit;
  const candidates = (batches.data ?? []).filter((b) => !isFixture(b.name));
  const tileCount = (name: string) => (tiles.data ?? []).filter((t) => t.batch === name).length;
  const canBase = (b: BatchSummary) => b.has_images && !isUploadBatch(b.name) && tileCount(b.name) >= MIN_BASELINE_TILES;
  const selected =
    routeBatch && candidates.some((b) => b.name === routeBatch)
      ? routeBatch
      : candidates.find((b) => b.name !== defaultBaseline && b.verdict)?.name ??
        candidates.find((b) => b.verdict)?.name ??
        candidates[0]?.name;
  const oneOff =
    routeBaseline && routeBaseline !== defaultBaseline && routeBaseline !== selected && candidates.some((b) => b.name === routeBaseline && canBase(b))
      ? routeBaseline
      : null;
  const baseline = oneOff ?? defaultBaseline;
  const checked = !!batches.data && !!tiles.data && !!config.data;
  const settled = checked && !batches.loading && !tiles.loading;  // not a stale list while a reload after a run is in flight
  const neverRun = !oneOff && !!selected && !candidates.find((b) => b.name === selected)?.verdict;
  const evidence = useApi(
    () => (checked && selected && defaultBaseline && !neverRun ? getEvidence(selected, oneOff) : Promise.resolve(null)),
    [checked, selected, oneOff, defaultBaseline, neverRun, reload],
  );
  const missing = neverRun || evidence.status === 404;

  // a failed run belongs to the comparison it was for
  useEffect(() => setRun((r) => (r?.error ? null : r)), [selected, oneOff]);

  const here = href.compare(routeBatch, routeBaseline);
  const canonical = selected ? href.compare(selected, oneOff) : here;
  useEffect(() => {
    setNotice((n) => (n?.at === here ? n : null));
    setFinished((f) => (f?.to === here ? null : f));
  }, [here]);
  useEffect(() => {
    if (!settled || canonical === here) return;
    const text =
      routeBatch && routeBatch !== selected
        ? `No batch called ${batchLabel(routeBatch)} — showing ${batchLabel(selected!)}.`
        : routeBaseline && routeBaseline !== oneOff && routeBaseline !== defaultBaseline
          ? `${batchLabel(routeBaseline)} can't be a baseline — showing ${batchLabel(defaultBaseline ?? "")}.`
          : null;
    setNotice(text ? { text, at: canonical } : null);
    replaceRoute(canonical);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled, here, canonical]);

  async function startRun(batch: string, against: string | null, files?: File[]) {
    const from = window.location.hash;
    setRun({ batch, baseline: against, phase: files ? "uploading" : "measuring", done: 0, total: 0 });
    try {
      if (files) await uploadBatch(batch, files);
      setRun((r) => r && { ...r, phase: "measuring" });
      await runBatch(batch, against, (event) => {
        if (event.type === "progress")
          setRun((r) => r && { ...r, done: event.done, total: event.total });
        if (event.type === "error") setRun((r) => r && { ...r, error: event.message });
        if (event.type === "done") {
          const to = href.compare(event.evidence.batch, against);
          setRun(null);
          setReload((n) => n + 1);
          if ([from, to].includes(window.location.hash)) window.location.hash = to;
          else setFinished({ batch: event.evidence.batch, baseline: event.evidence.baseline, to });
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
    <div className={`${PAGE} gap-6`}>
      <div className="flex flex-wrap items-center gap-2.5">
        <BatchSelect
          label="Batch"
          value={selected}
          sub={selected && plural(tileCount(selected), "tile")}
          options={candidates.map((b) => ({ name: b.name, note: `${plural(tileCount(b.name), "tile")}${b.verdict ? "" : " · not run"}` }))}
          onPick={(name) => (window.location.hash = href.compare(name, name === oneOff ? null : oneOff))}
        />
        <span className="mono px-0.5 text-[13px] text-cx-faint">vs</span>
        {baseline && (
          <BatchSelect
            label="Baseline"
            accent
            value={baseline}
            sub={`${plural(tileCount(baseline), "tile")} · ${oneOff ? "one-off" : "default"}`}
            options={candidates.filter((b) => b.name === baseline || canBase(b)).map((b) => ({
              name: b.name,
              note: b.name === selected ? "being compared" : plural(tileCount(b.name), "tile"),
              badge: b.name === defaultBaseline ? "default" : undefined,
              disabled: b.name === selected,
            }))}
            onPick={(name) => {
              setPicked(name === defaultBaseline ? null : name);
              window.location.hash = href.compare(selected, name === defaultBaseline ? null : name);
            }}
            footer={unfrozen && (
              <a href={href.settings()} className="flex min-h-10 items-center justify-between px-2.5 text-[13px]">
                Change the default baseline <span aria-hidden>→</span>
              </a>
            )}
          />
        )}
        {oneOff && defaultBaseline && (
          <span className="inline-flex items-center gap-3 px-1 text-[13px] whitespace-nowrap">
            <a href={href.compare(selected)} className="text-cx-muted">Back to {batchLabel(defaultBaseline)}</a>
            {unfrozen && <a href={href.settings()}>Make default</a>}
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
            <div className="text-xs text-cx-faint">
              {run.total ? `Measuring tile ${Math.min(run.done + 1, run.total)} of ${run.total}` : "Starting…"}
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
      {finished && finished.to !== here && (
        <Note>
          <span className="text-cx-accept-text"><IconCheck size={15} /></span>
          <span>
            {batchLabel(finished.batch)} vs {batchLabel(finished.baseline)} is ready · <a href={finished.to}>Open</a>
          </span>
        </Note>
      )}
      {notice?.at === here && <Note>{notice.text}</Note>}

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
          <ErrorPanel title={`No evidence for ${selected ? batchLabel(selected) : "this batch"}`} message={evidence.error ?? ""} />
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

  const toured = useRef(false);
  useEffect(() => {
    if (step == null && toured.current) document.querySelector<HTMLButtonElement>("[data-walkthrough-start]")?.focus({ preventScroll: true });
    toured.current = step != null;
  }, [step]);

  const finish = () => {
    setStep(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
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
          model={settings?.claude.model}
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
  const items: { key: string; title: string; body: ReactNode }[] = [];
  if (evidence.imaging.changed)
    items.push({
      key: "imaging",
      title: "Imaging differs from the baseline.",
      body: `${imagingWords(evidence.imaging.changed_metrics)}, so ${joinAnd(paused) || "brightness-based properties"} ${paused.length === 1 ? "is" : "are"} paused. Check the microscope settings.`,
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
  model,
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
  model: string | undefined;
}) {
  const [how, setHow] = useState(false);
  if (error) return null;
  const byClaude = guide?.source === "claude";
  const numbers = (guide?.summary ?? []).reduce((n, s) => n + (s.match(/\{(diff|shift|interval|tile|range|whatif|count):[^{}\s]+\}/g)?.length ?? 0), 0);
  const note = claudeFallback && !canSwitch
    ? `Claude's version couldn't be used (${claudeFallback}), so this is the fixed wording.`
    : onAsk
      ? "Fixed wording. Claude can rewrite it from the same evidence; the numbers stay Catalyst's."
      : "Numbers are filled in by Catalyst. Hover one to see where it comes from.";
  return (
    <section aria-label="What stood out" className="flex flex-col gap-4 rounded-[22px] border border-white/10 bg-[#15161A] px-6 py-5">
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 className="m-0 text-lg font-semibold tracking-[-0.01em]">What stood out</h2>
        {byClaude && <span className="tag-claude">WRITTEN BY CLAUDE</span>}
        {asking && (
          <span className="inline-flex items-center gap-2 text-xs text-cx-faint">
            <Spinner size={12} /> Claude is writing…
          </span>
        )}
        {byClaude && numbers > 0 && (
          <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-cx-accept-text" title="Every number is filled in by Catalyst from the evidence; hover one to see where it comes from.">
            <IconCheck size={13} /> {numbers === 1 ? "1 number" : `${numbers} numbers`}, all from the evidence
          </span>
        )}
      </div>
      {loading ? (
        <div aria-hidden className="flex max-w-[900px] flex-col text-base leading-[1.65]">
          {["100%", "94%", "62%"].map((w) => (
            <span key={w} className="flex h-[1.65em] items-center">
              <span className="h-3 rounded-full bg-white/[0.06]" style={{ width: w }} />
            </span>
          ))}
        </div>
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
        {claudeOn && (
          <span className="ml-auto max-w-[520px] text-right text-xs text-cx-faint" title={claudeFallback ?? undefined}>
            {note}
          </span>
        )}
      </div>
      {claudeOn && (
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
              <li>Model: {model}.</li>
            </ul>
          )}
        </div>
      )}
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
        {guide.source === "claude" && <span className="ml-auto"><span className="tag-claude">CLAUDE</span></span>}
      </div>
      <p className="m-0 max-w-[780px] text-base leading-[1.6] text-cx-text">
        {step.sentences.map((s, i) => (
          <span key={i}>
            <SlotText text={s} slots={guide.slots} />{" "}
          </span>
        ))}
      </p>
      <div className="flex justify-end gap-2">
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
      </div>
    </div>
  );
}

/** At most three cards from the top of the backend's ranking (evidence.drivers). */
function LookHere({ ctx }: { ctx: Ctx }) {
  const { evidence, config, dict } = ctx;
  const cards = rankedFindings(evidence).slice(0, 3);
  const paused = evidence.differences.filter((d) => d.key && d.note === "imaging changed").length;
  const also = dropTwinShare(evidence.differences, evidence).filter(
    (d) => d.status === "DIFFERENT" && d.note !== "imaging changed" && !cards.some((c) => c.name === d.name),
  );
  return (
    <section aria-label="Look here first" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-[22px] font-semibold tracking-[-0.02em]">Look here first</h2>
        <span className="text-[13px] text-cx-faint">Largest shifts against the ±{config.similar_margin}σ tolerance.</span>
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
          {paused
            ? `Every key property that could be checked is within tolerance; ${paused} paused (imaging changed).`
            : "Nothing to look at first: every key property is within the tolerance of the baseline."}
        </Panel>
      )}
      {also.length > 0 && (
        <p className="m-0 text-[13px] text-cx-muted">
          <span className="text-cx-reject-text">Also differs:</span>{" "}
          {also.map((d, i) => {
            const s = sigmaOf(d, d.difference, config);
            return (
              <span key={d.name}>
                {i ? ", " : ""}
                {quantityLabel(d.name, dict)}{" "}
                <span className="mono">{s == null ? fmtPair(d.reference, d.batch, d.unit || dictEntry(d.name, dict).unit) : fmtSigma(s)}</span>
              </span>
            );
          })}
        </p>
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
  const chip = statusChip(d.status, d.note === "imaging changed");
  const note = quantityNote(d.name, dict);
  return (
    <article className="flex min-w-0 flex-col gap-3.5 rounded-[22px] border border-white/10 bg-[#15161A] p-5" style={{ boxShadow: "0 20px 40px -28px rgba(0,0,0,.9)" }}>
      <div className="flex items-center gap-2.5">
        <span className="mono grid h-[26px] w-[26px] flex-none place-items-center rounded-lg bg-cx-text-strong text-[13px] font-semibold text-cx-bg">{n}</span>
        <span className={`inline-flex min-h-[22px] items-center rounded-full px-2 text-xs ${chip.className}`}>{chip.label}</span>
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
    </article>
  );
}

function WithinTolerance({ ctx }: { ctx: Ctx }) {
  const [all, setAll] = useState(false);
  const byName = new Map(ctx.evidence.differences.map((d) => [d.name, d]));
  const similar = ctx.evidence.explanations.within_tolerance.map((q) => byName.get(q)!).filter(Boolean);
  if (!similar.length) return null;
  const shown = all || similar.length <= 7 ? similar : similar.slice(0, 6);
  return (
    <div className="flex flex-wrap items-center gap-2 text-[13px] text-cx-muted">
      <span className="mr-1.5 inline-flex items-center gap-2 text-cx-accept-text">
        <IconCheck size={14} />
        {similar.length} {similar.length === 1 ? "property" : "properties"} within tolerance
      </span>
      {shown.map((d) => (
        <span key={d.name} title={quantityNote(d.name, ctx.dict) ?? quantityLabel(d.name, ctx.dict)} className="rounded-full border border-cx-line px-2.5 py-1">
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
  const differ = count((d) => !isPaused(d) && d.status === "DIFFERENT");
  const parts = [
    [differ, differ === 1 ? "differs" : "differ"],
    [count((d) => !isPaused(d) && d.status === "UNCLEAR"), "not settled"],
    [count((d) => !isPaused(d) && d.status === "SIMILAR"), "similar"],
    [count(isPaused), "paused"],
  ].filter(([n]) => n).map(([n, w]) => `${n} ${w}`).join(" · ");
  const odd = oddByTile(evidence).size;
  const batchTiles = tiles.filter((t) => t.batch === evidence.batch).length;
  const baseTiles = tiles.filter((t) => t.batch === evidence.baseline).length;
  const self = evidence.batch === evidence.baseline;
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
          summary: self
            ? `${plural(batchTiles, "tile")} · ${odd} flagged`
            : `${batchTiles} ${batchLabel(evidence.batch)} · ${baseTiles} ${batchLabel(evidence.baseline)} · ${odd} flagged`,
          body: () => <Galleries ctx={ctx} />,
        },
        { id: "explain", title: "Explain it to an operator, engineer, scientist or manager", summary: null, body: () => <Explain evidence={evidence} /> },
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
              <span className="absolute left-1/2 -translate-x-1/2 text-cx-batch-3">baseline · tolerance ±{m}σ</span>
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
                <span className="flex min-w-0 items-center gap-2 text-sm" title={quantityNote(d.name, dict) ?? undefined}>
                  {quantityLabel(d.name, dict)}
                  {d.key && <span className="mono rounded border border-cx-orange-text/50 px-1 py-px text-[9px] text-cx-orange-text">KEY</span>}
                </span>
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
        Bar = {Math.round(config.ci_level * 100)}% interval of the shift: Differs when it clears the tolerance with a family-wise
        p below {config.alpha}, Similar when it sits inside, otherwise not settled.
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
              <span className="flex flex-wrap items-center gap-x-1.5 text-[13px] leading-snug">
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
              {values
                .map((tile, i) => ({ ...tile, i, isOdd: oddOn.has(`${tile.id}|${kpi}`) }))
                .sort((a, b) => Number(a.isOdd) - Number(b.isOdd))
                .map((tile) => (
                  <a
                    key={tile.id}
                    href={href.library(evidence.batch, tile.id)}
                    title={`${tile.id} · ${fmt(tile.v, unit)}`}
                    className="absolute rounded-full"
                    style={{
                      left: `calc(${x(tile.v)}% - ${tile.isOdd ? 6 : 4}px)`,
                      bottom: JITTER[(tile.i + 3) % JITTER.length] % 12,
                      width: tile.isOdd ? 12 : 8,
                      height: tile.isOdd ? 12 : 8,
                      background: batchColor(evidence.batch),
                      boxShadow: tile.isOdd ? "0 0 0 2px #111215, 0 0 0 4px var(--cx-investigate)" : "none",
                    }}
                  />
                ))}
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
    <div className={`grid gap-4 ${self ? "grid-cols-1" : "grid-cols-2"}`}>
      {columns.map((col, c) => (
        <div key={`${c}-${col.name}`} className={`flex flex-col gap-3 rounded-[18px] border p-4 ${col.baseline ? "border-cx-batch-3/20" : "border-cx-line"}`}>
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
    </div>
  );
}

