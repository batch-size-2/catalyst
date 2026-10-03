// Phase 1 screen: the nearest stand-in screenshot, with a camera (scroll, zoom, slow push-in)
// and cross-fades on shot changes. Phase 2 swaps the source for capture's manifest.
import { Img, staticFile } from "remotion";
import type { Timeline } from "./core";
import { glass } from "./theme";
import { prog, screenAt, STANDINS, type Cam } from "./state";
import { C, CONTENT, MONO } from "./theme";

function Placeholder({ name }: { name: string }) {
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ ...glass, borderRadius: 22, padding: "28px 40px", font: `500 18px ${MONO}`, color: C.muted }}>
        missing screen · {name}
      </div>
    </div>
  );
}

function Page({ img, cam, opacity, dy, grey, assets }: { img: string; cam: Cam; opacity: number; dy: number; grey: number; assets: Record<string, boolean> }) {
  const meta = STANDINS.images[img];
  if (!meta || !assets[meta.file]) return <div style={{ position: "absolute", inset: 0, opacity }}><Placeholder name={img.replace("missing:", "")} /></div>;
  const style = {
    position: "absolute" as const,
    left: 0,
    top: 0,
    width: STANDINS.width,
    height: meta.h,
  };
  const greyBoxes = grey > 0 ? (meta.states?.off?.grey ?? []).map((id) => meta.highlights[id]).filter(Boolean) : [];
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        opacity,
        transformOrigin: "0 0",
        transform: `translateY(${dy}px) scale(${cam.s}) translate(${-cam.x}px, ${-cam.y}px)`,
      }}
    >
      <Img src={staticFile(meta.file)} style={style} />
      {greyBoxes.map((b, i) => (
        <div key={i} style={{ position: "absolute", left: b.x, top: b.y, width: b.w, height: b.h, overflow: "hidden", opacity: grey, borderRadius: 14 }}>
          <Img src={staticFile(meta.file)} style={{ ...style, left: -b.x, top: -b.y, filter: "grayscale(1) brightness(0.95)" }} />
        </div>
      ))}
    </div>
  );
}

export function Screen({ tl, t, assets }: { tl: Timeline; t: number; assets: Record<string, boolean> }) {
  const s = screenAt(tl, t);
  if (!s.img) return null;
  // the viewer's "off" state: micrograph and switch in grey until the switch flips
  const greyOf = (state: string | null) => (state === "off" ? 1 : 0);
  const grey = s.stateT > -Infinity ? greyOf(s.prevState) * (1 - prog(t, s.stateT, 0.7)) + greyOf(s.state) : greyOf(s.state);
  const file = STANDINS.images[s.img]?.file ?? s.img;
  return (
    <div style={{ position: "absolute", inset: 0, width: CONTENT.w, height: CONTENT.h, overflow: "hidden", background: C.bg }}>
      {s.prev && s.fade < 1 ? (
        <Page img={s.prev.img} cam={s.prev.cam} opacity={1 - s.fade} dy={-40 * s.fade} grey={0} assets={assets} />
      ) : null}
      <Page img={s.img} cam={s.cam} opacity={s.prev ? s.fade : 1} dy={s.prev ? 50 * (1 - s.fade) : 0} grey={grey} assets={assets} />
      <div
        style={{
          position: "absolute",
          right: 14,
          bottom: 12,
          padding: "5px 10px",
          borderRadius: 8,
          background: "rgba(10,11,13,0.72)",
          border: "1px solid rgba(255,255,255,0.12)",
          font: `500 11px ${MONO}`,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: C.faint,
        }}
      >
        stand-in · {file.split("/").pop()}
      </div>
    </div>
  );
}
