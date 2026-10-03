import type { Evidence } from "../types";

const short = (hash: string | null | undefined) => (hash ? hash.slice(0, 8) : "—");

export default function ProvenancePanel({ evidence }: { evidence: Evidence }) {
  const provenance = evidence.provenance;
  if (!provenance) return null;
  const stats = [
    ["commit", `${short(provenance.git_commit)}${provenance.git_dirty ? " (dirty)" : ""}`],
    [
      "rules frozen",
      provenance.rules_frozen_commit
        ? `${short(provenance.rules_frozen_commit)} · ${provenance.rules_frozen_date}`
        : "not frozen",
    ],
    ["config hash", short(provenance.config_sha256.decision)],
    ["created", provenance.created_at],
  ];
  return (
    <section className="animate-rise rounded-2xl border border-white/5 bg-slate-900/60 p-6">
      <h2 className="font-medium">Provenance</h2>
      <dl className="mt-4 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
        {stats.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd className="mt-1 font-mono text-slate-300">{value}</dd>
          </div>
        ))}
      </dl>
      <details className="mt-4 text-xs text-slate-400">
        <summary className="cursor-pointer">{provenance.inputs.length} input files</summary>
        <ul className="mt-2 space-y-0.5 font-mono">
          {provenance.inputs.map((input) => (
            <li key={input.path}>
              {input.path} <span className="text-slate-500">{input.sha256.slice(0, 12)}</span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
