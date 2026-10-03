// review/contact_sheet.png: one real frame every `step` seconds, labelled with timestamp and scene.
import { AbsoluteFill } from "remotion";
import { useFonts, Visuals } from "./Animatic";
import type { Timeline } from "./core";
import { C, FONT, H, MONO, W } from "./theme";

export const SHEET = { cols: 5, cellW: 360, gap: 16, label: 34, pad: 36, head: 64 };
const CELL_H = (SHEET.cellW * H) / W;
export const sheetSize = (n: number) => ({
  width: SHEET.pad * 2 + SHEET.cols * SHEET.cellW + (SHEET.cols - 1) * SHEET.gap,
  height: Math.ceil(SHEET.pad * 2 + SHEET.head + Math.ceil(n / SHEET.cols) * (CELL_H + SHEET.label + SHEET.gap)),
});
export const sheetTimes = (tl: Timeline, step = 4) =>
  Array.from({ length: Math.floor(tl.total / step) + 1 }, (_, i) => Math.min(i * step, tl.total - 0.05));

export function ContactSheet({ tl, assets }: { tl: Timeline | null; assets: Record<string, boolean> }) {
  useFonts();
  if (!tl) return null;
  const times = sheetTimes(tl);
  const k = SHEET.cellW / W;
  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
  return (
    <AbsoluteFill style={{ background: C.bg, padding: SHEET.pad, fontFamily: FONT }}>
      <div style={{ height: SHEET.head, display: "flex", alignItems: "baseline", gap: 18, color: C.text }}>
        <span style={{ font: `600 30px ${FONT}`, letterSpacing: "-0.02em" }}>Catalyst animatic</span>
        <span style={{ font: `400 18px ${MONO}`, color: C.muted }}>
          {fmt(tl.total)} · one frame every 4 s · {tl.scenes.map((s) => `${s.id} ${fmt(s.start)}`).join(" · ")}
        </span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: SHEET.gap, width: SHEET.cols * SHEET.cellW + (SHEET.cols - 1) * SHEET.gap }}>
        {times.map((t) => {
          const scene = tl.scenes.find((s) => t >= s.start && t < s.end)?.id ?? "";
          return (
            <div key={t} style={{ width: SHEET.cellW }}>
              <div style={{ width: SHEET.cellW, height: CELL_H, overflow: "hidden", borderRadius: 6, position: "relative", outline: "1px solid rgba(255,255,255,0.1)" }}>
                <div style={{ width: W, height: H, transform: `scale(${k})`, transformOrigin: "0 0", position: "absolute" }}>
                  <Visuals tl={tl} assets={assets} t={t} />
                </div>
              </div>
              <div style={{ height: SHEET.label, display: "flex", alignItems: "center", justifyContent: "space-between", font: `500 15px ${MONO}`, color: C.text2 }}>
                <span>{fmt(t)}</span>
                <span style={{ color: C.faint, textTransform: "uppercase", letterSpacing: "0.08em", fontSize: 12 }}>{scene}</span>
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}
