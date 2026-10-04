import { useState } from "react";
import type { Impact, Severity, WorstCase } from "../impact";

const SEVERITY: Record<Severity, { label: string; tone: string; border: string; bg: string; text: string }> = {
  safety: { label: "Safety", tone: "var(--cx-reject)", border: "border-cx-reject/40", bg: "bg-cx-reject/[0.08]", text: "text-cx-reject-text" },
  reliability: { label: "Reliability", tone: "var(--cx-investigate)", border: "border-cx-investigate/35", bg: "bg-cx-investigate/[0.07]", text: "text-cx-investigate-text" },
  performance: { label: "Performance", tone: "var(--cx-text-2)", border: "border-cx-line", bg: "bg-white/[0.03]", text: "text-cx-text-2" },
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

export function Sources({ refs, className = "" }: { refs: string[]; className?: string }) {
  return (
    <div className={`text-cx-faint ${className}`}>
      Sources: {refs.map((r, i) => (
        <span key={r}>{i > 0 && ", "}<a href={`#ref-${r}`} onClick={(e) => {
          e.preventDefault();
          document.getElementById(`ref-${r}`)?.closest("details")?.setAttribute("open", "");
          document.getElementById(`ref-${r}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        }}>{r}</a></span>
      ))}
    </div>
  );
}

function Chain({ wc, tone }: { wc: WorstCase; tone: string }) {
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
      <Sources refs={wc.refs} className="text-[11.5px]" />
    </div>
  );
}

/** The worst case if ignored: in full when the batch moves that way, one muted line when the images only can't rule it out. */
export function WorstOnCard({ impact }: { impact: Impact }) {
  const [open, setOpen] = useState(false);
  const wc = impact.worst_case;
  if (!wc) return null;
  if (wc.trigger === "possible")
    return (
      <div className="flex flex-col gap-3">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
          className="flex w-fit cursor-pointer items-baseline gap-2 border-0 bg-transparent p-0 text-left text-[13px] leading-snug text-cx-muted hover:text-cx-text">
          <span className="mono w-2.5 shrink-0 text-cx-faint" aria-hidden>{open ? "−" : "+"}</span>
          <span>Not ruled out by these images: {wc.headline}</span>
        </button>
        {open && (
          <div className="flex flex-col gap-3 pl-[18px]">
            <Chain wc={wc} tone="var(--cx-text-2)" />
            <Context wc={wc} />
          </div>
        )}
      </div>
    );
  const sev = SEVERITY[wc.severity];
  return (
    <div className={`flex flex-col gap-3 rounded-[14px] border p-3.5 ${sev.border} ${sev.bg}`}>
      <div className="flex flex-col gap-1">
        <span className={`lbl flex items-center gap-1.5 text-[10px] ${sev.text}`}>
          <SeverityIcon severity={wc.severity} size={12} />{sev.label} · worst case if ignored
        </span>
        <span className="text-[14.5px] font-medium text-cx-text-strong">{wc.headline}</span>
      </div>
      <Chain wc={wc} tone={sev.tone} />
      <Context wc={wc} />
    </div>
  );
}
