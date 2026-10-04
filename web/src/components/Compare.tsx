import { useEffect, useRef, useState } from "react";
import {
  getConfig, getEvidence, getGuide, getKpiDictionary, getSettings, getTiles, listBatches,
  runBatch, uploadBatch,
} from "../api";
import { pageBlocks, type BlockId } from "../compare/pageBlocks";
import {
  batchLabel, isFixture, isUploadBatch, MIN_BASELINE_TILES, plural, useApi,
} from "../lib";
import { href, replaceRoute } from "../router";
import type { BatchSummary, Guide, Settings } from "../types";
import { Cat, ErrorPanel, IconCheck, Note, PAGE, Panel, SlotText, Spinner } from "./bits";
import { FoldedBlock, MovedBlock, NextBlock, TilesBlock, VerdictBlock, type Ctx } from "./compareBlocks";
import { BatchSelect } from "./Pickers";

interface RunState {
  batch: string;
  baseline: string | null;
  phase: "uploading" | "measuring";
  done: number;
  total: number;
  error?: string;
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

function Result({ ctx, settings, oneOff }: { ctx: Ctx; settings: Settings | null; oneOff: string | null }) {
  const { evidence } = ctx;
  const [fold, setFold] = useState<Record<string, boolean>>({});
  const [step, setStep] = useState<number | null>(null);
  const template = useApi(() => getGuide(evidence.batch, oneOff, "template"));
  const claudeOn = !!settings?.claude.available;
  const cached = useApi(() => (claudeOn ? getGuide(evidence.batch, oneOff, "claude") : Promise.resolve(null)), [claudeOn]);
  const claudeOk = cached.data?.source === "claude" ? cached.data : null;
  const tourGuide = claudeOk ?? template.data;
  const steps = tourGuide?.steps ?? [];
  const current = step != null ? steps[step] : null;
  const target = current?.target ?? null;

  useEffect(() => {
    if (!target) return;
    const el = document.querySelector(`[data-tour="${target}"]`);
    window.setTimeout(() => el?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
  }, [step, target]);

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
  const seeAll = () => {
    setFold((open) => ({ ...open, props: true }));
    window.setTimeout(() => document.getElementById("all")?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
  };
  const blocks = pageBlocks(evidence, template.data);
  const shade = (id: BlockId) => (target == null ? "" : id === target ? "tour-on" : "tour-off");

  return (
    <>
      {blocks.map((id) => (
        <div key={id} id={id === "folded" ? "all" : undefined} data-tour={id === "folded" ? undefined : id} className={`tour-section scroll-mt-6 ${shade(id)}`}>
          {tourGuide && current && id === target && (
            <TourCard
              guide={tourGuide}
              index={step!}
              onBack={() => setStep((s) => Math.max(0, (s ?? 0) - 1))}
              onNext={() => (step != null && step >= steps.length - 1 ? finish() : setStep((s) => (s ?? 0) + 1))}
              onExit={finish}
            />
          )}
          {id === "verdict" && (
            <VerdictBlock ctx={ctx} guide={template.data} touring={step != null} onWalk={() => steps.length && setStep(0)} />
          )}
          {id === "moved" && <MovedBlock ctx={ctx} onSeeAll={seeAll} />}
          {id === "tiles" && <TilesBlock ctx={ctx} guide={template.data} onSeeAll={seeAll} />}
          {id === "next" && <NextBlock evidence={evidence} />}
          {id === "folded" && (
            <FoldedBlock ctx={ctx} open={fold} onToggle={(row) => setFold((open) => ({ ...open, [row]: !open[row] }))} />
          )}
        </div>
      ))}
    </>
  );
}

function TourCard({
  guide, index, onBack, onNext, onExit,
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
    <div role="dialog" aria-label={`Walkthrough step ${index + 1} of ${guide.steps.length}`} className="glass mb-4 flex flex-col gap-3 rounded-[18px] px-5 py-4" style={{ background: "rgba(28,29,34,.78)" }}>
      <div className="flex items-center gap-2.5">
        <span className="mono text-xs text-cx-muted">{index + 1} / {guide.steps.length}</span>
        <span className="text-[15px] font-semibold">{step.title}</span>
        {guide.source === "claude" && <span className="tag-claude ml-auto">CLAUDE</span>}
      </div>
      <p className="m-0 max-w-[780px] text-base leading-[1.6] text-cx-text">
        {step.sentences.map((s, i) => (
          <span key={i}><SlotText text={s} slots={guide.slots} /> </span>
        ))}
      </p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onExit} className="min-h-10 cursor-pointer rounded-[10px] border-0 bg-transparent px-3 text-[13px] text-cx-muted">Exit</button>
        {index > 0 && <button className="btn min-h-10" type="button" onClick={onBack}>Back</button>}
        <button className="btn pri min-h-10" type="button" onClick={onNext} autoFocus>{last ? "Finish" : "Next"}</button>
      </div>
    </div>
  );
}

