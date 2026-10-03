import { batchColor } from "../colors";

interface Props {
  title: string;
  subtitle: string;
  confusion: Record<string, Record<string, number>>;
  batches: string[];
}

export default function ConfusionMatrix({ title, subtitle, confusion, batches }: Props) {
  return (
    <section className="overflow-x-auto rounded-2xl border border-white/5 bg-slate-900/60 p-5">
      <h3 className="font-medium">{title}</h3>
      <p className="mt-1 text-xs text-slate-400">{subtitle}</p>
      <table className="mt-4 min-w-full text-center text-xs">
        <thead>
          <tr className="text-slate-500">
            <th className="px-3 py-2 text-left font-normal">truth / predicted</th>
            {batches.map((batch) => (
              <th key={batch} className="px-3 py-2 font-medium" style={{ color: batchColor(batch, batches) }}>
                {batch}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {batches.map((truth) => (
            <tr key={truth} className="border-t border-white/5">
              <th className="px-3 py-2 text-left font-medium" style={{ color: batchColor(truth, batches) }}>
                {truth}
              </th>
              {batches.map((predicted) => (
                <td key={predicted} className={`px-3 py-2 font-mono tabular-nums ${
                  truth === predicted ? "bg-emerald-400/10 text-emerald-200" : "text-slate-400"
                }`}>
                  {confusion[truth]?.[predicted] ?? 0}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
