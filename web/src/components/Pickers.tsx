import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { batchColor, batchLabel } from "../lib";
import { BatchDot } from "./bits";

export interface BatchOption {
  name: string;
  note?: ReactNode;     // right-hand note, e.g. "7 tiles"
  badge?: string;       // e.g. "default"
  disabled?: boolean;
}

/** The batch / baseline picker used on every page that compares two batches: a button with a floating glass list.
 *  `accent` tints the button with the chosen batch's colour (the baseline side). Closes on outside click and Escape. */
export function BatchSelect({
  label,
  value,
  sub,
  options,
  onPick,
  footer,
  accent = false,
}: {
  label: string;
  value: string | null | undefined;
  sub?: ReactNode;
  options: BatchOption[];
  onPick: (name: string) => void;
  footer?: ReactNode;
  accent?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const color = value ? batchColor(value) : "var(--cx-faint)";
  const tint: CSSProperties = accent
    ? { borderColor: `color-mix(in srgb, ${color} 40%, transparent)`, background: `color-mix(in srgb, ${color} 9%, transparent)` }
    : {};
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex min-h-[52px] cursor-pointer items-center gap-3 rounded-[14px] border border-cx-line bg-white/[0.06] px-3.5 text-cx-text"
        style={{ font: "inherit", ...tint }}
      >
        <span className="flex flex-col items-start gap-0.5">
          <span className="lbl text-[10px]" style={accent ? { color } : undefined}>{label}</span>
          <span className="flex items-center gap-2 text-[15px] font-medium whitespace-nowrap">
            {value && <BatchDot name={value} size={10} />}
            {value ? batchLabel(value) : "Choose…"}
            {sub && <span className="text-[13px] font-normal text-cx-faint">{sub}</span>}
          </span>
        </span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={label}
          className="glass absolute top-[60px] left-0 z-20 flex w-[300px] flex-col gap-0.5 rounded-[18px] p-2"
          style={{ background: "rgba(24,25,29,.94)" }}
        >
          {options.map((o) => (
            <button
              key={o.name}
              type="button"
              role="option"
              aria-selected={o.name === value}
              disabled={o.disabled}
              onClick={() => {
                setOpen(false);
                onPick(o.name);
              }}
              className={`flex min-h-11 items-center gap-2.5 rounded-[10px] border-0 px-2.5 text-left text-sm text-cx-text ${
                o.disabled ? "cursor-not-allowed opacity-45" : "cursor-pointer hover:bg-white/5"
              } ${o.name === value ? "bg-white/[0.08]" : "bg-transparent"}`}
            >
              <BatchDot name={o.name} size={10} />
              <span className="flex-1">{batchLabel(o.name)}</span>
              {o.badge && <span className="text-xs text-cx-muted">{o.badge}</span>}
              {o.note && <span className="text-xs text-cx-faint">{o.note}</span>}
            </button>
          ))}
          {footer && (
            <div className="mt-1 border-t border-cx-line pt-1" onClick={() => setOpen(false)}>
              {footer}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
