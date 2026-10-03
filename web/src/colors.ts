import type { Status, Verdict } from "./types";

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
