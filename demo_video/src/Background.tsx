import type { CSSProperties } from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import type { Timeline } from "./core";
import { bgAt, fxT, plateXf } from "./state";
import { C, H, W } from "./theme";

const fill: CSSProperties = { position: "absolute", inset: 0, width: W, height: H };

function Mask({ file, color, opacity }: { file: string; color: string; opacity: number }) {
  if (opacity < 0.005) return null;
  const url = `url(${staticFile(file)})`;
  const m: CSSProperties = {
    ...fill,
    backgroundColor: color,
    maskImage: url,
    WebkitMaskImage: url,
    maskMode: "luminance",
    maskSize: "100% 100%",
    WebkitMaskSize: "100% 100%",
  } as CSSProperties;
  return (
    <>
      <div style={{ ...m, opacity: opacity * 0.9, mixBlendMode: "normal" }} />
      <div style={{ ...m, opacity: opacity * 0.7, filter: "blur(10px)", mixBlendMode: "screen" }} />
    </>
  );
}

export function Background({ tl, t, assets }: { tl: Timeline; t: number; assets: Record<string, boolean> }) {
  const p = bgAt(tl, t);
  const { k, dx, dy } = plateXf(tl, t);
  // "swells": the silicon pulses twice
  const ts = fxT(tl, "swell");
  const pulse = ts != null && t > ts && t < ts + 2.2 ? Math.sin(((t - ts) / 1.1) * Math.PI) ** 2 * 0.6 : 0;
  const grey = assets["bg/micro_grey.jpg"];
  const color = assets["bg/micro_color.jpg"];
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg, overflow: "hidden" }}>
      <svg width="0" height="0" style={{ position: "absolute" }}>
        <filter id="edges" colorInterpolationFilters="sRGB">
          <feColorMatrix type="saturate" values="0" />
          <feConvolveMatrix order="3" kernelMatrix="-1 -1 -1 -1 8 -1 -1 -1 -1" preserveAlpha="true" />
          <feGaussianBlur stdDeviation="1.6" />
          <feComponentTransfer>
            <feFuncR type="linear" slope="3.2" />
            <feFuncG type="linear" slope="3.2" />
            <feFuncB type="linear" slope="3.2" />
          </feComponentTransfer>
        </filter>
      </svg>
      <div
        style={{
          ...fill,
          transform: `translate(${dx}px, ${dy}px) scale(${k})`,
          filter: `brightness(${p.bright}) saturate(${p.sat}) blur(${p.blur}px)`,
        }}
      >
        {grey ? <Img src={staticFile("bg/micro_grey.jpg")} style={{ ...fill, objectFit: "cover" }} /> : null}
        {color && p.color > 0.005 ? (
          <Img src={staticFile("bg/micro_color.jpg")} style={{ ...fill, objectFit: "cover", opacity: p.color }} />
        ) : null}
        {grey && p.edge > 0.005 ? (
          <Img
            src={staticFile("bg/micro_grey.jpg")}
            style={{ ...fill, objectFit: "cover", filter: "url(#edges)", mixBlendMode: "screen", opacity: p.edge * 0.32 }}
          />
        ) : null}
        <Mask file="bg/mask_si.png" color={C.si} opacity={Math.min(1, p.si * (1 + pulse))} />
        <Mask file="bg/mask_pore.png" color={C.pore} opacity={p.pore} />
      </div>
      {/* colour arc: a cold tint for the news, a cooler lab tint for the experiments */}
      {p.cool > 0.005 ? <div style={{ ...fill, background: "#3B6E9E", mixBlendMode: "color", opacity: 0.32 * p.cool }} /> : null}
      {/* the app's faint 32 px grid */}
      <div
        style={{
          ...fill,
          backgroundImage: `linear-gradient(${C.grid} 1px, transparent 1px), linear-gradient(90deg, ${C.grid} 1px, transparent 1px)`,
          backgroundSize: "32px 32px",
          opacity: 1.4,
        }}
      />
      <div style={{ ...fill, background: "radial-gradient(ellipse 75% 70% at 50% 45%, transparent 45%, rgba(5,6,8,0.78) 100%)" }} />
      {/* scrim under the captions when the plate is bright */}
      <div
        style={{
          ...fill,
          opacity: p.scrim * Math.min(1, p.bright * 1.1),
          background: "linear-gradient(0deg, rgba(10,11,13,0.82) 0px, rgba(10,11,13,0.55) 150px, transparent 300px)",
        }}
      />
    </AbsoluteFill>
  );
}
