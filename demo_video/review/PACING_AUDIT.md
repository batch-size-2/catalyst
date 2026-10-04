# Pacing audit of `renders/catalyst_phase2.mp4` (1:58.5)

The user's note: around 0:40–1:00, sections go by too quickly, and it looks janky. **It's fine to show less** to get a calmer pace.

How this was measured:
- every camera, spotlight, lift and shot change computed from `script.json` and the word timings;
- on-screen motion per second (ffmpeg scene score);
- 2 fps frame grids of the flagged stretches.

| Scene | Time | View changes | Gaps under 1.2 s | Motion/s |
|---|---|---|---|---|
| news | 0:00–0:14.6 | 3 | 0 | 9.0 |
| science | 0:14.6–0:37.8 | 1 | 0 | 13.9 (its peak at the short-circuit flash is intended) |
| **compare** | **0:37.8–0:53.4** | **17** | **12, some only 0.2 s apart** | **17.0** |
| identify | 0:53.4–1:03.5 | 7 | 2 | 10.2 |
| **inspect** | **1:03.5–1:11.9** | 5 | 1 | **19.3** (the highest) |
| audit | 1:11.9–1:26.3 | 9 | 2 | 16.6 |
| **impact** | **1:26.3–1:39.3** | 11 | **6 in a row, 0.2–0.4 s apart (1:36.1–1:37.8)** | 6.7 |
| lab | 1:39.3–1:47.8 | 6 | 3 (mostly simultaneous shot and focus changes; fine) | 8.8 |
| aged | 1:47.8–1:51.6 | 5 | 3 (same) | 14.8 |
| outro | 1:51.6–1:58.5 | 2 | 0 | 3.3 |

## What makes it look janky

1. **Back-and-forth scrolling on long pages.** In Compare the camera whips down to "What moved", back up to the verdict, down to Next steps, then further down to the explain fold. That's 4–5 long travels in 15 s, several with motion-blur frames (about 0:41.5, 0:47, 0:48.5). This is the main source.
2. **Hops faster than a read.** The three "what moved" rows get 0.7 s each (0:42–0:44), and nobody can read a row in 0.7 s. The four explain options are clicked 0.7 s apart (0:49.4–0:51.7), and each one swaps in a **wall of small text** that is unreadable at that speed.
3. **A dense ladder walk:** Impact steps through the six-step worst-case chain in 1.7 s (1:36.1–1:37.8).
4. **Scroll jumps at the scene hand-offs:** Identify→Inspect (about 1:03) jumps from the answer card to "Look here first". Inspect→Audit (about 1:12) zooms out and changes page in one move.

## Rules for the fix (apply them everywhere)

- **One destination per narration clause,** and each read stays on screen long enough:
  - a chip or number: at least 1.5 s;
  - a short line of UI text: at least 2.5 s;
  - never two camera moves inside 1.2 s, unless one is the click's own state change.
- **Never scroll back up.** Within a page, the camera only travels downward, by at most about one viewport per move. If the narration needs something far away, or something it has already passed, **lift it as an overlay card** (the cropped capture floats over the dimmed window) or cross-dissolve. Don't scroll there.
- **No motion-blur whips across long pages.** Motion blur stays for short, intentional moves only.
- **Show less when needed.** Drop the less important beats rather than speeding up. Speed is not the fix.
- **Text density:** when UI text is the read, frame at most about 6 lines, or lift the one sentence that matters.

## Fixes per scene

**Compare (0:37.8–0:53.4): restructure, don't speed-tune.**
1. "When a batch arrives, I compare it with what the supplier promised." The window rises on the top of the page in **one framing**: the verdict card and the baseline label. A spotlight on the baseline at "promised". No zoom-hops.
2. "Each row shows how far one measurement has moved." One gentle move down to "What moved". Spotlight **only the top row** (the biggest mover) and hold. Drop the row 2 and row 3 hops (or briefly glow all rows together, then settle on row 1).
3. "This batch says investigate," **Don't scroll back up.** Lift the captured verdict card as an overlay over the dimmed page, with the INVESTIGATE hero type (keep it; it works).
4. "so it's held for a closer look." The first Next-steps item lifts as a second overlay card under the verdict card. No scroll.
5. "The tabs explain it for each role, from operator to manager." Dissolve to the explain section, and click **only Operator, then Manager**, each held about 2 s with readable text. Engineer and Scientist can be skipped. If the new **Claude per-audience summaries** have landed (2–3 sentences, numbers in bold), show those: they're made for this moment.

**Identify → Inspect (about 1:03):** use a shared-element move. The tile image in the answer view grows into the "Look here first" image, instead of a scroll jump. Keep the ring-and-zoom peek and the Silicon/Pore switches as they are: that part reads well.

**Inspect → Audit (about 1:12):** first let the pore layer hold about 0.5 s. Then go to Audit with a sidebar click and a cross-fade; no zoom-out-and-jump.

**Audit (1:12–1:26):** fine overall. Fix the heading clipped at the window edge during the Verify zoom (about 1:18), and keep the lawsuit hit as it is.

**Impact (1:26–1:39):** don't walk all six chain steps. Draw the chain in one smooth reveal (about 0.8 s), then hold on the worst-case end and on "what would rule it out" for at least 2 s.

**Already known (from the frame review), fix in the same pass:**
- In Identify, text is cut at the window edges when zoomed (about 0:57–1:03).
- The short-circuit flash is a blue zig-zag bolt (0:34.9). Use a brief white-orange arc or spark at the needle tip instead.
- Animate the C-rate and Ageing slider thumbs during the drags.
- Re-capture from a clean checkout of the latest `main`, so the passport's Code line doesn't say "uncommitted changes" and Identify shows the latest UI.

## Check before calling it done

- Re-run the view-change count. Compare should have **at most about 8** view changes and no gaps under 1.2 s, except a click and its own state change.
- Watch 0:37–1:15 at full speed three times as a first-time viewer. Every read should land before the next one starts.
- Total stays ≤ 119.5 s. The voice and narration are unchanged.
