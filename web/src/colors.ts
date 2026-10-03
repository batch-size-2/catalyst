import type { Status, Verdict } from "./types";

const BATCH_COLORS: Record<string, string> = {
  Batch_3: "#2dd4bf",
  Batch_1: "#fbbf24",
  Batch_2: "#a78bfa",
};
const FALLBACK_BATCH_COLORS = ["#38bdf8", "#f472b6", "#a3e635"];

export function batchColor(batch: string, batches: string[]): string {
  if (BATCH_COLORS[batch]) return BATCH_COLORS[batch];
  const index = Math.max(0, batches.indexOf(batch));
  return FALLBACK_BATCH_COLORS[index % FALLBACK_BATCH_COLORS.length];
}

export const VERDICT_STYLE: Record<Verdict, { text: string; ring: string; glow: string; chip: string }> = {
  ACCEPT: { text: "text-emerald-300", ring: "ring-emerald-400/40", glow: "from-emerald-500/20", chip: "bg-emerald-400/15 text-emerald-300" },
  INVESTIGATE: { text: "text-amber-300", ring: "ring-amber-400/40", glow: "from-amber-500/20", chip: "bg-amber-400/15 text-amber-300" },
  REJECT: { text: "text-rose-300", ring: "ring-rose-400/40", glow: "from-rose-500/20", chip: "bg-rose-400/15 text-rose-300" },
};

export const STATUS_STYLE: Record<Status, { chip: string; fill: string }> = {
  DIFFERENT: { chip: "bg-rose-400/15 text-rose-300", fill: "#fb7185" },
  UNCLEAR: { chip: "bg-amber-400/15 text-amber-300", fill: "#fbbf24" },
  SIMILAR: { chip: "bg-emerald-400/15 text-emerald-300", fill: "#34d399" },
};
