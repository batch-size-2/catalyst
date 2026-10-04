import type { ReactNode } from "react";
import { Img, staticFile } from "remotion";
import type { Timeline } from "./core";
import { clamp01, prog, sceneOf, screenAt, sp, windowAt } from "./state";
import { C, FONT, MONO, SPRING_POP, WIN } from "./theme";

export function BrowserWindow({ tl, t, children }: { tl: Timeline; t: number; children: ReactNode }) {
  const w = windowAt(tl, t);
  if (!w.visible) return null;
  const url = screenAt(tl, t).url;
  // the EXPERIMENTAL chip pops into the title bar for the last three scenes
  const ex = sceneOf(tl, "impact");
  const exOut = sceneOf(tl, "outro")?.start ?? Infinity;
  const chip = ex ? sp(t, ex.start + 0.35, SPRING_POP) * (1 - prog(t, exOut, 0.4)) : 0;
  // a light sweep across the glass when the window first arrives
  const sweep = prog(t, w.tin + 0.35, 1.1);
  return (
    <div style={{ position: "absolute", inset: 0, perspective: 2200, perspectiveOrigin: "50% 45%" }}>
      <div
        style={{
          position: "absolute",
          left: WIN.x,
          top: WIN.y,
          width: WIN.w,
          height: WIN.h,
          opacity: w.opacity,
          transform: `translate(${w.dx}px, ${w.dy}px) rotateX(${w.rotX}deg) rotateY(${w.rotY}deg) scale(${w.scale})`,
          filter: w.blur > 0.05 ? `blur(${w.blur}px)` : undefined,
        }}
      >
        {/* faint orange-teal edge glow */}
        <div
          style={{
            position: "absolute",
            inset: -3,
            borderRadius: WIN.r + 3,
            background: `linear-gradient(135deg, ${C.orange}, transparent 35%, transparent 65%, ${C.batch3})`,
            opacity: 0.22,
            filter: "blur(14px)",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: WIN.r,
            overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.08)",
            boxShadow: "0 50px 120px -20px rgba(0,0,0,0.85), 0 0 0 1px rgba(0,0,0,0.4)",
            background: "rgba(10,11,13,0.75)",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: WIN.w,
              height: WIN.title,
              background: "linear-gradient(180deg, rgba(30,31,36,0.96), rgba(22,23,27,0.96))",
              borderBottom: "1px solid rgba(255,255,255,0.07)",
              display: "flex",
              alignItems: "center",
              zIndex: 2,
            }}
          >
            <div style={{ display: "flex", gap: 8, marginLeft: 16 }}>
              {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
                <div key={c} style={{ width: 12, height: 12, borderRadius: 6, background: c, boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.25)" }} />
              ))}
            </div>
            <div
              style={{
                marginLeft: 22,
                height: 28,
                padding: "0 14px 0 10px",
                display: "flex",
                alignItems: "center",
                gap: 8,
                borderRadius: 8,
                background: "rgba(255,255,255,0.07)",
                font: `500 13px ${FONT}`,
                color: C.text,
              }}
            >
              <Img src={staticFile("logo/favicon.svg")} style={{ width: 16, height: 16 }} />
              Catalyst
            </div>
            <div
              style={{
                position: "absolute",
                left: "50%",
                transform: "translateX(-50%)",
                height: 26,
                minWidth: 420,
                padding: "0 18px",
                borderRadius: 8,
                background: "rgba(0,0,0,0.28)",
                border: "1px solid rgba(255,255,255,0.06)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                font: `400 13px ${MONO}`,
                color: C.muted,
                letterSpacing: "0.01em",
              }}
            >
              <span style={{ color: C.faint }}>catalyst.local/</span>
              <span style={{ color: C.text2 }}>{url}</span>
            </div>
            {chip > 0.01 ? (
              <div
                style={{
                  position: "absolute",
                  right: 16,
                  height: 24,
                  padding: "0 12px",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  borderRadius: 999,
                  border: `1px solid rgba(255,122,47,0.55)`,
                  background: "rgba(255,122,47,0.12)",
                  font: `600 12px ${MONO}`,
                  letterSpacing: "0.12em",
                  color: C.orangeText,
                  opacity: clamp01(chip * 1.5),
                  transform: `scale(${0.7 + 0.3 * chip})`,
                  transformOrigin: "100% 50%",
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: 4, background: C.orange, boxShadow: `0 0 8px ${C.orange}` }} />
                EXPERIMENTAL
              </div>
            ) : null}
          </div>
          <div style={{ position: "absolute", left: 0, top: WIN.title, width: WIN.w, height: WIN.h - WIN.title, overflow: "hidden" }}>
            {children}
          </div>
          {sweep > 0 && sweep < 1 ? (
            <div
              style={{
                position: "absolute",
                inset: 0,
                pointerEvents: "none",
                background: `linear-gradient(105deg, transparent ${sweep * 160 - 45}%, rgba(255,255,255,0.10) ${sweep * 160 - 30}%, rgba(255,255,255,0.02) ${sweep * 160 - 22}%, transparent ${sweep * 160 - 14}%)`,
                mixBlendMode: "screen",
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
