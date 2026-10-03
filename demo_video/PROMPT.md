# Task: a 2-minute animated demo video for our hackathon app "Catalyst"

Build it end to end, unattended, and finish with a rendered MP4. Work in `demo_video/` on the branch `demo-video/explainer` (it already exists with this brief and the background plates; continue on it). Don't modify `demo_video/tools/` or `narration.json` (they're ours). Besides `demo_video/`, you may only touch `assets/cat/` (the mascot redesign below) and add `data-demo="…"` attributes in `web/src/` (keep `cd web && npm run build` passing). Don't touch `qc/`, `config/`, `docs/` or the README's architecture sections. Install npm packages with `npm install --before=<date one week ago>` (repo rule).

The app is still changing, so **build an engine, not a one-off**: the shot list and the narration are data files. When the UI changes, we edit JSON, re-run capture and render, and no code changes are needed.

## Phase 1 (do this first, then stop): the animatic

We want to judge the flow before the real app shots exist. Build and render a full-length animatic:

- All 7 scenes with the real narration (`public/audio/`), captions, beat timing, the background plate, the browser window, the cat and the sound effects (`public/sfx/`, see below).
- Scenes 1, 2 and 7 at full quality: they don't depend on the app.
- Scenes 3–6: skip capture (milestone 3) and the screenshot camera (milestone 4). Inside the window, show the nearest stand-in from `docs/screenshots/` (`identify-empty`, `identify-analyzing`, `identify-result`, `compare`, `viewer`, `audit`) with a slow push-in, cross-fading on the beat words, and a small "stand-in" tag in a corner. Keep the cat's moves and callouts, so the timing reads.
- The cat: do the upgrade (milestone 2) if you can make it look good. Otherwise use the current `Cat.tsx` with the `rim` glow and leave the coat for phase 2.
- Render `out/animatic.mp4` (1080p) and `review/contact_sheet.png`. Commit locally on `demo-video/explainer`; **don't push**. Then stop and report the duration, what's still a placeholder, and anything you'd change in the script or timing.

Phase 2 (later, when we say go): everything else in this brief.

## What Catalyst is (for the story)

Battery makers buy anode material (graphite + a little silicon) from suppliers. Catalyst takes electron-microscope images ("tiles") of a delivery and (1) compares the whole batch against the promised baseline (Batch 3) and gives a verdict, accept / investigate / reject, explained for four audiences (the commercially important feature, so it comes first); (2) says which known batch a single tile looks like, how sure it is and why, and flags tiles unlike anything it knows (the hackathon's set task, so it must be shown too); (3) lets you inspect every tile and its segmentation; (4) logs every decision with fingerprints of its inputs, with rules frozen before the held-back data arrived.

The app today (hash routes, see `web/src/router.ts`): **Identify tile** `#/identify`, **Compare batch** `#/compare/<batch>`, **Library** `#/library/<batch>/<image_id>`, **Audit log** `#/audit`. Design system: `design/README.md` and `design/tokens.css`. Real screenshots of the current UI for reference only: `docs/screenshots/*.png`.

## Look: the dark lab bench, a floating browser window

**Rough style frames** in `demo_video/review/style/*.jpg` show the intended layout and mood (composed by hand from real screenshots, with a quick lab-coat sketch on the cat). Match their composition and beat their polish.

Match the app exactly: near-black ground `#0A0B0D`, ink `#EDECE8`, muted `#A3A4A9`, brand/cat orange `#FF7A2F`, Batch 3 (baseline) teal `#2DD4BF`, Batch 1 blue `#6EA8FF`, Batch 2 violet `#B794FF`, accept/investigate/reject `#4ADE80` / `#FACC15` / `#F87171`, phases silicon `#FF9A3C`, pore `#38BDF8`, binder `#C48CFF`. Fonts: **Geist** for words, **Geist Mono** for numbers, IDs, hashes and small uppercase labels (`@remotion/google-fonts`). Logo: `design/logo/catalyst-mark.svg` and `catalyst-wordmark-on-dark.svg` (the hexagon cat). Don't use the old `assets/logo/`.

Composition, 1920×1080 at 30 fps, layered back to front:

1. **Background plate: the real coloured micrograph.** `demo_video/public/bg/` already holds plates built from the app's own segmentation overlays (by `tools/make_backgrounds.py`; you can't re-run it, since it needs the confidential data). The plates are `micro_color.jpg` (the app's coloured look), `micro_grey.jpg` (plain SEM grey) and `mask_si.png` / `mask_pore.png` / `mask_binder.png` (white = that phase; tint them in CSS with `mask-image`). All are 3200×1800. Default treatment: coloured plate at ~30% brightness, 2–4 px blur, vignette, the app's faint 32 px grid on top, a very slow drift (Ken Burns), and 0.3× parallax against camera moves. The plate is a character: it becomes the hero in the science scene and the outro (see storyboard).
2. **The browser window**, centred: about 1400×820 at (260, 64), with a 16 px radius, a hairline border `rgba(255,255,255,.08)`, a large soft shadow and a faint orange-teal edge glow. A macOS title bar 40 px tall, as frosted glass (a blurred, darkened copy of the plate behind it), holds the three traffic-light dots `#FF5F57 #FEBC2E #28C840`, a tab with `design/logo/favicon.svg` and "Catalyst", and a centred URL pill `catalyst.local/#/…` that updates per route. The content area (1400×780) shows the app. It is **glass**: a blurred, darkened (~75%) copy of the plate sits behind a screenshot captured with a transparent page background (see capture), so the micrograph glows faintly through the app's own glass panels. Fall back to the opaque screenshot if the transparent one is missing.
3. **Camera layer, inside the window**: smooth scroll (pan through a full-page screenshot, like a screen recording), zoom into a highlight while the title bar stays put, a soft spotlight (dim everything but the highlight box, rounded cut-out), an orange outline that draws itself around the box with a soft glow, and a macOS arrow cursor that glides on eased curves to click targets and clicks with a small orange ripple. When a click changes the state, cross-fade to the "after" screenshot under the cursor. One highlight at a time. When text in a highlight is the point, zoom until it is at least 28 px tall on screen. Occasionally push the whole window towards the camera (scale ≤ 1.08) for emphasis.
4. **The cat**, in screen space (rules below).
5. **Captions**, in the bottom band below the window (y ≈ 940–1040): Geist 500, about 40 px, `#EDECE8`, current word in orange, one line preferred (6–8 words per page, two lines max), entering on a soft fade/rise.

Motion: everything uses `spring()` or eased `interpolate()`, never linear. Spring defaults: UI and camera are calm (high damping, no overshoot); the cat is a little bouncier. Scene transitions via `@remotion/transitions`: soft fade or slide, or the camera flying from one route to the next inside the same window (preferred between app scenes, since the window never disappears between scenes 3 and 6). No element appears without an entrance. Keep the frame calm: few things moving at once.

## The mascot: a smart, cool materials-scientist cat

`assets/cat/Cat.tsx` (plain React, SVG, no dependencies) is the source of truth. **Upgrade it in place**, keeping its existing props backward compatible, then regenerate `assets/cat/svg/` and `assets/cat/preview.html` with `node assets/build.mjs` (update `assets/README.md`). The personality is calm, competent and a bit cool, not hyper: slow blinks, small head tilts, confident smiles.

- **Colours on dark:** fur in the brand orange family (body about `#FF8A3D`, stripes about `#E0621E`), cream `#FFF0DC`, outline ink `#15161A`. New prop `rim` (default `true`): a 3 px warm-cream outer rim at about 70% plus a soft orange glow, so the cat separates from the dark background.
- **Lab coat** (new prop `outfit`: `"labcoat"` default | `"none"`): off-white `#F2F0EA` with cool-grey shading, open at the front over the cream belly, rounded lapels, sleeves that follow every arm pose, and a breast pocket with an orange and a teal pen. A small clip-on ID badge shows the hexagon mark from `design/logo/catalyst-mark.svg` and "CATALYST" in tiny Geist Mono.
- **Goggles:** keep them as the signature, restyled. Graphite frame `#2A2C33`, a strap in graphite with an orange buckle (no teal: teal means baseline in the app), cool-tinted lenses with a white glint that sweeps across now and then. New prop `goggles`: `"up"` (on the forehead, default) | `"down"` (over the eyes, for focused, cool moments).
- **New expressions:** `focused` (slightly narrowed eyes, small smirk; the cool look) and `thinking` (eyes up and to the side, paw at chin). Keep happy, curious, surprised, proud and shrug.
- **New prop `item`**, held in a paw: `none` | `pointer` (a telescopic pointer stick with a glowing orange tip; props `pointerLength` and `pointerAngle`) | `clipboard` | `magnifier` | `tablet` | `tile` (a small square micrograph card; prop `tileHref`) | `stamp`. **The pointer is the key tool**: the cat stays in the margin and reaches into the window with the stick instead of its body.
- **Review artefact:** `demo_video/review/cat_sheet.png`, showing every expression, pose and item on `#0A0B0D` at 220 px, plus one 600 px hero still. Get the cat right before building scenes: it is on screen the whole time.

Cat rules in the video:

- It lives in the side margins (x < 260 or x > 1660, about 220 px tall), or peeks over the window's top edge like the app's `peeking` mood. Only a paw or the pointer tip may enter the window. It never covers the active highlight, the cursor's target or the captions: compute this from the manifest boxes after the camera transform, and if it would collide, move the cat.
- Pick the margin nearest the current highlight, so the pointer reaches it. Travel along gentle arcs with a lean and a trailing tail, at most 2–3 moves per scene. It is always alive (idle loop: float, blink, tail, ears).
- **Callouts:** a small glass speech bubble next to the cat with 1–4 words that reinforce the narration ("closest: Batch 1", "never seen this", "what moved"). Callout text comes from `script.json`, never from hard-coded numbers.

## Data-driven pieces (the engine)

### `demo_video/shots.json` + `demo_video/capture/capture.mjs`

A Playwright script (Chromium) that walks `shots.json` against the running app (default `http://localhost:5173`, override with `APP_URL`). Viewport 1400×780 CSS px (the window's content area) at device scale factor 2. For each shot:

- go to the route, run its steps (`click` by role/text, `waitFor`, `scrollTo`, `setInputFiles`), wait for network idle and fonts, and hide the real cursor;
- save `public/screens/<name>.png` (full page, opaque) and `public/screens/<name>.glass.png` (full page, transparent: inject CSS that makes the page ground and grid transparent, then `omitBackground: true`);
- record in `public/screens/manifest.json`, in full-page CSS px: the page size; each highlight's box and `innerText` (`highlights.<id> = {x, y, w, h, text}`); and each click target's centre;
- for state changes (tabs, switches, buttons), save `<name>@<state>` before and after, with the click target, so the video can show the cursor clicking and cross-fade.

Find elements by visible text and ARIA (e.g. `nav[aria-label="Main"]`, `aria-label="Drop zone"`, `aria-label="Verdict"`, `role="switch"`). Add `data-demo` attributes only where that's genuinely flaky. Print a clear warning for any shot or highlight it can't find, and keep going.

Starting shot list. Map it to the UI as it is when you run, and fix anything stale:

| Shot | Route and steps | Highlights / click targets |
|---|---|---|
| `identify_empty` | `#/identify` | drop zone (`aria-label="Drop zone"`) |
| `identify_result` | `#/identify`, open the first row of "Recent identifications" (or upload tiles via `DEMO_TILE_DIR` when set) | verdict card "Closest match" with batch, % and probability bars; "Unfamiliar" chip; "Model is right …% of the time · chance …" chip; "Why Batch N" table (first 3 rows) |
| `compare_verdict` | `#/compare/<first non-baseline batch>` | verdict; "Next steps" |
| `compare_moved` | same page | "What moved, and how sure we are" table, first row |
| `compare_explain` | same page, "Explain it to…" | one state per audience: Operator, Process engineer, Materials scientist, Manager (each tab is a click target) |
| `compare_separates` | same page | "What separates the known batches"; "Top single features" |
| `library_tile` | `#/library/<batch>/<image_id>` of a tile with a mask | micrograph; Segmentation switch (`role="switch"`): states off → on |
| `audit` | `#/audit` | rules-frozen banner; first decision-log row with hashes; "Verify everything" button: states before → after; batch passport |

### `demo_video/script.json`

Beats per scene, keyed by the scene ids in `narration.json` (the narration text lives there, not here). A beat fires at a word of the narration (`"at": "silicon"` means the first occurrence of that word at or after the previous beat) and can set: `shot` (+ `state`), `scrollTo`, `highlight`, `zoom`, `cursor` (click target id), `cat` (`anchor`, `expression`, `pose`, `item`, `goggles`, `lookAt` a highlight), `callout`, and `bg` (background mode). Scene components read their beats from here; changing a line of narration re-times everything automatically.

### Voice: pre-generated by us, no API key for you

You have **no ElevenLabs access** and must not call it. We generate the narration locally with `demo_video/tools/voice.py` (already written; don't change its output format) from `demo_video/narration.json`, and commit the result:

- `public/audio/<scene id>.mp3`: the voice line;
- `public/audio/<scene id>.json`: `{id, text, hash, voice_id, model_id, duration, words: [{text, start, end}]}` (seconds from the start of that line; `text` keeps its punctuation, e.g. `"pounds,"`).

Use them like this:

1. Captions and beats come from `words`. Match beat words case-insensitively, ignoring punctuation. Words in square brackets are ElevenLabs audio tags (e.g. `[curious]`): never show them in captions or match them as beat words. Also export `out/captions.srt`.
2. Scene length = audio `duration` + `narration.json` → `voice.gap_seconds` (the news and outro scenes may hold longer for visuals). Total ≤ 120 s. If it runs long, tighten the padding first. Never cut narration text.
3. If a scene's audio is missing, or its `text` doesn't match `narration.json` (we edited the line and haven't regenerated yet), don't stop: estimate timings at 2.5 words/s for that scene, render captions only, and log a warning. The video must render with no audio at all.

### Sound effects: pre-generated, use sparingly

`public/sfx/{drop,done,click,whoosh,stamp,mrrp}.mp3` were made by `tools/sfx.py` from `sfx.json`, whose `use` field says where each belongs. Trigger them from a beat field `sfx`. Tasteful means: at most one or two per scene, sitting well under the voice (roughly −18 to −24 dB relative to it; `whoosh` peaks hot, so turn it down the most), and `mrrp` only once, on the cat's first entrance. If a sound feels cheesy in the render, drop it. A missing file is skipped.

### Missing pieces never crash

A missing screenshot, state or highlight renders a neutral glass placeholder card with the shot name, logs a warning and the video still renders. Expect placeholders in your fixture render (fixtures have no micrographs, so the Library shot will be empty). That's fine: we capture on real data.

## Narration (in `narration.json`; shown here for the story)

The cat narrates in the first person, calm and dry, never salesy.

1. **News** (`news`): "In 2021, GM recalled every Chevy Bolt it had ever sold. The battery cells were faulty, and fixing them cost nearly two billion dollars. Hyundai had to swap the batteries in eighty-two thousand cars."
2. **Science** (`science`): "I'm Catalyst, and I check battery material long before it gets near a car. This is an anode under a microscope. Grey is graphite. Orange is silicon: it holds much more lithium, but it swells every charge. Blue is space for the lithium to move. If the mix drifts, so does the battery."
3. **Compare** (`compare`): "When a new delivery comes in, check it against what the supplier promised. You'll see what's changed, by how much, and how confident I am. You get a clear call: accept, investigate or reject. And I'll explain it in the right words for the operator, the engineer, the scientist and the manager."
4. **Identify** (`identify`): "You can also drop in a single image. I measure the silicon, the particles and the pores, then tell you which batch it looks like and how sure I am, with the reasons. If it doesn't look like anything I've seen before, I'll say so."
5. **Inspect** (`inspect`): "Don't just take my word for it. Open any image and see exactly which pixels I counted as silicon."
6. **Audit** (`audit`): "Every decision is logged with a fingerprint of its inputs, so anyone can check it later."
7. **Outro** (`outro`): "Catalyst. Catch the bad batch at the factory, before it makes the news. Made by Team Batch Size 2."

## Storyboard

Beat words in quotes are where things happen (map them into `script.json`). About half the runtime must be the real app (scenes 3–6), so keep scenes 1, 2 and 7 tight.

| # | Background, window and camera | Cat |
|---|---|---|
| 1 News | Black, very dim grey plate. Glass **fact cards** typeset by us (no logos, no page screenshots), each with a fact line and a source line. On "GM": *Every Chevy Bolt recalled · faulty battery cells*, source *NBC News / CNBC, Aug–Oct 2021*. Rows of small line-art cars fill in behind it. On "billion": *$1.9 billion* counts up in Geist Mono. On "Hyundai": a second card stacks on top, *82,000 Hyundai EVs get new batteries · fire risk · ≈ £640m*, source *BBC News, 24 Feb 2021*. Optional third card behind, with no narration: *Samsung Galaxy Note 7 · battery faults · ≈ $17bn in lost sales*, source *BBC News / NBC News, 2016–17* | Not on screen yet |
| 2 Science | On "I'm Catalyst", the cards slide away and the hexagon mark draws itself small at the top. The camera dives through a line-art car into the battery pack, then a cell, then the anode, which dissolves into the **grey plate at full brightness** (the hero). On "Grey", graphite flakes get a soft edge glow. On "Orange", the silicon mask lights up; on "swells", it pulses with a small inset of one particle swelling 1.5×. On "Blue", the pore mask lights up. On "drifts", all phases are on (the app's coloured look), then the plate dims and blurs into the background as the window rises | Floats in and waves on "I'm Catalyst". Holds the magnifier; startled on "swells" |
| 3 Compare | The first app scene, and the main feature: give it room. On "delivery", the window rises on `compare_verdict` (Batch 1 against the Batch 3 baseline; the URL pill reads `#/compare/…`). On "changed", the "What moved" table, top row (shift, interval and tolerance band). On "accept", the verdict card and "Next steps". The four explain tabs are clicked by the cursor on "operator", "engineer", "scientist" and "manager" | Rises with the window, `thinking`, then pointer; a small `shrug` on "investigate" |
| 4 Identify | On "single image", the camera flies to `identify_empty` and a tile card drops onto the drop zone (show the working state if captured). On "which batch", cut to `identify_result` and zoom to the verdict card and bars. On "reasons", scroll to "Why Batch N". On "seen before", spotlight the "Unfamiliar" chip | Carries the `tile` card in from the margin. Pointer to the bars (`proud`); `surprised` on the unfamiliar chip |
| 5 Inspect | On "Open any image", fly to `library_tile`. On "pixels", the cursor flips the Segmentation switch and the micrograph cross-fades from grey to colour. On "silicon", zoom into the orange | Goggles down, magnifier, `focused`, in the margin |
| 6 Audit | On "logged", `audit`: a decision-log row and its hashes (a hash string can type itself in an overlay). On "check it later", the cursor clicks "Verify everything" and ticks appear | Stamps a paw print onto a small glass "verified" card in the margin |
| 7 Outro | On "Catalyst", the window scales down and fades and the coloured plate brightens. On "makes the news", the fact cards from scene 1 flicker faintly in the background and dissolve. The wordmark on a glass card, subtitle "Batch QC for battery materials", then "Team Batch Size 2" | Curls up beside the logo, slow blink, `happy` |

## Quality loop (required)

- Milestones, in this order. **Commit after each one** (locally; push only when we say so), so a partial run is still useful: (1) scaffold, theme and stage (background, window, captions) with a placeholder; (2) the cat upgrade and `cat_sheet.png`; (3) capture against the fixtures, with the manifest; (4) the screenshot camera (scroll, zoom, spotlight, outline, cursor, cross-fade); (5) captions and beat timing from the audio JSON; (6) scenes 1–7; (7) the full render and polish.
- Develop against the **fixtures** (README → "Preview the UI with fixtures": copy `tests/fixtures/*` into `out/`, then `uv run uvicorn qc.api:app` and `cd web && npm install && npm run dev`).
- After each scene, render stills with `npx remotion still` at its start, middle and end, and look at them. Fix: overlaps, text outside a 5% safe margin, the cat covering a highlight or the captions, unreadable zoomed text, inconsistent cat size, empty frames.
- After the full render: check the duration with `ffprobe`, build `demo_video/review/contact_sheet.png` (one frame every 4 s, labelled with timestamps), review it, and fix. At most two full polish passes.

## Deliverables

- `demo_video/`: a Remotion project (latest, TypeScript, blank template) with `theme.ts`; `Stage.tsx` (background + window); `BrowserWindow.tsx`; `Screen.tsx` (camera, spotlight, outline, cursor, manifest-driven); `Captions.tsx`; `CatActor.tsx` (placement, travel, avoidance and callouts around `assets/cat/Cat.tsx`; import it via a relative path, or copy it in only if the bundler forces you to, keeping the copy identical); and one component per scene.
- npm scripts: `capture`, `studio`, `render` (→ `out/catalyst.mp4`, H.264 1080p, plus `out/catalyst-720p.mp4`) and `sheet` (contact sheet).
- `demo_video/README.md`, written for us: (1) start the app on real data, (2) `npm run capture`, (3) check the screens, (4) `python3 demo_video/tools/voice.py` (only if `narration.json` changed; needs our `.env`), (5) `npm run render`. Also: how to change a shot, a highlight, a beat or a line of narration, and how to preview in the studio.
- Commit `public/bg/`, `public/audio/`, `public/screens/` (screenshots of the app are fine, per AGENTS.md; ours will overwrite yours), `review/`, `shots.json` and `script.json`. Never commit `node_modules/`, `out/` or `.env` (`demo_video/.gitignore` covers them).
- Open a PR from `demo-video/explainer` into `main`; don't merge. In your final message: the PR link, the duration, a list of placeholders still showing, and `review/contact_sheet.png` and `review/cat_sheet.png` attached.

## If there's time (after everything above is done)

- A `music` file setting (a file in `public/music/`), ducked about −20 dB under the voice. A missing file is silently skipped.
- Subtle motion blur on the cat's travel and camera flies (`@remotion/motion-blur`), only if it stays crisp.
