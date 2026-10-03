import { STATUS_STYLE } from "../colors";
import type { Evidence } from "../types";

const fmt = (value: number | null) => (value == null ? "—" : value.toPrecision(3));

export default function Differences({ evidence }: { evidence: Evidence }) {
  return (
    <section className="animate-rise rounded-2xl border border-white/5 bg-slate-900/60 p-6">
      <h2 className="font-medium">Differences from the reference</h2>
      <p className="mt-1 text-xs text-slate-400">
        Means over strip segments in the {evidence.shared_strips.setting} variant, key quantities first. δ is the
        similarity margin.
      </p>
      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500">
            {["quantity", "unit", "reference", "batch", "difference", "interval", "δ", "p", "status"].map((h) => (
              <th key={h} className="py-1 pr-4 font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {evidence.differences.map((d) => (
            <tr key={d.name} className={`border-t border-white/5 ${d.key ? "" : "text-slate-500"}`}>
              <td className="py-1.5 pr-4 font-mono">
                {d.name}
                {d.note && <span className="ml-2 font-sans text-xs text-slate-500">({d.note})</span>}
              </td>
              <td className="pr-4 text-xs text-slate-500">{d.unit}</td>
              <td className="pr-4 tabular-nums">{fmt(d.reference)}</td>
              <td className="pr-4 tabular-nums">{fmt(d.batch)}</td>
              <td className="pr-4 tabular-nums">{fmt(d.difference)}</td>
              <td className="pr-4 tabular-nums">
                {d.interval ? `${fmt(d.interval[0])} – ${fmt(d.interval[1])}` : "—"}
              </td>
              <td className="pr-4 tabular-nums">{fmt(d.margin)}</td>
              <td className="pr-4 tabular-nums">{fmt(d.p)}</td>
              <td>
                <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[d.status].chip}`}>
                  {d.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
