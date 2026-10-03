import { maskUrl } from "../api";

export interface RunState {
  batch: string;
  phase: "uploading" | "measuring";
  done: number;
  total: number;
  tiles: string[];
  error?: string;
}

export default function RunProgress({ run }: { run: RunState }) {
  const title = run.error ? "Run failed" : run.phase === "uploading" ? `Uploading ${run.batch}` : `Measuring ${run.batch}`;
  return (
    <section className="animate-rise rounded-2xl border border-white/5 bg-slate-900/60 p-6">
      <div className="flex items-baseline justify-between">
        <h2 className="font-medium">{title}</h2>
        <span className="font-mono text-sm text-slate-400 tabular-nums">
          {run.done}/{run.total || "…"}
        </span>
      </div>
      {run.error ? (
        <p className="mt-2 text-sm text-rose-300">{run.error}</p>
      ) : (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/5">
          <div
            className="h-full rounded-full bg-sky-400 transition-all duration-300"
            style={{ width: `${run.total ? (100 * run.done) / run.total : 0}%` }}
          />
        </div>
      )}
      <div className="mt-4 flex gap-2 overflow-x-auto">
        {run.tiles.map((tile) => {
          const [batch, imageId] = tile.split("/");
          return <img key={tile} src={maskUrl(batch, imageId)} alt={tile} title={tile} className="animate-rise h-16 rounded-md" />;
        })}
      </div>
    </section>
  );
}
