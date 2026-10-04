import { useState, type ReactNode } from "react";
import { imageUrl } from "../api";
import {
  batchColor, batchLabel, baselineBand, dictEntry, fmt, fmtSigma, quantityLabel, sigmaPos, VERDICT_CLASS,
} from "../lib";
import { href } from "../router";
import type { GuideSlot, KpiDictionary, Tile, Verdict } from "../types";
import markUrl from "../../../design/logo/catalyst-mark.svg";
import moodPeeking from "../../../design/logo/moods/peeking.svg";
import moodReady from "../../../design/logo/moods/ready.svg";
import moodSniffing from "../../../design/logo/moods/sniffing.svg";
import moodSure from "../../../design/logo/moods/sure.svg";
import moodUnsure from "../../../design/logo/moods/unsure.svg";

export const CAT = {
  mark: markUrl,
  peeking: moodPeeking,
  ready: moodReady,
  sniffing: moodSniffing,
  sure: moodSure,
  unsure: moodUnsure,
} as const;

export type Mood = keyof typeof CAT;

export function Cat({ mood, size = 36, className = "" }: { mood: Mood; size?: number; className?: string }) {
  return <img src={CAT[mood]} alt={`Catalyst, ${mood}`} width={size} height={size} className={className} />;
}

export function BatchDot({ name, size = 9, round = 3 }: { name: string; size?: number; round?: number }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, borderRadius: round, background: batchColor(name), flex: "none" }}
    />
  );
}

export function BatchChip({ name, suffix }: { name: string; suffix?: ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border px-3 text-[13px]"
      style={{ borderColor: `color-mix(in srgb, ${batchColor(name)} 35%, transparent)`, minHeight: 28 }}
    >
      <BatchDot name={name} size={8} />
      {batchLabel(name)}
      {suffix}
    </span>
  );
}

export function VerdictPill({ verdict, children }: { verdict: Verdict; children?: ReactNode }) {
  return (
    <span className={`verdict ${VERDICT_CLASS[verdict]}`}>
      {verdict === "ACCEPT" && <IconCheck />}
      {verdict === "INVESTIGATE" && <IconWarn />}
      {verdict === "REJECT" && <IconCross />}
      {children ?? verdict}
    </span>
  );
}

export function Seg<T extends string>({
  options,
  value,
  onChange,
  className = "",
  style,
}: {
  options: { value: T; label: ReactNode; disabled?: boolean }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className={`seg glass ${className}`} role="tablist" style={style}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Panel({ className = "", children }: { className?: string; children: ReactNode }) {
  const pad = /(^|\s)!?p-/.test(className) ? "" : "p-6";  // a padding in className replaces the default
  return <section className={`panel ${pad} ${className}`}>{children}</section>;
}

/** Every page's top: one 40 px title, at most one short sentence, and the page's own controls on the right. */
export function PageHeader({ title, intro, children }: { title: ReactNode; intro?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="flex min-w-0 flex-col gap-2.5">
        <h1 className="m-0 text-[40px] leading-[1.1] font-semibold tracking-[-0.03em]">{title}</h1>
        {intro && <p className="m-0 max-w-[640px] text-base leading-[1.55] text-cx-muted">{intro}</p>}
      </div>
      {children}
    </div>
  );
}

/** A one-line, neutral notice: a corrected link, a run that finished elsewhere. */
export function Note({ children }: { children: ReactNode }) {
  return (
    <div role="note" className="flex items-center gap-3 rounded-[14px] border border-cx-line bg-cx-surface px-4 py-3 text-sm text-cx-text-2">
      {children}
    </div>
  );
}

/** The page column every page uses: 1180 px, the same side and top padding. */
export const PAGE = "mx-auto flex w-full max-w-[1180px] flex-col px-10 pt-10 pb-16";

/** The ±1σ/±2σ baseline band with a marker dot at z (0 = baseline mean). */
export function SigmaBand({ z, height = 4 }: { z: number | null; height?: number }) {
  return (
    <div className="relative rounded-full bg-white/[0.06]" style={{ height }}>
      <div
        className="absolute inset-y-0 rounded-full bg-cx-batch-3/15"
        style={{ left: `${sigmaPos(-2)}%`, width: `${sigmaPos(2) - sigmaPos(-2)}%` }}
      />
      <div
        className="absolute inset-y-0 rounded-full bg-cx-batch-3/40"
        style={{ left: `${sigmaPos(-1)}%`, width: `${sigmaPos(1) - sigmaPos(-1)}%` }}
      />
      {z != null && (
        <div
          className="absolute rounded-full"
          style={{
            top: -3,
            width: height + 6,
            height: height + 6,
            left: `calc(${sigmaPos(z)}% - ${(height + 6) / 2}px)`,
            background: Math.abs(z) > 2 ? "var(--cx-investigate)" : "var(--cx-text-strong)",
            boxShadow: "0 0 0 3px #111215",
          }}
        />
      )}
    </div>
  );
}

export function Spinner({ size = 22, color = "var(--cx-orange)" }: { size?: number; color?: string }) {
  return (
    <span
      className="spin inline-block rounded-full border-2"
      style={{ width: size, height: size, borderColor: color, borderRightColor: "transparent" }}
    />
  );
}

export function IconCheck({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12l5 5 9-10" />
    </svg>
  );
}

export function IconWarn({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 4l9 16H3l9-16z" />
      <path d="M12 10v4M12 17h.01" />
    </svg>
  );
}

export function IconCross({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

/** The segmentation overlay's colours as they look on screen: qc/run.py OVERLAY_RGB half-blended over mid-grey BSE. */
export const PHASE_LEGEND: [string, string][] = [
  ["Silicon", "rgb(191,134,64)"],
  ["Pore", "rgb(84,124,191)"],
  ["Binder", "rgb(159,109,191)"],
  ["Graphite", "#6B6D73"],
];

/** The phase layers /api/layers draws over a detector image, in qc/io.py LAYER_RGB. */
export type Layer = "silicon" | "pore" | "binder";
export const LAYERS: { id: Layer; label: string; color: string }[] = [
  { id: "silicon", label: "Silicon", color: "rgb(255,140,0)" },
  { id: "pore", label: "Pore", color: "rgb(40,120,255)" },
  { id: "binder", label: "Binder", color: "rgb(190,90,255)" },
];

/** "Everything else": a list of folded rows, each with a one-line summary. */
export function Folds({
  rows,
  open,
  onToggle,
}: {
  rows: { id: string; title: string; summary: ReactNode; body: () => ReactNode }[];
  open: Record<string, boolean>;
  onToggle: (id: string) => void;
}) {
  return (
    <section aria-label="Everything else" className="overflow-hidden rounded-[22px] border border-cx-line bg-cx-surface">
      <div className="lbl px-5 pt-4 pb-2.5">Everything else</div>
      {rows.map((row) => (
        <div key={row.id} className="border-t border-cx-line-soft">
          <button
            type="button"
            aria-expanded={!!open[row.id]}
            onClick={() => onToggle(row.id)}
            className="flex min-h-14 w-full cursor-pointer items-center gap-4 border-0 bg-transparent px-5 text-left text-[15px] text-cx-text hover:bg-white/[0.02]"
          >
            <span className="flex-1">{row.title}</span>
            <span className="mono text-right text-xs text-cx-faint">{row.summary}</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--cx-muted)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ transform: open[row.id] ? "rotate(180deg)" : "none", flex: "none" }}>
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          {open[row.id] && <div className="px-5 pt-1 pb-5">{row.body()}</div>}
        </div>
      ))}
    </section>
  );
}

/** A shift in baseline σ on a ±span axis: baseline ±3σ shading, the dashed tolerance zone, interval and point. */
export function ShiftBand({
  s,
  lo,
  hi,
  margin,
  color,
  height = 26,
  span = 4,
}: {
  s: number | null;
  lo: number | null;
  hi: number | null;
  margin: number;
  color: string;
  height?: number;
  span?: number;
}) {
  const pos = (v: number) => ((Math.max(-span, Math.min(span, v)) + span) / (2 * span)) * 100;
  return (
    <div className="relative" style={{ height }}>
      <div className="absolute inset-y-0 bg-cx-batch-3/[0.07]" style={{ left: `${pos(-3)}%`, width: `${pos(3) - pos(-3)}%` }} />
      <div
        className="absolute inset-y-0 border-x border-dashed border-cx-batch-3/50 bg-cx-batch-3/[0.16]"
        style={{ left: `${pos(-margin)}%`, width: `${pos(margin) - pos(-margin)}%` }}
      />
      <div className="absolute inset-y-0 w-px bg-cx-batch-3/70" style={{ left: "50%" }} />
      {lo != null && hi != null && (
        <div
          className="absolute top-1/2 h-1 -translate-y-1/2 rounded-[2px]"
          style={{ left: `${pos(lo)}%`, width: `${Math.max(0.5, pos(hi) - pos(lo))}%`, background: color }}
        />
      )}
      {s != null && (
        <div
          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cx-text-strong"
          style={{ left: `${pos(s)}%`, boxShadow: "0 0 0 3px #15161A" }}
        />
      )}
    </div>
  );
}

/** Every measured KPI of one tile against the baseline batch's tiles (mean ± SD). */
export function TileKpiGrid({
  tile,
  tiles,
  baseline,
  dict,
  columns = 4,
}: {
  tile: Tile | undefined;
  tiles: Tile[];
  baseline: string | null;
  dict: KpiDictionary | null;
  columns?: number;
}) {
  if (!tile?.kpis) return <span className="text-[13px] text-cx-muted">Not measured yet.</span>;
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {Object.entries(tile.kpis)
        .filter(([, v]) => v != null)
        .map(([kpi, v]) => {
          const band = baseline ? baselineBand(tiles, baseline, kpi) : null;
          const z = band && band.sd > 0 ? (v! - band.mean) / band.sd : null;
          return (
            <div key={kpi} className="flex flex-col gap-2 rounded-[14px] border border-cx-line-soft bg-black/20 p-3">
              <span className="line-clamp-2 min-h-[2lh] text-xs leading-snug text-cx-muted" title={dictEntry(kpi, dict).why_it_matters ?? quantityLabel(kpi, dict)}>
                {quantityLabel(kpi, dict)}
              </span>
              <span className="mono text-[14px] whitespace-nowrap">
                {fmt(v, dictEntry(kpi, dict).unit)}
                {z != null && <span className="ml-1.5 text-[11px] text-cx-faint">{fmtSigma(z)}</span>}
              </span>
              {z != null && <SigmaBand z={z} height={3} />}
            </div>
          );
        })}
    </div>
  );
}

/** Count of a tile's KPIs beyond ±1σ of the baseline, for a fold summary. */
export function kpisBeyond(tile: Tile | undefined, tiles: Tile[], baseline: string | null, k = 1) {
  if (!tile?.kpis || !baseline) return null;
  const entries = Object.entries(tile.kpis).filter(([, v]) => v != null);
  const beyond = entries.filter(([kpi, v]) => {
    const band = baselineBand(tiles, baseline, kpi);
    return band && band.sd > 0 && Math.abs((v! - band.mean) / band.sd) > k;
  }).length;
  return { total: entries.length, beyond };
}

const SLOT = /\{(diff|shift|interval|tile|range|whatif|count):([^{}\s]+)\}/g;

/** Guide text with its {slots} rendered as chips; Catalyst filled every one from the evidence. */
export function SlotText({ text, slots }: { text: string; slots: Record<string, GuideSlot> }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(SLOT)) {
    parts.push(text.slice(last, m.index));
    const slot = slots[`${m[1]}:${m[2]}`];
    parts.push(slot ? <SlotChip key={m.index} slot={slot} /> : "—");
    last = (m.index ?? 0) + m[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

function SlotChip({ slot }: { slot: GuideSlot }) {
  if (slot.tile && slot.batch)
    return (
      <a href={href.library(slot.batch, slot.tile)} title={slot.source} className="chip-tile">
        <img src={imageUrl(slot.batch, slot.tile, "BSE")} alt="" />
        {slot.text}
      </a>
    );
  return (
    <span title={slot.source} className="chip-num">
      {slot.text}
    </span>
  );
}

/** A small "details" toggle for secondary, technical text. */
export function Details({ label = "details", children }: { label?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-cx-orange-text underline decoration-dotted underline-offset-2"
      >
        {open ? "hide" : label}
      </button>
      {open && <div className="basis-full">{children}</div>}
    </>
  );
}

export function ErrorPanel({ title, message, details, command }: { title: string; message: ReactNode; details?: ReactNode; command?: string }) {
  return (
    <Panel className="flex flex-col gap-3 border-cx-reject/30">
      <div className="flex items-center gap-2 text-cx-reject-text">
        <IconWarn size={16} />
        <h2 className="m-0 text-[15px] font-medium">{title}</h2>
      </div>
      <p className="m-0 flex flex-wrap items-baseline gap-x-2 text-sm leading-relaxed text-cx-muted">
        {message}
        {details && (
          <Details>
            <span className="mono block pt-1 text-xs break-words text-cx-faint">{details}</span>
          </Details>
        )}
      </p>
      {command && (
        <code className="mono w-fit rounded-lg border border-cx-line bg-black/40 px-3 py-2 text-[13px] text-cx-text-2">
          {command}
        </code>
      )}
    </Panel>
  );
}
