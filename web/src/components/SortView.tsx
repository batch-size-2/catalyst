import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { getAttribution, listAttributions, runAttribution, uploadBatch } from "../api";
import type { Attribution, AttributionEvent } from "../types";
import ImageCallCard from "./ImageCallCard";
import RunProgress, { type RunState } from "./RunProgress";

function defaultRunName() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `sample-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function evaluationText(attribution: Attribution) {
  return attribution.evaluations.map((evaluation) => {
    const details = [
      evaluation.null_95 == null ? null : `shuffled-label 95th percentile ${evaluation.null_95.toPrecision(3)}`,
      `n ${evaluation.n}`,
    ].filter(Boolean);
    return `${evaluation.scheme}: balanced accuracy ${evaluation.balanced_accuracy.toPrecision(3)} (${details.join(", ")})`;
  });
}

export default function SortView() {
  const [runs, setRuns] = useState<string[]>([]);
  const [selectedRun, setSelectedRun] = useState("");
  const [runName, setRunName] = useState(defaultRunName);
  const [files, setFiles] = useState<File[]>([]);
  const [attribution, setAttribution] = useState<Attribution | null>(null);
  const [progress, setProgress] = useState<RunState | null>(null);
  const busy = !!progress && !progress.error;

  async function refreshRuns() {
    try {
      const listed = await listAttributions();
      setRuns(listed);
      setSelectedRun((current) => current || (listed.includes("known") ? "known" : listed[0] ?? ""));
    } catch {
      setRuns([]);
    }
  }

  useEffect(() => {
    void refreshRuns();
  }, []);

  useEffect(() => {
    if (!selectedRun) return;
    let current = true;
    getAttribution(selectedRun).then(
      (loaded) => {
        if (current) setAttribution(loaded);
      },
      () => {
        if (current) setAttribution(null);
      },
    );
    return () => {
      current = false;
    };
  }, [selectedRun]);

  function onFiles(event: ChangeEvent<HTMLInputElement>) {
    setFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  }

  async function sort(event: FormEvent) {
    event.preventDefault();
    const name = runName.trim();
    if (!name || files.length === 0) return;
    setProgress({ batch: name, phase: "uploading", done: 0, total: 0, tiles: [] });
    try {
      await uploadBatch(name, files);
      setProgress((state) => state && { ...state, phase: "measuring" });
      await runAttribution(name, (event: AttributionEvent) => {
        if (event.type === "progress") {
          setProgress((state) => state && {
            ...state,
            done: event.done,
            total: event.total,
            tiles: [...state.tiles, event.tile],
          });
        }
        if (event.type === "error") setProgress((state) => state && { ...state, error: event.message });
        if (event.type === "done") {
          setAttribution(event.attribution);
          setSelectedRun(event.attribution.run);
          setProgress(null);
          void refreshRuns();
        }
      });
    } catch (error) {
      setProgress((state) => state && { ...state, error: errorMessage(error) });
    }
  }

  return (
    <div className="space-y-6">
      <section className="animate-rise rounded-2xl border border-white/5 bg-slate-900/60 p-6">
        <h2 className="font-medium">Sort a set of images</h2>
        <p className="mt-1 text-sm text-slate-400">Upload the BSE, ETD and InLens files of one or more images; each image is placed in a known batch, with the reasons.</p>
        <form className="mt-5 grid gap-4 md:grid-cols-[1fr_2fr_auto] md:items-end" onSubmit={sort}>
          <label className="block text-xs text-slate-400">
            Run name
            <input value={runName} onChange={(event) => setRunName(event.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" />
          </label>
          <label className="block text-xs text-slate-400">
            Images (.tif, .tiff)
            <input type="file" multiple accept=".tif,.tiff" onChange={onFiles}
              className="mt-1 block w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-3 file:py-1 file:text-xs file:text-white" />
          </label>
          <button type="submit" disabled={!runName.trim() || files.length === 0 || busy}
            className="rounded-lg bg-sky-400 px-5 py-2 text-sm font-medium text-slate-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-40">
            Sort
          </button>
        </form>
        <p className="mt-2 text-xs text-slate-500">
          {files.length ? `${files.length} image${files.length === 1 ? "" : "s"} selected` : "TIFF images only"}
        </p>
      </section>

      {progress && <RunProgress run={progress} />}

      <section className="animate-rise rounded-2xl border border-white/5 bg-slate-900/60 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-medium">Attribution results</h2>
          {runs.length > 0 && (
            <select value={selectedRun} onChange={(event) => setSelectedRun(event.target.value)}
              className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white">
              {runs.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          )}
        </div>
        {runs.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">
            No sorted images yet. To preview the layout: <code>cp tests/fixtures/attribution_example.json out/attribution/example_drop.json</code>.
          </p>
        ) : attribution ? (
          <div className="mt-5 space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-white">{attribution.run}</h3>
              {attribution.model && (
                <p className="mt-1 font-mono text-xs text-slate-500">
                  {attribution.model.path} · {attribution.model.sha256.slice(0, 8)}
                </p>
              )}
              <ul className="mt-2 space-y-1 text-xs text-slate-400">
                {evaluationText(attribution).map((text) => <li key={text}>{text}</li>)}
              </ul>
            </div>
            {attribution.calls.map((call) => (
              <ImageCallCard key={call.image_id} call={call} attribution={attribution} />
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-500">Loading attribution…</p>
        )}
      </section>
    </div>
  );
}
