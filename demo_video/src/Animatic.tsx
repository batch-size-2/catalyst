import { useEffect, useState } from "react";
import { AbsoluteFill, Audio, continueRender, delayRender, Sequence, staticFile, useCurrentFrame, interpolate } from "remotion";
import script from "../script.json";
import { Background } from "./Background";
import { BrowserWindow } from "./BrowserWindow";
import { Captions } from "./Captions";
import { CatActor } from "./CatActor";
import { fontsReady } from "./fonts";
import type { Script, Timeline } from "./core";
import type { Props } from "./Root";
import { Screen } from "./Screen";
import { AppOverlays, FrontOverlays } from "./scenes/AppOverlays";
import { News } from "./scenes/News";
import { Outro } from "./scenes/Outro";
import { Science } from "./scenes/Science";
import { C, FPS } from "./theme";

const { sfxMix: mix, music } = script as unknown as Script;

export function useFonts() {
  const [handle] = useState(() => delayRender("fonts"));
  useEffect(() => {
    fontsReady.then(() => continueRender(handle)).catch(() => continueRender(handle));
  }, [handle]);
}

// Every visual layer, back to front, as a pure function of t (also used by the contact sheet).
export function Visuals({ tl, assets, t }: { tl: Timeline; assets: Record<string, boolean>; t: number }) {
  const total = tl.total;
  const fadeOut = interpolate(t, [total - 0.9, total], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
      <Background tl={tl} t={t} assets={assets} />
      <News tl={tl} t={t} />
      <Science tl={tl} t={t} />
      <Outro tl={tl} t={t} />
      <BrowserWindow tl={tl} t={t}>
        <Screen tl={tl} t={t} assets={assets} />
      </BrowserWindow>
      <AppOverlays tl={tl} t={t} />
      <CatActor tl={tl} t={t} />
      <FrontOverlays tl={tl} t={t} />
      <Captions tl={tl} t={t} />
      <AbsoluteFill style={{ background: "#000", opacity: fadeOut }} />
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
      <Visuals tl={tl} assets={assets} t={t} />

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
