import { useState } from "react";
import { getEvidence, getKpiDictionary, getSettings, listDecisions, verifyBatch } from "../api";
import { batchLabel, dropTwinShare, quantityLabel, shortHash, useApi, utc } from "../lib";
import type { Evidence, KpiDictionary, VerifyResult } from "../types";
import { BatchDot, CAT, Cat, IconCheck, IconWarn, Panel, Spinner, VerdictPill } from "./bits";

interface Entry {
  key: string;            // batch/baseline: one comparison
  batch: string;
  evidence: Evidence;
}

const STAMP_CLASS: Record<string, string> = {
  ACCEPT: "border-[#1D7A32] text-[#1D7A32]",
  INVESTIGATE: "border-[#8A6A00] text-[#6B5200]",
  REJECT: "border-[#B91C1C] text-[#B91C1C]",
};

export default function Audit() {
  const dict = useApi(getKpiDictionary);
  const settings = useApi(getSettings);
  const defaultBaseline = settings.data?.baseline;
  const entries = useApi(async () => {
    const decisions = await listDecisions();
    const results = await Promise.allSettled(decisions.map((d) => getEvidence(d.batch, d.baseline)));
    return results
      .filter((r): r is PromiseFulfilledResult<Evidence> => r.status === "fulfilled")
      .map((r) => ({ key: `${r.value.batch}/${r.value.baseline}`, batch: r.value.batch, evidence: r.value }))
      .sort((a, b) =>
        (b.evidence.provenance?.created_at ?? "").localeCompare(a.evidence.provenance?.created_at ?? ""),
      );
  });
  const [sel, setSel] = useState(0);
  const [verifying, setVerifying] = useState(false);
  const [results, setResults] = useState<Record<string, VerifyResult | "error">>({});
  const list = entries.data ?? [];
  const current = list[Math.min(sel, list.length - 1)];
  const frozen = list.map((e) => e.evidence.provenance).find((p) => p?.rules_frozen_commit);

  async function verifyAll() {
    setVerifying(true);
    const out: Record<string, VerifyResult | "error"> = {};
    for (const entry of list) {
      try {
        out[entry.key] = await verifyBatch(entry.batch, entry.evidence.baseline);
      } catch {
        out[entry.key] = "error";
      }
    }
    setResults(out);
    setVerifying(false);
  }

  const verified = Object.keys(results).length > 0;
  const allOk = verified && list.every((e) => {
    const result = results[e.key];
    return typeof result === "object" && result.ok;
  });

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-7 px-10 py-10">
      <div className="print-hidden flex flex-col gap-2.5">
        <div className="lbl text-cx-orange-text">Audit</div>
        <h1 className="m-0 text-[40px] leading-[1.1] font-semibold tracking-[-0.03em]">
          Every call, and proof nothing moved
        </h1>
        <p className="m-0 max-w-[640px] text-base leading-[1.55] text-cx-muted">
          Each decision is logged with the image hashes, rules and code it used — re-hash the inputs any
          time to check nothing changed since.
        </p>
      </div>

      <section
        className="glass print-hidden flex flex-wrap items-center gap-6 rounded-[22px] px-6 py-5"
        style={{ background: "linear-gradient(180deg, rgba(255,122,47,.08), rgba(255,255,255,.02))" }}
      >
        <div className="grid h-12 w-12 place-items-center rounded-[14px] border border-cx-orange/30 bg-cx-orange/[0.14] text-cx-orange-text">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
        </div>
        <div className="flex min-w-[260px] flex-1 flex-col gap-1">
          <span className="text-base font-medium">
            {frozen ? "Rules frozen before the held-back data arrived" : "Rules not frozen yet"}
          </span>
          <span className="mono text-xs text-cx-muted">
            {frozen ? (
              <>
                rules-frozen · {utc(frozen.rules_frozen_date)} · commit{" "}
                {shortHash(frozen.rules_frozen_commit, 7)}
                {Object.entries(frozen.config_sha256)
                  .filter(([k]) => k !== "decision")
                  .map(([k, v]) => ` · ${k.replace(/\.\w+$/, "")} ${shortHash(v)}`)}
              </>
            ) : (
              "run `git tag rules-frozen` once the config and models are final"
            )}
          </span>
        </div>
        {!verified && (
          <button className="btn pri" type="button" disabled={verifying || !list.length} onClick={() => void verifyAll()}>
            {verifying ? <Spinner size={16} color="var(--cx-on-orange)" /> : null}
            Verify everything
          </button>
        )}
        {verified && (
          <span
            className={`inline-flex min-h-11 items-center gap-2.5 rounded-xl border px-4 text-sm ${
              allOk
                ? "border-cx-accept/30 bg-cx-accept/10 text-cx-accept-text"
                : "border-cx-investigate/40 bg-cx-investigate/10 text-cx-investigate-text"
            }`}
          >
            {allOk ? <IconCheck size={16} /> : <IconWarn size={16} />}
            {allOk
              ? `Re-hashed every input of ${list.length} decisions · identical`
              : "Some inputs no longer match their recorded hash"}
          </span>
        )}
      </section>

      <div className="grid grid-cols-12 gap-4">
        <Panel className="print-hidden col-span-7 min-w-0 overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-cx-line px-5 py-4">
            <h2 className="m-0 text-[15px] font-medium">Decision log</h2>
            <span className="text-[13px] text-cx-faint">{list.length} entries</span>
          </div>
          {list.length ? (
            list.map((entry, i) => {
              const prov = entry.evidence.provenance;
              const result = results[entry.key];
              return (
                <button
                  key={entry.key}
                  type="button"
                  onClick={() => setSel(i)}
                  className="grid w-full cursor-pointer grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-4 border-0 border-b border-cx-line-soft px-5 py-2.5 text-left text-cx-text"
                  style={{
                    background: sel === i ? "rgba(255,255,255,.05)" : "transparent",
                    boxShadow: sel === i ? "inset 2px 0 0 var(--cx-orange)" : "none",
                    font: "inherit",
                    minHeight: 64,
                  }}
                >
                  <span className="mono text-xs text-cx-faint">#{String(list.length - i).padStart(4, "0")}</span>
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="flex items-center gap-2 text-sm">
                      <BatchDot name={entry.batch} size={8} />
                      Compared {batchLabel(entry.batch)} with {batchLabel(entry.evidence.baseline)}
                      {entry.evidence.baseline !== defaultBaseline && (
                        <span className="mono rounded-[5px] border border-cx-batch-2/40 px-1.5 py-px text-[10px] text-cx-batch-2">ONE-OFF BASELINE</span>
                      )}
                    </span>
                    <span className="text-xs text-cx-faint">
                      {utc(prov?.created_at)} ·{" "}
                      <span className="mono">
                        {shortHash(prov?.git_commit, 7)}
                        {prov?.git_dirty ? " · dirty" : ""} · {prov?.inputs.length ?? 0} files
                      </span>
                      {result && result !== "error" && (
                        <span className={`mono ml-2 ${result.ok ? "text-cx-accept" : "text-cx-reject"}`}>
                          {result.ok ? "✓" : "✗"}
                        </span>
                      )}
                      {result === "error" && <span className="mono ml-2 text-cx-faint">n/a</span>}
                    </span>
                  </span>
                  <VerdictPill verdict={entry.evidence.verdict}>{entry.evidence.verdict}</VerdictPill>
                </button>
              );
            })
          ) : (
            <div className="flex items-center gap-3 px-5 py-8 text-sm text-cx-muted">
              <Cat mood="ready" size={34} />
              No decisions yet — run a batch from Compare.
            </div>
          )}
        </Panel>

        <div className="col-span-5 flex min-w-0 flex-col gap-4">
          {current ? (
            <Passport entry={current} index={list.length - sel} result={results[current.key]} dict={dict.data} />
          ) : (
            <Panel className="print-hidden flex items-center gap-3 text-sm text-cx-muted">
              <Cat mood="ready" size={34} />
              Select a decision to see its batch passport.
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

function Passport({
  entry,
  index,
  result,
  dict,
}: {
  entry: Entry;
  index: number;
  result: VerifyResult | "error" | undefined;
  dict: KpiDictionary | null;
}) {
  const ev = entry.evidence;
  const prov = ev.provenance;
  const byName = new Map(ev.differences.map((d) => [d.name, d]));
  const drivers = dropTwinShare(ev.drivers.map((name) => ({ name })), ev)
    .filter(({ name }) => byName.get(name)?.status !== "SIMILAR")
    .slice(0, 4)
    .map(({ name }, i) => (i ? quantityLabel(name, dict).toLowerCase() : quantityLabel(name, dict)));
  return (
    <section
      aria-label="Batch passport"
      className="passport relative flex flex-col gap-4 rounded-[22px] p-6 text-[#16171A]"
      style={{ background: "var(--cx-paper)", boxShadow: "0 30px 60px -30px rgba(0,0,0,.8)" }}
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2">
          <img src={CAT.mark} alt="" width={22} height={22} />
          <span className="mono text-[11px] tracking-[0.12em]">BATCH PASSPORT</span>
        </span>
        <span className="mono text-[11px] text-[#5A5C62]">#{String(index).padStart(4, "0")}</span>
      </div>
      <div className="flex items-end justify-between gap-3 border-b border-black/[0.12] pb-4">
        <div className="flex flex-col gap-1">
          <span className="text-[30px] font-semibold tracking-[-0.03em]">{batchLabel(ev.batch)}</span>
          <span className="text-[13px] text-[#4A4C52]">
            vs baseline {batchLabel(ev.baseline)} · {ev.n_images.batch} vs {ev.n_images.baseline} tiles
          </span>
        </div>
        <span
          className={`mono rounded-lg border-[1.5px] px-2.5 py-1.5 text-xs font-semibold tracking-[0.08em] ${STAMP_CLASS[ev.verdict]}`}
          style={{ transform: "rotate(-3deg)" }}
        >
          {ev.verdict}
        </span>
      </div>
      <dl className="m-0 grid grid-cols-[112px_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-[13px]">
        <dt className="text-[#5A5C62]">Drivers</dt>
        <dd className="m-0">{drivers.join(", ") || "—"}</dd>
        <dt className="text-[#5A5C62]">Summary</dt>
        <dd className="m-0">{ev.explanations.summary}</dd>
        {ev.explanations.rules.length > 0 && (
          <>
            <dt className="text-[#5A5C62]">Rules fired</dt>
            <dd className="m-0 flex flex-col gap-1">
              {ev.explanations.rules.map((r) => (
                <span key={r}>{r}</span>
              ))}
            </dd>
          </>
        )}
        <dt className="text-[#5A5C62]">Created</dt>
        <dd className="mono m-0">{utc(prov?.created_at)}</dd>
        <dt className="text-[#5A5C62]">Code</dt>
        <dd className="mono m-0">
          {shortHash(prov?.git_commit, 12)}
          {prov?.git_dirty ? " (dirty)" : ""}
        </dd>
        <dt className="text-[#5A5C62]">Config</dt>
        <dd className="mono m-0 flex flex-col gap-[3px] text-xs">
          {Object.entries(prov?.config_sha256 ?? {}).map(([name, hash]) => (
            <span key={name} title={hash}>
              {shortHash(hash)} {name === "decision" ? `decision.yaml as run (baseline ${batchLabel(ev.baseline)})` : name}
            </span>
          ))}
        </dd>
        <dt className="text-[#5A5C62]">Inputs</dt>
        <dd className="mono m-0 flex flex-col gap-[3px] text-xs">
          {(prov?.inputs ?? []).slice(0, 5).map((input) => (
            <span key={input.path} title={input.sha256}>
              {shortHash(input.sha256)} {input.path}
            </span>
          ))}
          {(prov?.inputs.length ?? 0) > 5 && (
            <span className="text-[#5A5C62]">+ {(prov?.inputs.length ?? 0) - 5} more SHA-256</span>
          )}
          {result && result !== "error" && (
            <span className={`font-semibold ${result.ok ? "text-[#1D7A32]" : "text-[#B91C1C]"}`}>
              {result.ok ? "✓ re-hashed, identical" : "✗ hash mismatch"}
              {result.config_ok ? "" : " · config changed"}
            </span>
          )}
        </dd>
      </dl>
      <div className="print-hidden flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border-0 bg-[#16171A] px-4 text-sm font-medium text-[#F3F1EC]"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
            <rect x="6" y="14" width="12" height="7" />
          </svg>
          Print
        </button>
      </div>
    </section>
  );
}
