import { Composition, staticFile, type CalculateMetadataFunction } from "remotion";
import narration from "../narration.json";
import script from "../script.json";
import { Animatic } from "./Animatic";
import { ContactSheet, sheetSize, sheetTimes } from "./ContactSheet";
import { buildTimeline, type AudioJson, type Narration, type Script, type Timeline } from "./core";
import { STANDINS } from "./state";
import { FPS, H, W } from "./theme";

export type Props = { tl: Timeline | null; assets: Record<string, boolean> };

async function exists(path: string) {
  try {
    const r = await fetch(staticFile(path), { method: "HEAD" });
    return r.ok;
  } catch {
    return false;
  }
}

const calculateMetadata: CalculateMetadataFunction<Props> = async () => {
  const n = narration as Narration;
  const s = script as unknown as Script;
  const audio: Record<string, AudioJson | null> = {};
  const mp3: Record<string, boolean> = {};
  for (const { id } of n.scenes) {
    try {
      const r = await fetch(staticFile(`audio/${id}.json`));
      audio[id] = r.ok ? ((await r.json()) as AudioJson) : null;
    } catch {
      audio[id] = null;
    }
    mp3[id] = await exists(`audio/${id}.mp3`);
  }
  const files = [
    ...(s.music?.file ? [s.music.file] : []),
    ...Object.keys(s.sfxMix).map((id) => `sfx/${id}.mp3`),
    ...Object.values(STANDINS.images).map((i) => i.file),
    "bg/micro_grey.jpg", "bg/micro_color.jpg", "bg/mask_si.png", "bg/mask_pore.png",
  ];
  const assets: Record<string, boolean> = {};
  for (const f of files) assets[f] = await exists(f);
  const tl = buildTimeline(n, s, audio, mp3);
  for (const f of files) if (!assets[f]) tl.warnings.push(`missing ${f}, using a placeholder`);
  for (const w of tl.warnings) console.warn(`[catalyst] ${w}`);
  return { durationInFrames: Math.ceil(tl.total * FPS), props: { tl, assets } };
};

const sheetMetadata: CalculateMetadataFunction<Props> = async (opts) => {
  const m = await calculateMetadata(opts);
  const { tl } = m.props as Props;
  return { ...m, durationInFrames: 1, ...sheetSize(sheetTimes(tl!).length) };
};

export const Root = () => (
  <>
    <Composition
      id="Animatic"
      component={Animatic}
      width={W}
      height={H}
      fps={FPS}
      durationInFrames={FPS * 90}
      defaultProps={{ tl: null, assets: {} } as Props}
      calculateMetadata={calculateMetadata}
    />
    <Composition
      id="ContactSheet"
      component={ContactSheet}
      width={1920}
      height={1080}
      fps={FPS}
      durationInFrames={1}
      defaultProps={{ tl: null, assets: {} } as Props}
      calculateMetadata={sheetMetadata}
    />
  </>
);
