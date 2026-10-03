import type { ChangeEvent } from "react";
import { VERDICT_STYLE } from "../colors";
import type { BatchSummary, Config } from "../types";

interface Props {
  config: Config | null;
  batches: BatchSummary[];
  selected: string | null;
  busy: boolean;
  onSelect: (batch: string) => void;
  onRun: (batch: string, files?: File[]) => void;
}

export default function Sidebar({ config, batches, selected, busy, onSelect, onRun }: Props) {
  function onFolder(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])].filter((file) => /\.tiff?$/i.test(file.name));
    const name = files[0]?.webkitRelativePath.split("/")[0];
    if (name) onRun(name, files);
    event.target.value = "";
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-white/5 bg-slate-900/40 p-6">
      <h1 className="text-lg font-semibold tracking-tight">Catalyst</h1>
      <p className="text-xs text-slate-400">Batch QC for electrode microstructure</p>

      <label
        className={`mt-8 flex cursor-pointer flex-col items-center gap-1 rounded-xl border border-dashed border-sky-400/40 bg-sky-400/5 px-4 py-6 text-center transition hover:bg-sky-400/10 ${busy ? "pointer-events-none opacity-50" : ""}`}
      >
        <span className="text-sm font-medium text-sky-300">Ingest a batch folder</span>
        <span className="text-xs text-slate-400">BSE · ETD · InLens TIFFs</span>
        <input type="file" className="hidden" multiple {...{ webkitdirectory: "" }} onChange={onFolder} />
      </label>

      <h2 className="mt-8 mb-2 text-xs font-medium tracking-wider text-slate-500 uppercase">Batches</h2>
      <ul className="space-y-1">
        {batches.map((batch) => (
          <li
            key={batch.name}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 ${selected === batch.name ? "bg-white/10" : "hover:bg-white/5"}`}
          >
            <button
              className="flex-1 truncate text-left text-sm disabled:text-slate-500"
              disabled={!batch.verdict}
              onClick={() => onSelect(batch.name)}
            >
              {batch.name}
            </button>
            {batch.verdict && (
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${VERDICT_STYLE[batch.verdict].chip}`}>
                {batch.verdict}
              </span>
            )}
            {batch.has_images && (
              <button
                disabled={busy}
                onClick={() => onRun(batch.name)}
                className="rounded px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-white/10 hover:text-white disabled:opacity-40"
              >
                {batch.verdict ? "Re-run" : "Run"}
              </button>
            )}
          </li>
        ))}
      </ul>

      {config && (
        <p className="mt-auto pt-6 text-xs text-slate-500">
          Baseline <span className="font-mono text-slate-300">{config.baseline}</span> · config{" "}
          <span className="font-mono text-slate-300">{config.version}</span>
        </p>
      )}
    </aside>
  );
}
