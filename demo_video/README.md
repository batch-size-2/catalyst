# Catalyst demo video

A ~118 s launch film for Catalyst, built in [Remotion](https://remotion.dev) from data files: the voiced narration (`narration.json` + `public/audio/`), the beats (`script.json`), and real captures of the running app (`public/screens/`, `public/clips/`). When the UI changes you re-capture and re-render; no code changes needed.

Deliverables land in `out/` (gitignored): `catalyst.mp4` (1080p30, H.264 + AAC), `catalyst-720p.mp4`, `captions.srt`. Review images go to `review/check/`.

## Setup (once per shell)

The system `node` is broken on this machine; use Homebrew's node@22. From `demo_video/`:

```bash
export PATH=/opt/homebrew/opt/node@22/bin:$PATH npm_config_cache=$PWD/.cache/npm TMPDIR=$PWD/.cache/tmp XDG_CACHE_HOME=$PWD/.cache REMOTION_DISABLE_TELEMETRY=1
npm ci                                  # only if node_modules is missing
```

## The loop: start the app → capture → check → render

1. **Start the app on real data** (from the repo root; ports are yours to choose, never stop someone else's):

   ```bash
   uv sync --frozen && nohup .venv/bin/uvicorn qc.api:app --port 8001 > demo_video/.cache/api.log 2>&1 &
   cd web && npm ci && CATALYST_API=http://localhost:8001 nohup npm run dev -- --port 5174 > ../demo_video/.cache/web.log 2>&1 &
   ```

   Check `curl -s http://localhost:8001/openapi.json` lists `/api/impact/{batch}` and `/api/slab/{batch}`.
   The data must contain the `drop_demo` identification **with its images** (otherwise the Identify page says "images are no longer on disk" and the region peek has no spots), and its decisions must verify. The Phase 2 capture used this worktree's `web/` on :5176 against the main checkout's API on :8001 for exactly that reason (see `review/PHASE2_REPORT.md`).

2. **Capture** (Playwright with the installed Google Chrome, a temporary profile, 1400×780 @2x):

   ```bash
   APP_URL=http://localhost:5174 npm run capture                 # everything (~4–5 min)
   APP_URL=http://localhost:5174 npm run capture -- --only audit,audit@verified   # some shots
   APP_URL=http://localhost:5174 npm run capture -- --no-clips   # stills only
   ```

   It writes `public/screens/<shot>.png` (+ `.vp.png` viewport shots for the fixed sidebar), `public/clips/<clip>.mp4` and `public/screens/manifest.json` (every highlight box, click target and the sidebar nav in CSS px). A seatbelt aborts every non-GET request except `POST /api/verify/*` and logs it; the script never starts runs, uploads, measurements, Claude calls or settings changes.

3. **Check the screens**: `node capture/review.mjs` draws every highlight box onto its shot in `review/check/capture/`. Open them and make sure each box sits on the right element. Clip strips are there too.

4. **Render**:

   ```bash
   npm run render          # out/catalyst.mp4 + out/catalyst-720p.mp4 + out/captions.srt (~5–10 min)
   npm run contact         # review/contact_sheet.png (one frame every 4 s, labelled)
   ffprobe -v error -show_entries format=duration out/catalyst.mp4   # must be ≤ 119.5 s
   ```

Re-voicing (only if `narration.json` changes, needs the team's ElevenLabs key): `python3 demo_video/tools/voice.py` from the repo root.

## Preview and review tools

```bash
npm run studio                                  # live preview (Remotion Studio)
npm run words [scene ...]                       # every word's time + every beat's resolved time/frame
npm run sheet [scene,scene]                     # first/middle/last frame of every shot -> review/check/sheet*.jpg
npm run strip -- 82.4 82.9                      # every frame of a moment (add --step=2, --scale=0.4)
npm run crop -- 52.4 800,300,900,400            # full-resolution region -> review/check/crop_*.png
npm run stills -- 3.5 compare@0.5               # seconds, or <scene>@<fraction>
npm run typecheck
```

## How it's built

| File | What |
|---|---|
| `narration.json`, `public/audio/` | The final voice: 10 scenes, per-word timings. Read-only. |
| `script.json` | Per-scene `lead`/`hold` and **beats**. A beat fires at the first occurrence of its `at` word(s) after the previous beat (+ `offset` s). |
| `src/core.ts` | Timing engine: narration + word timings + beats → one timeline; caption pages; hero words leave the captions. |
| `src/state.ts` | Everything on screen as a pure function of `(timeline, t)`: background modes, window layout, the screen camera, spotlight/lift marks, the cursor, the cat. |
| `src/Screen.tsx` | The app inside the window: manifest shots (page + fixed sidebar, viewport states, clips), camera, moving spotlight with self-drawing outline, cursor + ripple, 2.5D lifts, wipes and covers. |
| `src/HeroType.tsx` | Big kinetic type; each word lands on its spoken word. |
| `src/CatActor.tsx` + `../assets/cat/Cat.tsx` | The cat: margins, arcs, acted expression changes (squint → squash take → new face → emote), goggles, items. `Cat.tsx` only gained opt-in props. |
| `src/scenes/*` | News (hook), Science (dive, phases, lithium needles, arc, fire), Outro, app overlays (tile toss, button pulse, hit ring). |
| `capture/capture.mjs`, `shots.json` | The capture: routes, steps, highlight selectors (by text and ARIA), states and clips. |

### Beat fields (in `script.json`)

| Field | Does |
|---|---|
| `shot` / `clip` (+ `rate`, `clipFrom`) | Show a manifest shot (`compare`, `compare@manager`) or play a clip from this beat. A different page cross-fades like a navigation; a state of the same page cross-fades in place. `name#2` re-triggers the same clip. |
| `focus` + `zoom` (+ `force`) | The camera scrolls and zooms to fit a highlight (zoom is the cap; `force` pushes in to exactly `zoom`). `focus: null` shows the whole width at the current scroll; `scroll` sets it. |
| `spot` | Dims the page around a highlight with an orange outline that draws itself; consecutive spots glide. `null` ends it. |
| `lift` | Lifts a highlight's crop off the page in 2.5D (with `fx: "type"` + `dur` its text types itself). |
| `cursor` | The pointer arrives 0.2 s early and presses on this beat (put `sfx: "click"` on the same beat). `nav:<page>` targets the sidebar. `hover` moves without pressing; `hover` + `drag: true` drags (sliders); `id:right` targets the right edge. |
| `reveal` / `cover` | With a state change, wipe the new state in row by row (Verify's ticks) / slide a card-coloured cover off bars so they grow. |
| `frame` | Window layout `center`, `left`, `right` (left/right make room for hero type). |
| `hero` | Big type: `words` (each `at` a spoken word; `count`, `color`, `mark`, `br`), `side`, `size`, `until`. |
| `cat` | `anchor`, `expression`, `pose`, `item`, `goggles`, `lookAt`, `emote`. Expression changes are acted automatically. |
| `bg`, `fx`, `sfx`, `window` | Background mode, scene effect, sound, window in/out. |

### How to change…

- **A beat**: run `npm run words <scene>`, edit the beat's `at`/`offset` in `script.json`, check with `npm run strip`.
- **A shot or highlight**: edit `shots.json` (selectors by visible text/ARIA), `npm run capture -- --only <shot>`, check `review/check/capture/`, then point a beat's `shot`/`focus`/`spot` at the new id.
- **A clip**: clips are recorded deterministically (the page clock stepped one frame at a time) by functions in `capture/capture.mjs`; `events` in the manifest give key frames (e.g. the lawsuit `press`). Re-capture with `--only <clip>` and adjust the beat's `clipFrom`/`rate`.
- **A hero-type moment**: add `hero` to a beat (see the `news`, `compare` and `aged` beats); the window slides aside if you also set `frame: "left"`, and remember a `frame: "center"` beat after `until`.
- **The lawsuit hit**: the cursor press, the `lawsuit` sfx and the clip start share one beat (`audit` "button" + 0.75 s); keep them together.

Missing screens, clips or audio never crash the render: a placeholder card shows and a warning prints.
