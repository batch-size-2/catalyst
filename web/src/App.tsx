import { useEffect, useState } from "react";
import { getConfig, getEvidence, listBatches, runBatch, uploadBatch } from "./api";
import KpiBands from "./components/KpiBands";
import RunProgress, { type RunState } from "./components/RunProgress";
import Sidebar from "./components/Sidebar";
import TileGallery from "./components/TileGallery";
import VerdictCard from "./components/VerdictCard";
import type { BatchSummary, Config, Evidence } from "./types";

export default function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [run, setRun] = useState<RunState | null>(null);

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
        }
      });
    } catch (error) {
      setRun((r) => r && { ...r, error: String(error) });
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
        onSelect={setSelected}
        onRun={startRun}
      />
      <main className="flex-1 space-y-6 p-8">
        {run && <RunProgress run={run} />}
        {evidence ? (
          <div key={evidence.batch} className="space-y-6">
            <VerdictCard evidence={evidence} ciLevel={config?.ci_level ?? 0.9} />
            <KpiBands evidence={evidence} />
            <TileGallery evidence={evidence} />
          </div>
        ) : (
          !run && (
            <div className="grid h-full place-items-center text-slate-400">
              Ingest a batch folder from the sidebar to get a verdict.
            </div>
          )
        )}
      </main>
    </div>
  );
}
