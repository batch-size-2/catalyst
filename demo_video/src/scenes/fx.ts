// Small shared effects: camera shake on hits.
import type { Timeline } from "../core";

const hash = (n: number) => ((Math.sin(n * 91.345 + 12.9898) * 43758.5453) % 1 + 1) % 1;

// beats with fx "shake" (dur in seconds, default 2 frames; amp in px via zoom field reuse is avoided)
export function shakeAt(tl: Timeline, t: number): [number, number] {
  for (const b of tl.beats) {
    if (b.fx !== "shake" || t < b.t) continue;
    const dur = b.dur ?? 2 / 30;
    if (t >= b.t + dur) continue;
    const f = Math.round(t * 30);
    const k = 1 - (t - b.t) / dur;
    const amp = 14 * k;
    return [(hash(f) * 2 - 1) * amp, (hash(f + 7) * 2 - 1) * amp];
  }
  return [0, 0];
}
