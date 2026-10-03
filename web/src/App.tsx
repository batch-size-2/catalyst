import { useEffect, useState } from "react";
import { getConfig, getEvidence, listBatches, runBatch, uploadBatch } from "./api";
import BatchVerdictView from "./components/BatchVerdictView";
import DifferentView from "./components/DifferentView";
import RunProgress, { type RunState } from "./components/RunProgress";
import Sidebar from "./components/Sidebar";
import SortView from "./components/SortView";
import type { BatchSummary, Config, Evidence } from "./types";

type View = "sort" | "different" | "batch";

export default function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [run, setRun] = useState<RunState | null>(null);
  const [view, setView] = useState<View>("sort");

  const refresh = () =>
    listBatches().then((list) => {
      setBatches(list);
      setSelected((current) => current ?? list.find((batch) => batch.verdict)?.name ?? null);
    });

  useEffect(() => {
    getConfig().then(setConfig);
    refresh();
  }, []);

  useEffect(() => {
    if (selected) getEvidence(selected).then(setEvidence, () => setEvidence(null));
  }, [selected]);

  function selectBatch(batch: string) {
    setSelected(batch);
    setView("batch");
  }

  async function startRun(batch: string, files?: File[]) {
    setRun({ batch, phase: files ? "uploading" : "measuring", done: 0, total: 0, tiles: [] });
    try {
      if (files) await uploadBatch(batch, files);
      setRun((r) => r && { ...r, phase: "measuring" });
      await runBatch(batch, (event) => {
        if (event.type === "progress")
          setRun((r) => r && { ...r, done: event.done, total: event.total, tiles: [...r.tiles, event.tile] });
        if (event.type === "error") setRun((r) => r && { ...r, error: event.message });
        if (event.type === "done") {
          setRun(null);
          setSelected(event.evidence.batch);
          setEvidence(event.evidence);
          setView("batch");
        }
      });
    } catch (error) {
      setRun((r) => r && { ...r, error: error instanceof Error ? error.message : String(error) });
    }
    refresh();
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar
        config={config}
        batches={batches}
        selected={selected}
        busy={!!run && !run.error}
        onSelect={selectBatch}
        onRun={startRun}
      />
      <main className="min-w-0 flex-1 space-y-6 p-8">
        <nav className="flex gap-2" aria-label="Main views">
          {([
            ["sort", "Sort images"],
            ["different", "What's different"],
            ["batch", "Batch verdict"],
          ] as [View, string][]).map(([key, title]) => (
            <button
              key={key}
              type="button"
              className={`rounded-full px-4 py-2 text-sm transition ${
                view === key ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5 hover:text-white"
              }`}
              aria-current={view === key ? "page" : undefined}
              onClick={() => setView(key)}
            >
              {title}
            </button>
          ))}
        </nav>
        {run && <RunProgress run={run} />}
        {view === "sort" && <SortView />}
        {view === "different" && <DifferentView />}
        {view === "batch" && (evidence
          ? <BatchVerdictView evidence={evidence} batches={batches.map((batch) => batch.name)} />
          : <div className="rounded-2xl border border-white/5 bg-slate-900/60 p-8 text-slate-400">
              Select or run a batch to see its verdict.
            </div>)}
      </main>
    </div>
  );
}
