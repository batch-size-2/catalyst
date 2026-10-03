# Task: a 2-minute animated demo video for our hackathon app "Catalyst"

Build it end to end, unattended, and finish with a rendered MP4. Work in the folder `demo_video/` on a new branch `demo-video/explainer` off `main`. Don't touch anything else in the repo except where this brief says so.

The video mixes two things: **cute animated explainer scenes** with our cat mascot, and **real screenshots of the running app**, which the cat presents. The screenshots must show the app with real data. The real data is confidential, so it never reaches you; the workflow below handles that.

## What Catalyst is (for the story)

Battery makers buy anode material (graphite + a little silicon) from suppliers. Catalyst takes electron-microscope images of a delivery and (1) says which known batch each image looks like, how sure it is and why, (2) shows what sets the batches apart and how well that holds on unseen images, (3) gives a batch verdict (accept / investigate / reject) with honest uncertainty, explained for four audiences, and (4) fingerprints every input so results can be audited.

## Real app screenshots: how this works

The microscope images and everything in `data/`, `out/` and `EXAMPLE BATCHES FOR LOCAL REFERENCE/` are too big to commit (raw TIFFs). Screenshots of the app on them are fine to commit. So:

1. **You build a capture script** `demo_video/capture/capture.mjs` (Playwright, Chromium or the installed Chrome channel). It opens the running app at `http://localhost:5173`, walks through the shot list below, and saves each shot to `demo_video/public/screens/<name>.png` at 1920×1080 (device scale factor 2 for sharpness), plus `demo_video/public/screens/manifest.json` with the bounding box of every highlighted element (so the video can zoom into and outline the exact element). Find elements by visible text and ARIA roles that already exist in the UI (e.g. the "Main views" nav, the "Sort images" / "What's different" / "Batch verdict" buttons, the "Explanation audience" tablist). If a shot really needs a stable selector, you may add `data-demo="<name>"` attributes in `web/src/` and nothing else there; keep `cd web && npm run build` passing.
2. **You develop against the example data**, which is synthetic and safe. Start the API and UI with the fixtures as in the README's "Preview the UI with fixtures" section (`cp tests/fixtures/... out/...`, `uv run uvicorn qc.api:app`, `cd web && npm run dev`). Run your capture script against it and build the whole video with those example screenshots.
3. **We swap in the real ones.** On our machine, with the app running on the real batches, we run `node demo_video/capture/capture.mjs` and then `npx remotion render`. The video must pick up the new screenshots and the new `manifest.json` with **no code changes**: no hard-coded coordinates, everything driven by the manifest.
4. `demo_video/public/screens/` is **gitignored** (add the rule). Commit the script, not the PNGs. Your example renders stay local too.

### Shot list

| Name | Screen and state | Highlights for the manifest |
|---|---|---|
| `sort_upload` | "Sort images" view, before running: the upload area | The upload / drop area |
| `sort_result` | "Sort images" after an attribution result is shown | The first image card's predicted batch and probability bars; its reasons list |
| `sort_card_zoom` | Same, scrolled to one image card | The mask overlay image; the "unfamiliar" badge if present |
| `different_overview` | "What's different" view | Feature families table; the confusion matrix |
| `different_features` | "What's different", scrolled to "Top features" | The top 3 feature rows |
| `verdict_card` | "Batch verdict" for a non-baseline batch | The verdict card (verdict + next action) |
| `verdict_explain` | Same, explanation tabs | Click through operator → engineer → scientist → manager; save one PNG per tab (`verdict_explain_operator.png`, ...) and the tablist box |
| `verdict_differences` | Same, the differences table | The first key quantity row |
| `provenance` | Same, the provenance panel | The input hashes; the rules-frozen line |

Capture scrolls the element into view first, waits for network idle and for fonts, and hides the mouse cursor.

## Tech

- Remotion (latest), TypeScript, created with the official scaffolder (blank template). 1920×1080, 30 fps, **total ≤ 120 s**.
- Explainer scenes are drawn in code (SVG/CSS). Screenshots come only from `public/screens/`. No stock images or footage, no real company logos, no music.
- Fonts: Fredoka for headings, Nunito for captions and labels (via `@remotion/google-fonts`).

## Art direction: cute, calm, clean

- Soft pastel world for the explainer scenes and around the screenshots: background `#F6F1FF` → `#EAF6F5` gentle gradient. Ink `#2B2D42`. Accents: teal `#14A39A` (baseline Batch_3), amber `#F2A93B` (Batch_1), violet `#8B6CE0` (Batch_2), silicon orange `#FF8A3D`, pore blue `#4A7BE0`, graphite grey `#8A9099`.
- **Screenshots** sit in a rounded "laptop window" frame with a soft shadow, slightly tilted (≤ 3°) and floating. Guide the eye with slow zooms and pans into the manifest's boxes, a soft spotlight (dim everything except the highlighted box), and a rounded outline that draws itself around it. Never more than one highlight at a time. Text in a screenshot must be readable when it's the point of the shot: zoom until it is.
- Few elements on screen at once. Every motion uses `spring()` or eased `interpolate()`; nothing linear or jittery. Soft transitions (fade, slide, or the cat carrying the next scene in).
- **Mascot "Catalyst" the orange cat already exists: use it, don't redraw it.** Import `assets/cat/Cat.tsx` (plain React, no dependencies) and pass `t={frame / fps}` so its idle loop (float, blink, tail sway, ear twitch) runs. Props: `expression` (happy | curious | surprised | proud | shrug), `pose` (float | hold | point | wave | shrug | stamp), `size`, `lookAt`. Move it with a wrapper `<div>` (position, scale, rotation via `spring()`). Open `assets/cat/preview.html` to see every version. Small additions (a prop in a paw, a speech bubble) are fine. In screenshot scenes the cat sits beside the window and points at the highlighted box (`pose="point"`, `lookAt` towards it); it never covers the highlight or the captions.
- **Logo:** `assets/logo/catalyst-logo.svg` (the c is a cat head, the y has a tail), `catalyst-logo-on-dark.svg`, `catalyst-mark.svg`. Use them for the title and outro.
- In the science scene, the microscope view is a **drawn illustration**: dark background, grey flattened ellipses (graphite), small bright dots (silicon), black gaps (pores).

## Narration (use this text exactly)

Scene 1, Hook:
"Meet Catalyst. Battery makers spend around fifty thousand pounds on microscope images of their materials. And one question matters: is this delivery the material we were promised?"

Scene 2, The science:
"Inside a battery's anode, grey graphite flakes store the lithium. Tiny bright silicon specks store ten times more, but they swell up every charge. Black pores let the lithium flow. Change the recipe, and the battery changes too."

Scene 3, Sort:
"So drop in new images. Catalyst measures the silicon, the particles and the pores, and tells you which known batch each one looks like, how sure it is, and why."

Scene 4, What's different:
"It shows what actually sets the batches apart, and how well that holds up on images it has never seen."

Scene 5, Verdict:
"Then a verdict for the whole batch: accept, investigate or reject, explained for the operator, the engineer, the scientist and the manager. And when the data can't settle it, Catalyst says so."

Scene 6, Trust:
"Every result carries a fingerprint of its inputs, and our rules were frozen before the test images arrived. No tuning after the fact."

Scene 7, Outro:
"Catalyst. Know your material before it goes into a car. Built by Team Batch Size 2."

## Storyboard

| # | Visual | Catalyst the cat |
|---|---|---|
| 1 | The Catalyst logo draws itself stroke by stroke, then its ears wiggle. A small stack of £ coins next to a microscope icon, then a big question mark over a delivery box | Floats in from the left, waves, pulls goggles down on "one question" |
| 2 | Drawn: a cartoon battery, zoom into the anode illustration. Labels pop in as they're spoken: graphite, silicon, pores. One silicon dot inflates ~1.5× on "swell up" | Curious; pokes the silicon dot, startled when it inflates |
| 3 | Screenshots `sort_upload` → `sort_result` → `sort_card_zoom`. Zoom into the probability bars, then the reasons, then the overlay | Carries an image card into the window on "drop in", then points at each highlight, proud at the result |
| 4 | Screenshots `different_overview` → `different_features`. Highlight the confusion matrix, then the top features | Hops onto the window edge, curious, points |
| 5 | Screenshots `verdict_card` → `verdict_explain_*` (flip through the four tabs in time with "operator, engineer, scientist, manager") → `verdict_differences` | Shrugs on "can't settle it", then thumbs-up |
| 6 | Screenshot `provenance`, highlight the hashes, then the rules-frozen line; a drawn sealed envelope slides over it | Stamps the envelope with a paw print |
| 7 | The Catalyst logo, subtitle "batch QC for battery materials", "Team Batch Size 2" | Curls up next to the logo, slow blink, happy |

If a screenshot or a manifest box is missing at render time, show a neutral rounded placeholder card with the shot's name instead of crashing, and log a warning.

## Audio and subtitles

1. Read `ELEVENLABS_API_KEY` (and optional `ELEVENLABS_VOICE_ID`) from the environment. If no voice ID is set, list voices with `GET /v1/voices` and pick a warm, friendly, clear English voice; record which one in the README.
2. For each scene, call `POST /v1/text-to-speech/{voice_id}/with-timestamps` (model `eleven_multilingual_v2`). Save `demo_video/public/audio/sceneN.mp3` and the alignment JSON. Commit these: they contain no confidential data, and they let us re-render without the API.
3. Turn the character timings into word timings, then into captions: bottom centre, max 2 lines, about 6–8 words per page, the current word highlighted. Also export `out/captions.srt`.
4. Each scene's length = its narration length + 0.6 s of padding. Time the animations to the words (e.g. the "silicon" label pops in when "silicon" is spoken; each explanation tab appears as its audience is named).
5. Check the total is ≤ 120 s. If it's longer, tighten padding first, then speed up the speech slightly (≤ 1.1×). Never cut narration text.
6. If the API key is missing or calls fail, don't stop: estimate timings at 2.4 words per second, render with captions only, and say so clearly in the README.

## Quality loop (required)

- After building each scene, render stills with `npx remotion still` at its start, middle and end, and look at them. Fix: overlapping elements, text outside a 5% safe margin, the cat covering captions or a highlight, unreadable screenshot text when it's the point of the shot, inconsistent cat size, empty-looking frames.
- After the full render, verify the duration with `ffprobe`, extract one frame every 5 s into `out/contact_sheet.png`, review it, and fix anything off. Do at most two full polish passes.
- The final pass should feel smooth and calm: no element appears without an entrance, nothing pops jarringly, and the cat is always alive (idle animation).

## Deliverables

- `demo_video/` Remotion project: one component per scene, plus `Captions.tsx`, `Screenshot.tsx` (frame, zoom, spotlight and outline driven by `manifest.json`) and a shared `theme.ts`. Import the cat from `../assets/cat/Cat.tsx` (copy it into the project only if the bundler can't import outside its root, and keep the copy identical).
- `demo_video/capture/capture.mjs` and the shot list above.
- `demo_video/README.md`, written for us: (1) start the app on real data, (2) `node demo_video/capture/capture.mjs`, (3) check the screenshots, (4) `npx remotion render`; plus how to preview (`npx remotion studio`), change the narration, and which voice was used.
- Local only, not committed: `demo_video/out/catalyst.mp4` (H.264, 1080p), `out/captions.srt`, `out/contact_sheet.png`, all rendered from the example screenshots. Describe them in your final message and attach the contact sheet if you can.
- Commit on branch `demo-video/explainer` and open a PR; do not merge. Never commit `node_modules/`, `public/screens/`, `out/`, `.env` or the API key.
