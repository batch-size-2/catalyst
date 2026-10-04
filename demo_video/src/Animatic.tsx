import { useEffect, useState, type ReactNode } from "react";
import { AbsoluteFill, Audio, continueRender, delayRender, Sequence, staticFile, useCurrentFrame, interpolate } from "remotion";
import { CameraMotionBlur } from "@remotion/motion-blur";
import script from "../script.json";
import { Background } from "./Background";
import { BrowserWindow } from "./BrowserWindow";
import { Captions } from "./Captions";
import { CatActor } from "./CatActor";
import { fontsReady } from "./fonts";
import type { Script, Timeline } from "./core";
import { HeroType } from "./HeroType";
import type { Props } from "./Root";
import { Lifts, Screen } from "./Screen";
import { AppOverlays, FrontOverlays } from "./scenes/AppOverlays";
import { News } from "./scenes/News";
import { Outro } from "./scenes/Outro";
import { Science } from "./scenes/Science";
import { shakeAt } from "./scenes/fx";
import { motionAt } from "./state";
import { C, FPS, H, W } from "./theme";

const { sfxMix: mix, music } = script as unknown as Script;

export function useFonts() {
  const [handle] = useState(() => delayRender("fonts"));
  useEffect(() => {
    fontsReady.then(() => continueRender(handle)).catch(() => continueRender(handle));
  }, [handle]);
}

// very faint film grain (≤ 3 %), a static noise tile nudged every frame
const NOISE = `url("data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 1.6 -0.3"/></filter><rect width="256" height="256" filter="url(#n)"/></svg>',
)}")`;
function Finish({ t }: { t: number }) {
  const f = Math.round(t * FPS);
  const h = (n: number) => ((Math.sin(n * 127.1) * 43758.5453) % 1 + 1) % 1;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 85% 80% at 50% 46%, transparent 55%, rgba(0,0,0,0.38) 100%)" }} />
      <AbsoluteFill style={{ backgroundImage: NOISE, backgroundSize: "256px 256px", backgroundPosition: `${Math.floor(h(f) * 256)}px ${Math.floor(h(f + 0.5) * 256)}px`, opacity: 0.03, mixBlendMode: "overlay" }} />
    </AbsoluteFill>
  );
}

// re-reads the (sub-)frame, so CameraMotionBlur's frozen samples see their own time
function AtFrame({ render }: { render: (t: number) => ReactNode }) {
  return <>{render(useCurrentFrame() / FPS)}</>;
}
const BLUR_PX = 26; // content moving faster than this (px/frame) gets motion blur (5 samples)

// Every visual layer, back to front, as a pure function of t (also used by the contact sheet).
export function Visuals({ tl, assets, t, blur = false }: { tl: Timeline; assets: Record<string, boolean>; t: number; blur?: boolean }) {
  const total = tl.total;
  const fadeOut = interpolate(t, [total - 0.7, total], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fadeIn = interpolate(t, [0, 0.25], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const [sx, sy] = shakeAt(tl, t);
  return (
    <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: sx || sy ? `translate(${sx}px, ${sy}px)` : undefined, width: W, height: H }}>
        <Background tl={tl} t={t} assets={assets} />
        <News tl={tl} t={t} />
        <Science tl={tl} t={t} />
        <Outro tl={tl} t={t} />
        {blur && motionAt(tl, t) > BLUR_PX ? (
          <CameraMotionBlur shutterAngle={160} samples={5}>
            <AtFrame render={(tt) => (
              <BrowserWindow tl={tl} t={tt}>
                <Screen tl={tl} t={tt} assets={assets} />
              </BrowserWindow>
            )} />
          </CameraMotionBlur>
        ) : (
          <BrowserWindow tl={tl} t={t}>
            <Screen tl={tl} t={t} assets={assets} />
          </BrowserWindow>
        )}
        <Lifts tl={tl} t={t} />
        <AppOverlays tl={tl} t={t} />
        <HeroType tl={tl} t={t} />
        <CatActor tl={tl} t={t} />
        <FrontOverlays tl={tl} t={t} />
      </AbsoluteFill>
      <Captions tl={tl} t={t} />
      <Finish t={t} />
      <AbsoluteFill style={{ background: "#000", opacity: Math.max(fadeOut, fadeIn) }} />
    </AbsoluteFill>
  );
}

export function Animatic({ tl, assets }: Props) {
  useFonts();
  const frame = useCurrentFrame();
  if (!tl) return <AbsoluteFill style={{ background: C.bg }} />;
  const t = frame / FPS;
  const total = tl.total;
  const sfx = tl.beats.filter((b) => b.sfx && assets[`sfx/${b.sfx}.mp3`]);
  return (
    <AbsoluteFill>
      <Visuals tl={tl} assets={assets} t={t} blur />

      {tl.scenes.map((s) =>
        s.audio ? (
          <Sequence key={s.id} from={Math.round(s.voiceStart * FPS)} layout="none">
            <Audio src={staticFile(s.audio)} />
          </Sequence>
        ) : null,
      )}
      {music && assets[music.file] ? (
        <Audio
          src={staticFile(music.file)}
          loop
          volume={(f) =>
            music.volume *
            interpolate(f / FPS, [0, music.fadeIn ?? 1, total - (music.fadeOut ?? 2), total], [0, 1, 1, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            })
          }
        />
      ) : null}
      {sfx.map((b, i) => (
        <Sequence key={i} from={Math.round(b.t * FPS)} layout="none">
          <Audio src={staticFile(`sfx/${b.sfx}.mp3`)} volume={mix[b.sfx!] ?? 0.1} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
