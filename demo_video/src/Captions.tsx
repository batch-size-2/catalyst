import { useMemo } from "react";
import { captionPages, type Timeline } from "./core";
import { prog } from "./state";
import { C, CAPTION_Y, FONT } from "./theme";

export function Captions({ tl, t }: { tl: Timeline; t: number }) {
  const pages = useMemo(() => captionPages(tl), [tl]);
  const page = pages.find((p) => t >= p.start - 0.15 && t < p.end);
  if (!page) return null;
  const inP = prog(t, page.start - 0.15, 0.22);
  const outP = prog(t, page.end - 0.1, 0.1);
  const cur = [...page.words].reverse().find((w) => t >= w.start - 0.03);
  return (
    <div
      style={{
        position: "absolute",
        left: 160,
        right: 160,
        top: CAPTION_Y,
        transform: `translateY(calc(-50% + ${(1 - inP) * 12}px))`,
        opacity: inP * (1 - outP),
        textAlign: "center",
        font: `500 40px/1.25 ${FONT}`,
        letterSpacing: "-0.01em",
        color: C.text,
        textShadow: "0 2px 18px rgba(0,0,0,0.85), 0 0 2px rgba(0,0,0,0.6)",
      }}
    >
      {page.words.map((w, i) => {
        const on = w === cur && t < w.end + 0.25;
        return (
          <span key={i} style={{ color: on ? C.orange : C.text, transition: "none" }}>
            {w.text}
            {i < page.words.length - 1 ? " " : ""}
          </span>
        );
      })}
    </div>
  );
}
