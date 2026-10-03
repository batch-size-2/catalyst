# Phase 1 report: the animatic

**Output:** `out/animatic.mp4`, 1920×1080, 30 fps, H.264 (CRF 18) + AAC, **86.8 s** (ffprobe 86.76 s, timeline 86.67 s), 84.5 MB. Also `out/captions.srt` (41 cues) and `review/contact_sheet.png` (one frame every 4 s, labelled with timestamp and scene).

Rebuild: `npm run animatic` (render + SRT, about 10 min on this machine), `npm run sheet`, `npm run stills -- compare@0.5 42.9` (review stills from one bundle into `.cache/stills/`), `npm run studio`.

## Scene timings

Scene length = lead + audio `duration` + `gap_seconds` (0.6) + hold. All seven audio files matched `narration.json`, so nothing was estimated and there were no timing warnings.

| # | Scene | Start | End | Length | Lead / hold |
|---|---|---|---|---|---|
| 1 | news | 0:00.0 | 0:14.9 | 14.9 s | 0.6 s lead, 0.4 s hold |
| 2 | science | 0:14.9 | 0:34.0 | 19.1 s | |
| 3 | compare | 0:34.0 | 0:50.4 | 16.3 s | |
| 4 | identify | 0:50.4 | 1:05.0 | 14.6 s | |
| 5 | inspect | 1:05.0 | 1:11.2 | 6.2 s | |
| 6 | audit | 1:11.2 | 1:16.8 | 5.6 s | |
| 7 | outro | 1:16.8 | 1:26.7 | 9.9 s | 2.2 s hold, 0.9 s fade to black |

App scenes (3–6) take 42.7 s, or **49 %** of the runtime: just under the "about half" target. See the suggestions below.

## What's in it

- **Engine:** `src/core.ts` is the pure timing engine, shared by the video and `scripts/captions.ts`. It turns `narration.json` + `public/audio/*.json` + `script.json` into one global timeline. Beats fire on words (case and punctuation ignored, `[tags]` skipped, multi-word `at` supported, `offset` in seconds). Missing or stale audio falls back to 2.5 words/s with a warning. Missing files (stand-ins, sfx, plates, music) are probed in `calculateMetadata` and skipped or replaced by a placeholder card. Every layer is a pure function of `(timeline, t)` (`src/state.ts`), so the camera, the window and the cat's pointer always agree on geometry.
- **Stage:** the coloured or grey plate with mask tints (`mask-mode: luminance`), a Ken Burns drift, the 32 px grid, a vignette and a caption scrim on bright plates. The browser window has a frosted title bar, traffic lights, a favicon tab, a URL pill that follows the route, and an orange-teal edge glow. Captions use Geist 500 at 40 px with the current word in orange, balanced pages of up to 8 words, and they never split names like "Chevy Bolt" or end a line on "the".
- **Scenes 1, 2 and 7 at full quality:**
  - News: glass fact cards that stack, $1.9 billion counting up in Geist Mono, line-art cars filling in from the centre, and the Samsung card peeking in behind.
  - Science: the hexagon mark draws itself. A vector dive goes car → pack → cell → anode, and the anode layers are *windows onto the real plate*, so the dissolve into the full-brightness micrograph is seamless. Then come the graphite edge glow, the silicon and pore masks with pinned labels, a "silicon on charge" inset swelling to ×1.5, all phases on, and the dim into the background.
  - Outro: the window shrinks and fades, the plate brightens, the news cards flicker and dissolve, the wordmark card appears with its subtitle and team line, and the cat sits beside it.
- **Scenes 3–6:** stand-in screenshots inside the window, with a camera (scroll or zoom to hand-measured highlight boxes, slow push-in), cross-fade/slide "flies" between routes, and a small `STAND-IN · <file>` tag.
- **Cat:** about 210 px tall and always in the margins. It travels on spring arcs with a lean and a turn. Its one long trip, left to right in Identify, hops over the window out of frame. A telescopic pointer with a glowing tip reaches into the window and aims just inside the current highlight. It also has a magnifier, a tile card and glass callouts, all with text from `script.json`.
- **Sound:** the narration, plus 10 sfx cues from beats with a per-sound mix (`script.json → sfxMix`; whoosh is the quietest). `mrrp` plays once, on the cat's entrance. I also added the optional music bed (`public/music/bed_soft.mp3`, volume 0.5, about 21 dB under the voice, fading in and out); delete `"music"` from `script.json` to drop it. The overall mix is −20.6 dB mean and −2.9 dB peak.

## Still placeholders

1. **All app footage (scenes 3–6) is stand-ins** from `docs/screenshots/`, copied to `public/standins/`. Highlight boxes are hand-measured in `standins.json`, a Phase-1-only file that `manifest.json` replaces in Phase 2. The stand-ins are 1× PNGs, so the 3× zoom on silicon in Inspect is soft.
2. **No spotlight, outline or cursor** (milestone 4). The cat's pointer and the camera carry attention instead. In Compare, nothing clicks the four "Explain it to…" tabs; callouts name the audiences.
3. **Inspect's grey → colour switch is faked**: the micrograph and switch boxes of `viewer.png` are drawn greyscale until "pixels", then cross-fade to colour.
4. **The audit hash is made up**: `script.json → audit.hash` is a stand-in string. In Phase 2 it should come from the captured row's `innerText`. The "Verify everything" click and the table ticks aren't animated. The cat stamps a glass "verified" card in the margin instead.
5. **The cat is the current `assets/cat/Cat.tsx`, unchanged**, because `assets/` was read-only for this run. Here's how far it gets:
   - **What's there:** the rim glow, applied as an SVG filter in `CatActor`, and the items (pointer, magnifier, tile), drawn by `CatActor` as overlays.
   - **Missing:** the lab coat, the brand-orange fur and the dark ink. The strap is still teal, and teal means "baseline" in the app.
   - **Missing:** `goggles: "down"` and the `thinking` / `focused` expressions. Both expressions fall back to `curious`.
   - **The stamp shortcut:** the stamp pose is mostly hidden behind the verified card.
6. No capture or `shots.json` (milestone 3, skipped as the brief asks). `script.json` already uses the Phase-2 shot names (`compare_verdict`, `identify_result`, `library_tile`…).

## What I'd improve next

- **Milestone 4 first:** a spotlight plus a self-drawing outline on the active highlight, and the cursor clicking the explain tabs, the Segmentation switch and "Verify everything". This is the biggest legibility gain; it's hard to tell what to read in the stand-in shots.
- **The cat upgrade** in `assets/cat/` (needs write access there): the coat, the brand colours, the goggles down for Inspect, and the items held in the paw instead of overlaid.
- **Glass capture** (the transparent page over the blurred plate) so the window feels like part of the bench; the current shots are opaque.
- **Window push-ins** (the `push` beat field exists but is unused) on "accept", "which batch" and "verified" for emphasis.
- **The science dive** could use a slightly richer car and pack and a little motion blur. The anode-to-plate dissolve itself works well.

## Script and timing suggestions

- **Give Compare more room** (the main feature): add a `hold` of about 1 s after "accept, investigate or reject." so the verdict can land before "And I'll explain it…". The four audiences ("operator … manager") arrive about 0.5 s apart (47.2–49.3 s), too fast for four cursor clicks. Either click only two tabs or reword to something like "…in the right words for whoever's asking: the operator, the engineer, the scientist or the manager."
- **Audit is the shortest scene (5.6 s)** but carries the strongest honesty point. Consider adding a line from the brief: "And the rules were frozen before the test data arrived." (about +3 s, still well under 120 s). It would also give the rules-frozen banner a beat.
- **Science is the longest scene (19.1 s, 22 %).** If app time needs to grow, trim "Blue is space for the lithium to move." to "Blue is where lithium moves." The visuals keep up either way.
- **Identify:** I moved the fly to `identify_empty` from "single image" to "drop" so the tile has time to land before "I measure…" cuts to the analysing shot. With real captures, a 0.3 s `lead` on this scene would let you keep "single image" as the beat.
- **Cat travel:** the hop over the window on "which batch" is the only busy moment. Starting Identify with the cat already on the right (carrying the tile in from there) would remove it.

## Decisions and deviations (rules in `DEVIN_PHASE1.md` win over `PROMPT.md`)

- **No commits.** PROMPT.md says to commit after each milestone; DEVIN_PHASE1.md forbids git writes. Everything is uncommitted in the worktree for you to review.
- **Node:** the system `node` (Homebrew node 19) is broken because ICU 72 is missing. I ran Homebrew's existing keg-only `node@22` by putting `/opt/homebrew/opt/node@22/bin` first on PATH, in my commands only. Nothing was installed or relinked. To find it I listed `/opt/homebrew/Cellar` and ran `which`; that's the only thing I looked at outside the repo.
- **Versions:** `npm view --before` ignored the date, so I pinned Remotion **4.0.529** (25 Sep, the last release before the one-week cutoff) and installed everything with `--before=2026-09-26`. TypeScript resolved to 7.0.2.
- **Fonts** come from the `geist` npm package (copied to `public/fonts/`) instead of `@remotion/google-fonts`, because that one fetches from Google at render time, which the network rule doesn't allow.
- **Cat import:** `src/CatActor.tsx` imports `../../assets/cat/Cat` by relative path. `remotion.config.ts` (and `scripts/stills.mjs`) add `demo_video/node_modules` to webpack's `resolve.modules` so the file resolves this project's React.
- **Copies into `public/`:** `fonts/`, `logo/` (3 SVGs from `design/logo/`) and `standins/` (6 PNGs from `docs/screenshots/`, about 3.5 MB). The sources are untouched, and `public/standins/` can go once real captures exist.
- **Transitions:** `@remotion/transitions` is installed but unused. The stage is persistent: one window from Compare to Audit, routes "fly" inside it, and every move is an eased `interpolate` or `spring`, which matches the brief's preferred transition.
- **Contact sheet:** this ffmpeg has no `drawtext`, so the sheet is a Remotion composition (`ContactSheet`) that renders the real frames scaled down with HTML labels.
- **Mid-run worktree change:** around 23:00, `narration.json`, `sfx.json`, `DEVIN_PHASE1.md`, `public/audio/` and `review/style/` briefly vanished, then reappeared with `public/music/` and `tools/music.py` added. That wasn't me. I re-checked that the audio durations and narration were unchanged before continuing.
- **Not done (outside `demo_video/`):** AGENTS.md asks agents to save learned commands to a rules file; I didn't touch the repo `AGENTS.md`. The commands are listed at the top of this report.

## Files I created (all in `demo_video/`)

`package.json`, `package-lock.json`, `tsconfig.json`, `remotion.config.ts`, `script.json`, `standins.json`, `src/` (`core.ts`, `state.ts`, `theme.ts`, `fonts.ts`, `Root.tsx`, `Animatic.tsx`, `ContactSheet.tsx`, `Background.tsx`, `BrowserWindow.tsx`, `Screen.tsx`, `Captions.tsx`, `CatActor.tsx`, `scenes/{News,Science,AppOverlays,Outro}.tsx`), `scripts/` (`stills.mjs`, `captions.ts`, `montage.sh`), `public/{fonts,logo,standins}/`, `review/{PROGRESS.md,PHASE1_REPORT.md,contact_sheet.png}`. Generated and gitignored: `node_modules/`, `out/`, `.cache/`.
