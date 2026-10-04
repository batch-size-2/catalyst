import { useEffect, useRef, useState } from "react";
import { getEvidence, getKpiDictionary, getSettings, listDecisions, verifyBatch } from "../api";
import lawsuitSound from "../assets/generate-lawsuit.mp3";
import { batchLabel, dropTwinShare, plural, quantityLabel, shortHash, useApi, utc } from "../lib";
import type { Decision, Evidence, KpiDictionary, VerifyResult } from "../types";
import markOnLight from "../../../design/logo/catalyst-mark-on-light.svg";
import { BatchDot, Cat, ErrorPanel, IconCheck, IconWarn, PAGE, PageHeader, Panel, Spinner, VerdictPill } from "./bits";

interface Entry {
  key: string;               // batch/baseline: one comparison
  no: string;                // "0001": position in the log by created_at, oldest first
  decision: Decision;
  evidence: Evidence | null; // null: it couldn't be loaded
}

type Result = VerifyResult | "error";

const STAMP_CLASS: Record<string, string> = {
  ACCEPT: "border-[#1D7A32] text-[#1D7A32]",
  INVESTIGATE: "border-[#8A6A00] text-[#6B5200]",
  REJECT: "border-[#B91C1C] text-[#B91C1C]",
};

const createdAt = (d: Decision) => Date.parse(d.created_at ?? "") || 0;
const pairLabel = (batch: string, baseline: string) =>
  batch === baseline ? `${batchLabel(batch)} against itself` : `${batchLabel(batch)} vs ${batchLabel(baseline)}`;

export default function Audit() {
  const dict = useApi(getKpiDictionary);
  const settings = useApi(getSettings);
  const entries = useApi(async () => {
    const decisions = (await listDecisions()).sort((a, b) => createdAt(a) - createdAt(b));
    const results = await Promise.allSettled(decisions.map((d) => getEvidence(d.batch, d.baseline)));
    return decisions
      .map((d, i): Entry => ({
        key: `${d.batch}/${d.baseline}`,
        no: String(i + 1).padStart(4, "0"),
        decision: d,
        evidence: results[i].status === "fulfilled" ? results[i].value : null,
      }))
      .reverse();
  });
  const [sel, setSel] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [results, setResults] = useState<Record<string, Result>>({});
  const list = entries.data ?? [];
  const current = list.find((e) => e.evidence && e.key === sel) ?? list.find((e) => e.evidence);
  const frozen = settings.data?.rules_frozen_commit ? settings.data : null;
  const changedConfig = Object.entries(frozen?.rules_frozen_config ?? {})
    .filter(([, v]) => v.frozen && v.now !== v.frozen)
    .map(([name]) => name);

  async function verifyAll() {
    setVerifying(true);
    const out: Record<string, Result> = {};
    for (const { key, decision } of list) {
      try {
        out[key] = await verifyBatch(decision.batch, decision.baseline);
      } catch {
        out[key] = "error";
      }
    }
    setResults(out);
    setVerifying(false);
  }

  const done = Object.values(results);
  const verified = done.length > 0;
  const failed = done.filter((r) => r === "error").length;
  const mismatched = done.filter((r) => r !== "error" && !r.ok).length;
  const rehashed = new Set(done.flatMap((r) => (r === "error" ? [] : r.files.map((f) => f.path)))).size;
  const allOk = verified && !failed && !mismatched;
  const issues = (
    [
      [mismatched, mismatched === 1 ? "no longer matches" : "no longer match"],
      [failed, "couldn't be checked"],
    ] as [number, string][]
  )
    .filter(([n]) => n)
    .map(([n, what], i) => `${i ? n : plural(n, "decision")} ${what}`)
    .join(" · ");

  return (
    <div className={`${PAGE} print-block gap-7`}>
      <div className="print-hidden">
        <PageHeader
          title="Every call, and proof nothing moved"
          intro="Each decision is logged with the image hashes, rules and code it used. Re-hash them any time to check nothing changed."
        />
      </div>

      <section
        className="glass print-hidden flex flex-wrap items-center gap-6 rounded-[22px] px-6 py-5"
        style={{ background: "linear-gradient(180deg, rgba(255,122,47,.08), rgba(255,255,255,.02))" }}
      >
        <div className="grid h-12 w-12 place-items-center rounded-[14px] border border-cx-orange/30 bg-cx-orange/[0.14] text-cx-orange-text">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d={settings.data && !frozen ? "M8 11V8a4 4 0 0 1 7.5-2" : "M8 11V8a4 4 0 0 1 8 0v3"} />
          </svg>
        </div>
        <div className="flex min-w-[260px] flex-1 flex-col gap-1">
          {settings.loading ? (
            <>
              <span className="h-5 w-64 animate-pulse rounded-md bg-white/[0.08]" />
              <span className="h-4 w-28 animate-pulse rounded-md bg-white/[0.06]" />
            </>
          ) : settings.error ? (
            <>
              <span className="text-base font-medium">Couldn't read the rules freeze</span>
              <span className="text-xs text-cx-muted">{settings.error}</span>
            </>
          ) : frozen ? (
            <>
              <span className="text-base font-medium">Rules frozen {utc(frozen.rules_frozen_date)}</span>
              <span
                className="mono w-fit text-xs text-cx-muted"
                title={Object.entries(frozen.rules_frozen_config)
                  .map(([name, v]) => `${name} ${shortHash(v.frozen)}${v.frozen && v.now !== v.frozen ? " (changed since)" : ""}`)
                  .join("\n")}
              >
                commit {shortHash(frozen.rules_frozen_commit, 7)}
                {changedConfig.length > 0 && (
                  <span className="text-cx-investigate-text"> · {changedConfig.join(", ")} changed since</span>
                )}
              </span>
            </>
          ) : (
            <span className="text-base font-medium">Rules not frozen yet</span>
          )}
        </div>
        {verified && (
          <span
            className={`inline-flex min-h-11 items-center gap-2.5 rounded-xl border px-4 text-sm ${
              allOk
                ? "border-cx-accept/30 bg-cx-accept/10 text-cx-accept-text"
                : mismatched
                  ? "border-cx-reject/40 bg-cx-reject/10 text-cx-reject-text"
                  : "border-cx-investigate/40 bg-cx-investigate/10 text-cx-investigate-text"
            }`}
          >
            {allOk ? <IconCheck size={16} /> : <IconWarn size={16} />}
            {allOk
              ? `${list.length === 1 ? "The decision is" : `All ${list.length} decisions`} unchanged · ${plural(rehashed, "file")} re-hashed`
              : issues}
          </span>
        )}
        <button
          className={`btn ${verified ? "" : "pri"}`}
          type="button"
          disabled={verifying || !list.length}
          onClick={() => void verifyAll()}
        >
          {verifying ? <Spinner size={16} color={verified ? undefined : "var(--cx-on-orange)"} /> : null}
          {verified ? "Verify again" : "Verify everything"}
        </button>
      </section>

      {entries.error ? (
        <div className="print-hidden">
          <ErrorPanel title="Couldn't load the decision log" message={entries.error} />
        </div>
      ) : (
        <div className="print-block grid grid-cols-12 gap-4">
          <Panel className="print-hidden col-span-7 min-w-0 self-start overflow-hidden p-0">
            <div className="flex items-center justify-between border-b border-cx-line px-5 py-4">
              <h2 className="m-0 text-[15px] font-medium">Decision log</h2>
              {!entries.loading && <span className="text-[13px] text-cx-faint">{list.length} entries</span>}
            </div>
            {entries.loading ? (
              <div className="flex items-center gap-3 px-5 py-8 text-sm text-cx-muted">
                <Spinner size={18} /> Loading decisions…
              </div>
            ) : list.length ? (
              list.map((entry) => (
                <Row
                  key={entry.key}
                  entry={entry}
                  selected={entry.key === current?.key}
                  oneOff={!!settings.data && entry.decision.batch !== entry.decision.baseline && entry.decision.baseline !== settings.data.baseline}
                  result={results[entry.key]}
                  onSelect={() => setSel(entry.key)}
                />
              ))
            ) : (
              <div className="flex items-center gap-3 px-5 py-8 text-sm text-cx-muted">
                <Cat mood="ready" size={34} />
                No decisions yet — run a batch from Compare.
              </div>
            )}
          </Panel>

          {current?.evidence && (
            <div className="print-block col-span-5 flex min-w-0 flex-col gap-4">
              <Passport ev={current.evidence} no={current.no} result={results[current.key]} dict={dict.data} />
              <Lawsuit key={current.key} ev={current.evidence} no={current.no} dict={dict.data} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({
  entry,
  selected,
  oneOff,
  result,
  onSelect,
}: {
  entry: Entry;
  selected: boolean;
  oneOff: boolean;
  result: Result | undefined;
  onSelect: () => void;
}) {
  const { batch, baseline } = entry.decision;
  const ev = entry.evidence;
  const prov = ev?.provenance;
  const check = result && (
    <span className={`shrink-0 ${result === "error" ? "text-cx-muted" : result.ok ? "text-cx-accept" : "text-cx-reject-text"}`}>
      {result === "error" ? "couldn't check" : result.ok ? "✓" : "✗ changed"}
    </span>
  );
  const meta = "flex min-w-0 flex-wrap gap-x-1.5 gap-y-1 text-xs whitespace-nowrap text-cx-faint";
  const cls =
    "grid w-full grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 border-0 border-b border-cx-line-soft px-5 py-2.5 text-left text-cx-text last:border-b-0";
  const no = <span className="mono text-xs text-cx-faint">#{entry.no}</span>;
  if (!ev)
    return (
      <div className={cls} style={{ minHeight: 64 }}>
        {no}
        <span className="flex min-w-0 flex-col gap-1">
          <span className="flex items-center gap-2 text-sm text-cx-investigate-text">
            <IconWarn size={14} /> Couldn't load this decision
          </span>
          <span className={meta}>
            <span className="truncate">{pairLabel(batch, baseline)} · {utc(entry.decision.created_at)}</span>
            {check}
          </span>
        </span>
      </div>
    );
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected || undefined}
      className={`${cls} cursor-pointer`}
      style={{
        background: selected ? "rgba(255,255,255,.05)" : "transparent",
        boxShadow: selected ? "inset 2px 0 0 var(--cx-orange)" : "none",
        font: "inherit",
        minHeight: 64,
      }}
    >
      {no}
      <span className="flex min-w-0 flex-col gap-1">
        <span className="flex min-w-0 items-center gap-2 text-sm">
          <BatchDot name={batch} size={8} />
          <span className="truncate">{pairLabel(batch, baseline)}</span>
          {oneOff && (
            <span className="shrink-0 text-xs text-cx-muted" title="Compared against a baseline other than the default">
              one-off
            </span>
          )}
        </span>
        <span className={meta}>
          <span className="truncate">
            {utc(prov?.created_at)} · <span className="mono">{shortHash(prov?.git_commit, 7)}</span> ·{" "}
            {plural(prov?.inputs.length ?? 0, "file")}
          </span>
          {check}
        </span>
      </span>
      <VerdictPill verdict={ev.verdict}>{ev.verdict}</VerdictPill>
    </button>
  );
}

function driverLabels(ev: Evidence, dict: KpiDictionary | null) {
  const byName = new Map(ev.differences.map((d) => [d.name, d]));
  return dropTwinShare(ev.drivers.map((name) => ({ name })), ev)
    .filter(({ name }) => byName.get(name)?.status !== "SIMILAR")
    .slice(0, 4)
    .map(({ name }) => quantityLabel(name, dict));
}

// Parody: plays the announcer, then pretends to assemble a claims pack from this record. Nothing is generated.
function Lawsuit({ ev, no, dict }: { ev: Evidence; no: string; dict: KpiDictionary | null }) {
  const prov = ev.provenance;
  const drivers = driverLabels(ev, dict).map((d) => (/^[A-Z][a-z]/.test(d) ? d[0].toLowerCase() + d.slice(1) : d));
  const steps = [
    `Exhibit A: batch passport #${no}, stamped ${ev.verdict}`,
    `Exhibit B: ${prov?.inputs.length ?? 0} image hashes, SHA-256, notarised`,
    prov?.rules_frozen_commit
      ? `Exhibit C: rules frozen ${utc(prov.rules_frozen_date)}`
      : "Exhibit C: rules not frozen yet (counsel winces)",
    `Exhibit D: ${ev.n_images.batch} vs ${ev.n_images.baseline} micrographs`,
    drivers.length
      ? `Claim: ${batchLabel(ev.batch)} is not what ${batchLabel(ev.baseline)} promised (${drivers.join(", ")})`
      : `Claim: ${batchLabel(ev.batch)} matches ${batchLabel(ev.baseline)}. Drafting it anyway`,
    "Couriering to Fictional & Partners LLP",
  ];
  const [step, setStep] = useState(-1);
  const audio = useRef<HTMLAudioElement | null>(null);
  const running = step >= 0 && step < steps.length;
  const done = step >= steps.length;

  useEffect(() => {
    if (!running) return;
    const t = window.setTimeout(() => setStep(step + 1), step === 0 ? 1500 : 700);
    return () => window.clearTimeout(t);
  }, [running, step]);
  useEffect(() => () => audio.current?.pause(), []);

  function generate() {
    audio.current ??= new Audio(lawsuitSound);
    audio.current.currentTime = 0;
    void audio.current.play().catch(() => undefined);
    setStep(0);
  }

  return (
    <section
      aria-label="Generate lawsuit"
      className="print-hidden flex flex-col gap-3.5 rounded-[22px] border border-[rgba(248,113,113,.3)] bg-[rgba(127,29,29,.18)] p-5"
    >
      <p className="m-0 text-[13px] leading-[1.5] text-[#D4D4D8]">
        Supplier shipped something other than the batch they promised? Turn this record into a claims pack for
        your lawyers.
      </p>
      <button
        type="button"
        className={`lawsuit-btn ${running ? "lawsuit-run" : ""}`}
        disabled={running}
        onClick={generate}
      >
        {running ? (
          <Spinner size={20} color="#fff" />
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m14.5 12.5-8 8a2.12 2.12 0 1 1-3-3l8-8M16 16l6-6M8 8l6-6M9 7l8 8M21 11l-8-8" />
          </svg>
        )}
        {running ? "GENERATING LAWSUIT" : done ? "GENERATE ANOTHER" : "GENERATE LAWSUIT"}
      </button>
      {step >= 0 && (
        <ol className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px]" aria-live="polite">
          {steps.slice(0, Math.min(step + 1, steps.length)).map((s, i) => (
            <li key={s} className="animate-rise flex items-start gap-2">
              <span className="mt-px grid w-4 shrink-0 place-items-center">
                {i < step ? <IconCheck size={14} /> : <Spinner size={12} color="#FCA5A5" />}
              </span>
              <span className={i < step ? "text-[#D4D4D8]" : "text-cx-text"}>{s}</span>
            </li>
          ))}
        </ol>
      )}
      {done && (
        <div
          className="animate-rise rounded-[14px] px-4 py-3.5 text-[#16171A]"
          style={{ background: "var(--cx-paper)" }}
        >
          <div className="mono text-[10px] tracking-[0.12em] text-[#5A5C62]">IN THE MATTER OF</div>
          <div className="mt-1 text-[15px] font-semibold">Fictional Cells Ltd v. Fictional Silicon Co.</div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-[#4A4C52]">
              Exhibits A–D attached · re: {batchLabel(ev.batch)} vs {batchLabel(ev.baseline)}
            </span>
            <span
              className="mono rounded-md border-2 border-[#B91C1C] px-2 py-1 text-[11px] font-bold tracking-[0.1em] text-[#B91C1C]"
              style={{ transform: "rotate(-4deg)" }}
            >
              READY FOR COUNSEL*
            </span>
          </div>
        </div>
      )}
      <span className="text-[11px] text-cx-faint">
        {done ? "* Not really. " : ""}Parody. Made-up parties; nothing is generated or filed.
      </span>
    </section>
  );
}

function Passport({
  ev,
  no,
  result,
  dict,
}: {
  ev: Evidence;
  no: string;
  result: Result | undefined;
  dict: KpiDictionary | null;
}) {
  const prov = ev.provenance;
  const drivers = driverLabels(ev, dict);
  const more = (prov?.inputs.length ?? 0) - 5;
  const changedFiles = result && result !== "error" ? result.files.filter((f) => !f.ok).length : 0;
  return (
    <section
      aria-label="Batch passport"
      className="passport relative flex flex-col gap-4 rounded-[22px] p-6 text-[#16171A]"
      style={{ background: "var(--cx-paper)", boxShadow: "0 30px 60px -30px rgba(0,0,0,.8)" }}
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2">
          <img src={markOnLight} alt="" width={22} height={22} />
          <span className="mono text-[11px] tracking-[0.12em]">BATCH PASSPORT</span>
        </span>
        <span className="mono text-[11px] text-[#5A5C62]">#{no}</span>
      </div>
      <div className="flex items-end justify-between gap-3 border-b border-black/[0.12] pb-4">
        <div className="flex flex-col gap-1">
          <span className="text-[30px] font-semibold tracking-[-0.03em]">{batchLabel(ev.batch)}</span>
          <span className="text-[13px] text-[#4A4C52]">
            Baseline {batchLabel(ev.baseline)} · {ev.n_images.batch} vs {ev.n_images.baseline} tiles
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
        {drivers.length > 0 && (
          <>
            <dt className="text-[#5A5C62]">Drivers</dt>
            <dd className="m-0">{drivers.join(" · ")}</dd>
          </>
        )}
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
          {prov?.git_dirty ? " (uncommitted changes)" : ""}
        </dd>
        <dt className="text-[#5A5C62]">Config</dt>
        <dd className="mono m-0 flex flex-col gap-[3px] text-xs">
          {Object.entries(prov?.config_sha256 ?? {}).map(([name, hash]) => (
            <span key={name} title={hash}>
              {shortHash(hash)}{" "}
              {name === "decision" ? (
                <>
                  decision.yaml <span className="whitespace-nowrap">(baseline {batchLabel(ev.baseline)})</span>
                </>
              ) : (
                name
              )}
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
          {more > 0 && <span className="text-[#5A5C62]">+ {more} more {more === 1 ? "file" : "files"}</span>}
          {result === "error" && <span className="text-[#5A5C62]">Couldn't check: re-hashing failed</span>}
          {result && result !== "error" && (
            <span className={`font-semibold ${result.ok ? "text-[#1D7A32]" : "text-[#B91C1C]"}`}>
              {result.ok
                ? "✓ re-hashed: inputs and config unchanged"
                : `✗ ${[changedFiles && `${plural(changedFiles, "input")} changed`, !result.config_ok && "config changed"]
                    .filter(Boolean)
                    .join(" · ")}`}
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
