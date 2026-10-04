import { useState } from "react";
import { fmtChange, type Impact, type ImpactReport, type Severity, type WorstCase } from "../impact";
import { Seg } from "./bits";

/**
 * How "if you ignore this" warnings are shown: options to compare before we pick one.
 * The choice is kept in localStorage; ?warnings=banner|cards|ladder|off sets it from a link.
 */
export type WarningStyle = "banner" | "cards" | "ladder" | "off";
const KEY = "catalyst.impact.warnings";
const STYLES: WarningStyle[] = ["banner", "cards", "ladder", "off"];

export function useWarningStyle(): [WarningStyle, (s: WarningStyle) => void] {
  const [style, setStyle] = useState<WarningStyle>(() => {
    const query = new URLSearchParams(window.location.search).get("warnings") as WarningStyle | null;
    if (query && STYLES.includes(query)) save(query);
    const stored = load();
    return stored && STYLES.includes(stored) ? stored : "cards";
  });
  return [style, (s) => {
    save(s);
    setStyle(s);
  }];
}

function load(): WarningStyle | null {
  try {
    return window.localStorage.getItem(KEY) as WarningStyle | null;
  } catch {
    return null;
  }
}

function save(style: WarningStyle) {
  try {
    window.localStorage.setItem(KEY, style);
  } catch {
    /* storage disabled: the choice lasts for this page only */
  }
}

export function WarningStylePicker({ value, onChange }: { value: WarningStyle; onChange: (s: WarningStyle) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="lbl text-[10px]">Failure modes</span>
      <Seg value={value} onChange={onChange} options={[
        { value: "banner", label: "Banner" },
        { value: "cards", label: "On cards" },
        { value: "ladder", label: "Ladder" },
        { value: "off", label: "Off" },
      ]} />
    </div>
  );
}

const SEVERITY: Record<Severity, { label: string; tone: string; border: string; bg: string; text: string }> = {
  safety: { label: "Safety", tone: "var(--cx-reject)", border: "border-cx-reject/40", bg: "bg-cx-reject/[0.08]", text: "text-cx-reject-text" },
  reliability: { label: "Reliability", tone: "var(--cx-investigate)", border: "border-cx-investigate/35", bg: "bg-cx-investigate/[0.07]", text: "text-cx-investigate-text" },
  performance: { label: "Performance", tone: "var(--cx-text-2)", border: "border-cx-line", bg: "bg-white/[0.03]", text: "text-cx-text-2" },
};
const ORDER: Severity[] = ["safety", "reliability", "performance"];

const TRIGGER = {
  likely: "This batch moves this way",
  possible: "Not ruled out by these images",
};

function SeverityIcon({ severity, size = 16 }: { severity: Severity; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {severity === "safety" && <path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5.3 1.6 1.2 2.5 2 2.5 0-3 .5-5.5 1-8z" />}
      {severity === "reliability" && <><path d="M12 4l9 16H3l9-16z" /><path d="M12 10v4M12 17h.01" /></>}
      {severity === "performance" && <><rect x="3" y="7" width="16" height="10" rx="2" /><path d="M21 11v2M7 10v4" /></>}
    </svg>
  );
}

function Chips({ wc }: { wc: WorstCase }) {
  const sev = SEVERITY[wc.severity];
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] font-medium ${sev.border} ${sev.bg} ${sev.text}`}>
        <SeverityIcon severity={wc.severity} size={12} />
        {sev.label}
      </span>
      <span className={`rounded-full border px-2 py-0.5 text-[11.5px] ${wc.trigger === "likely" ? "border-cx-line bg-white/10 text-cx-text" : "border-dashed border-cx-line text-cx-faint"}`}>
        {TRIGGER[wc.trigger]}
      </span>
    </span>
  );
}

function Chain({ wc, horizontal = false }: { wc: WorstCase; horizontal?: boolean }) {
  const tone = SEVERITY[wc.severity].tone;
  if (horizontal)
    return (
      <ol className="m-0 flex list-none flex-wrap items-stretch gap-1.5 p-0">
        {wc.chain.map((step, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <span className="max-w-[210px] rounded-[10px] border px-2.5 py-1.5 text-[12.5px] leading-snug"
              style={{
                borderColor: `color-mix(in srgb, ${tone} ${20 + (60 * i) / Math.max(1, wc.chain.length - 1)}%, transparent)`,
                color: i === wc.chain.length - 1 ? "var(--cx-text-strong)" : "var(--cx-text-2)",
                background: i === wc.chain.length - 1 ? `color-mix(in srgb, ${tone} 14%, transparent)` : undefined,
              }}>
              {step}
            </span>
            {i < wc.chain.length - 1 && <span aria-hidden className="text-cx-faint">→</span>}
          </li>
        ))}
      </ol>
    );
  return (
    <ol className="m-0 flex list-none flex-col gap-0 p-0">
      {wc.chain.map((step, i) => (
        <li key={i} className="flex gap-2.5">
          <span className="flex flex-col items-center">
            <span className="mono flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10.5px]"
              style={{ background: `color-mix(in srgb, ${tone} ${18 + (55 * i) / Math.max(1, wc.chain.length - 1)}%, transparent)`, color: "var(--cx-text-strong)" }}>
              {i + 1}
            </span>
            {i < wc.chain.length - 1 && <span className="w-px flex-1 bg-cx-line" style={{ minHeight: 8 }} />}
          </span>
          <span className={`pb-2 text-[13px] leading-snug ${i === wc.chain.length - 1 ? "font-medium text-cx-text-strong" : "text-cx-text-2"}`}>{step}</span>
        </li>
      ))}
    </ol>
  );
}

function Context({ wc }: { wc: WorstCase }) {
  return (
    <div className="flex flex-col gap-2 text-[13px] leading-relaxed">
      {wc.detail && <p className="m-0 text-cx-text">{wc.detail}</p>}
      <p className="m-0 text-cx-muted"><span className="text-cx-text-2">How likely: </span>{wc.likelihood}</p>
      <div className="text-cx-muted">
        <span className="text-cx-text-2">What rules it out: </span>
        {wc.prevents.join("; ")}.
      </div>
      <div className="text-[11.5px] text-cx-faint">Sources: {wc.refs.join(", ")}</div>
    </div>
  );
}

/** Option A: the single most severe chain the batch clearly moves toward, pinned at the top of the page. */
export function WorstBanner({ report }: { report: ImpactReport }) {
  const impact = report.impacts.find((i) => i.id === report.worst);
  const others = report.impacts.filter((i) => i.worst_case && i.id !== report.worst).length;
  if (!impact?.worst_case || impact.worst_case.trigger !== "likely") {
    const possible = report.impacts.filter((i) => i.worst_case).length;
    return possible ? (
      <p className="m-0 rounded-[16px] border border-cx-line bg-white/[0.03] px-4 py-3 text-[13.5px] text-cx-muted">
        No failure mode is clearly triggered by this batch. {possible} {possible === 1 ? "is" : "are"} not ruled out by
        these images: switch to "On cards" or "Ladder" to see them.
      </p>
    ) : null;
  }
  const wc = impact.worst_case;
  const sev = SEVERITY[wc.severity];
  return (
    <section className={`flex flex-col gap-4 rounded-[22px] border p-6 ${sev.border} ${sev.bg}`} aria-label="Worst case if ignored">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <div className={`lbl flex items-center gap-1.5 ${sev.text}`}>
            <SeverityIcon severity={wc.severity} size={14} /> If you ignore this · the worst that could happen
          </div>
          <h2 className="m-0 text-[22px] font-semibold tracking-[-0.015em] text-cx-text-strong">{wc.headline}</h2>
          <div className="text-[13px] text-cx-muted">
            From {impact.property.toLowerCase()}: {fmtChange(impact.change.low)} to {fmtChange(impact.change.high)} against the baseline.
          </div>
        </div>
        <Chips wc={wc} />
      </div>
      <Chain wc={wc} horizontal />
      <Context wc={wc} />
      <p className="m-0 text-[12px] leading-relaxed text-cx-faint">
        {report.worst_note}{others > 0 && ` ${others} more not ruled out: switch to "On cards" or "Ladder" to see them.`}
      </p>
    </section>
  );
}

/** Option B: one collapsible block per card. */
export function WorstOnCard({ impact }: { impact: Impact }) {
  const [open, setOpen] = useState(impact.worst_case?.trigger === "likely");
  const wc = impact.worst_case;
  if (!wc) return null;
  const sev = SEVERITY[wc.severity];
  return (
    <div className={`flex flex-col gap-3 rounded-[14px] border p-3.5 ${sev.border} ${sev.bg}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex cursor-pointer items-start justify-between gap-3 border-0 bg-transparent p-0 text-left" style={{ font: "inherit", color: "inherit" }}>
        <span className="flex flex-col gap-1">
          <span className={`lbl flex items-center gap-1.5 text-[10px] ${sev.text}`}><SeverityIcon severity={wc.severity} size={12} />If ignored, worst case</span>
          <span className={`text-[14.5px] font-medium ${wc.trigger === "likely" ? "text-cx-text-strong" : "text-cx-muted"}`}>{wc.headline}</span>
        </span>
        <span className="mono text-[12px] text-cx-faint">{open ? "−" : "+"}</span>
      </button>
      <Chips wc={wc} />
      {open && (
        <>
          <Chain wc={wc} />
          <Context wc={wc} />
        </>
      )}
    </div>
  );
}

/** Option C: every shown chain on a severity ladder, safety on top. */
export function WorstLadder({ report }: { report: ImpactReport }) {
  const [open, setOpen] = useState<string | null>(report.worst);
  const shown = report.impacts.filter((i) => i.worst_case);
  if (!shown.length) return null;
  return (
    <section className="panel flex flex-col gap-4 p-6" aria-label="Worst cases by severity">
      <div className="flex flex-col gap-1">
        <div className="lbl">If you ignore this · worst cases by severity</div>
        <p className="m-0 text-[12.5px] leading-relaxed text-cx-faint">{report.worst_note}</p>
      </div>
      {ORDER.map((severity) => {
        const rows = shown.filter((i) => i.worst_case!.severity === severity);
        const sev = SEVERITY[severity];
        if (!rows.length) return null;
        return (
          <div key={severity} className="grid gap-3 border-t border-cx-line-soft pt-3 md:grid-cols-[150px_1fr]">
            <div className={`flex items-center gap-1.5 text-[13px] font-medium ${sev.text}`}>
              <SeverityIcon severity={severity} size={14} />{sev.label}
            </div>
            <div className="flex flex-col gap-2">
              {rows.map((i) => {
                const wc = i.worst_case!;
                return (
                  <div key={i.id} className={`flex flex-col gap-2.5 rounded-[12px] border p-3 ${wc.trigger === "likely" ? sev.border : "border-dashed border-cx-line"}`}>
                    <button type="button" onClick={() => setOpen(open === i.id ? null : i.id)} aria-expanded={open === i.id}
                      className="flex cursor-pointer flex-wrap items-center justify-between gap-2 border-0 bg-transparent p-0 text-left" style={{ font: "inherit", color: "inherit" }}>
                      <span className="flex flex-col gap-0.5">
                        <span className={`text-[14px] font-medium ${wc.trigger === "likely" ? "text-cx-text-strong" : "text-cx-muted"}`}>{wc.headline}</span>
                        <span className="text-[12px] text-cx-faint">
                          {i.property}: {fmtChange(i.change.low)} to {fmtChange(i.change.high)} · {TRIGGER[wc.trigger]}
                        </span>
                      </span>
                      <span className="mono text-[12px] text-cx-faint">{open === i.id ? "−" : "+"}</span>
                    </button>
                    {open === i.id && (
                      <>
                        <Chain wc={wc} horizontal />
                        <Context wc={wc} />
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </section>
  );
}
