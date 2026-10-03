import type { ReactNode } from "react";
import { imageUrl } from "../api";
import { batchColor, batchLabel, sigmaPos, VERDICT_CLASS } from "../lib";
import { href } from "../router";
import type { Verdict } from "../types";
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
}: {
  options: { value: T; label: ReactNode; disabled?: boolean }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={`seg glass ${className}`} role="tablist">
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
  return <section className={`panel p-6 ${className}`}>{children}</section>;
}

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

export function TileThumb({
  batch,
  imageId,
  odd = false,
  label,
}: {
  batch: string;
  imageId: string;
  odd?: boolean;
  label?: ReactNode;
}) {
  return (
    <a
      href={href.library(batch, imageId)}
      className="relative block aspect-square overflow-hidden rounded-xl"
      style={odd ? { boxShadow: "0 0 0 2px var(--cx-investigate)" } : { border: "1px solid var(--cx-line)" }}
    >
      <img
        src={imageUrl(batch, imageId, "BSE")}
        alt={`Tile ${imageId}`}
        loading="lazy"
        className="block h-full w-full object-cover"
      />
      <span
        className="mono absolute bottom-2 left-2 rounded-md px-1.5 py-0.5 text-[11px]"
        style={{ background: "rgba(10,11,13,.75)", color: odd ? "var(--cx-investigate-text)" : "var(--cx-text)" }}
      >
        {label ?? imageId}
        {odd ? " · odd" : ""}
      </span>
    </a>
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

export function ErrorPanel({ title, message, command }: { title: string; message: string; command?: string }) {
  return (
    <Panel className="flex flex-col gap-3 border-cx-reject/30">
      <div className="flex items-center gap-2 text-cx-reject-text">
        <IconWarn size={16} />
        <h2 className="m-0 text-[15px] font-medium">{title}</h2>
      </div>
      <p className="m-0 text-sm leading-relaxed text-cx-muted">{message}</p>
      {command && (
        <code className="mono w-fit rounded-lg border border-cx-line bg-black/40 px-3 py-2 text-[13px] text-cx-text-2">
          {command}
        </code>
      )}
    </Panel>
  );
}
