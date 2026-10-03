# Task: a 2-minute animated explainer video for our hackathon app "Catalyst"

Build it end to end, unattended, and finish with a rendered MP4. Work in the folder `demo_video/` on a new branch `demo-video/explainer` (branch off `PtrkH/demo-video` if it isn't merged yet). Don't touch anything else in the repo, and never read or use anything in `data/`, `out/` or `EXAMPLE BATCHES FOR LOCAL REFERENCE/` (confidential microscope images).

## What Catalyst is (for the story)

Battery makers buy anode material (graphite + a little silicon) from suppliers. Catalyst takes electron-microscope images of a delivery and (1) says which known batch each image looks like, how sure it is and why, (2) compares a batch against the promised baseline on measurements like silicon amount, particle size and porosity, (3) gives a verdict (accept / investigate / reject) with honest uncertainty, and (4) fingerprints every input so results can be audited. Nothing is a black box: every reason is a measurement a scientist can check.

## Tech

- Remotion (latest), TypeScript, created with the official scaffolder (blank template). 1920×1080, 30 fps, **total ≤ 120 s**.
- Everything is drawn in code (SVG/CSS). No stock images, no external image or video assets, no real company logos, no music.
- Font: Fredoka for headings, Nunito for captions and UI text (via `@remotion/google-fonts`).

## Art direction: cute, calm, clean

- Soft pastel world: background `#F6F1FF` → `#EAF6F5` gentle gradient. Ink `#2B2D42`. Accents: teal `#14A39A` (baseline batch), amber `#F2A93B` (Batch 1), violet `#8B6CE0` (Batch 2), silicon orange `#FF8A3D`, pore blue `#4A7BE0`, graphite grey `#8A9099`.
- Few elements on screen at once. Big rounded shapes, generous whitespace. Every motion uses `spring()` or eased `interpolate()`; nothing linear or jittery. Scene transitions are soft (fade, slide, or the cat carrying the next scene in).
- **Mascot "Catalyst" the orange cat already exists: use it, don't redraw it.** Import `assets/cat/Cat.tsx` (plain React, no dependencies) and pass `t={frame / fps}` so its idle loop (float, blink, tail sway, ear twitch) runs. Props: `expression` (happy | curious | surprised | proud | shrug), `pose` (float | hold | point | wave | shrug | stamp), `size`, `lookAt`. Move it around with a wrapper `<div>` (position, scale, rotation via `spring()`). Open `assets/cat/preview.html` to see every expression and pose. Keep its look consistent; small additions (a prop held in a paw, a speech bubble) are fine. The cat never covers the captions or key UI.
- **Logo:** `assets/logo/catalyst-logo.svg` (cat ears on the C), `catalyst-logo-on-dark.svg`, `catalyst-mark.svg`. Use these for the title and outro.
- The app UI is shown as a simplified, friendly mock: rounded cards, soft shadows, the colours above. Numbers in the UI are illustrative; make them plausible and consistent across scenes.
- Microscope views are **drawn illustrations**: dark background, grey flattened ellipses (graphite), small bright dots (silicon), black gaps (pores). Never real images.

## Narration (use this text exactly)

Scene 1, Hook:
"Meet Catalyst. Battery makers spend around fifty thousand pounds on microscope images of their materials. And one question matters: is this delivery the material we were promised?"

Scene 2, The science:
"Inside a battery's anode, grey graphite flakes store the lithium. Tiny bright silicon specks store ten times more, but they swell up every charge. Black pores let the lithium flow. Change the recipe, and the battery changes too."

Scene 3, Main feature, Sort:
"So drop in a new image. Catalyst colours every pixel, measures the silicon, the particles and the pores, and tells you which known batch it looks like, how sure it is, and why, in words a scientist can check."

Scene 4, Compare:
"Compare any batch with the promised baseline. Every measurement sits on the baseline's normal range, so you see at a glance what moved, and by how much."

Scene 5, Verdict:
"Then a verdict: accept, investigate or reject. And when the data can't settle it, Catalyst says so, and tells you how many more images you need."

Scene 6, Trust:
"Every result carries a fingerprint of its inputs, and our rules were frozen before the test images arrived. No tuning after the fact."

Scene 7, Outro:
"Catalyst. Know your material before it goes into a car. Built by Team Batch Size 2."

## Storyboard

| # | Visual | Catalyst the cat |
|---|---|---|
| 1 | The Catalyst logo forms from bouncing particles, and its ears wiggle. A small stack of £ coins next to a microscope icon, then a big question mark over a delivery box | Floats in from the left, waves, pulls goggles down on "one question" |
| 2 | Zoom into a cartoon battery, then into the anode illustration. Labels pop in one by one as they're spoken: graphite, silicon, pores. One silicon dot inflates ~1.5× on "swell up" | Curious; pokes the silicon dot, startled when it inflates |
| 3 | App window. An image card drops into a drop zone, pixels get coloured (grey/orange/blue sweep), three probability bars fill (Batch 1 wins, amber), then 2–3 reason chips appear, e.g. "silicon more clumped than baseline" | Carries the image card in and drops it, points at the winning bar, proud |
| 4 | Three rows, one per measurement: a teal band for the baseline's normal range, small dots for known images in batch colours, a white star for the new image sliding into place. One row shows the star clearly outside the band | Hops along the rows like stepping stones, surprised at the outlier |
| 5 | Traffic light cycles green, amber, red, then rests on amber. A card: "Unclear: image 4 more fields to decide" with a small range bar straddling a tolerance zone | Shrugs on "can't settle it", then thumbs-up |
| 6 | A document with a scrolling hash string; a "rules frozen" tag with a timestamp; a sealed envelope | Stamps the envelope with a paw print |
| 7 | The Catalyst logo, subtitle "batch QC for battery materials", "Team Batch Size 2" | Curls up next to the logo, slow blink, happy |

## Audio and subtitles

1. Read `ELEVENLABS_API_KEY` (and optional `ELEVENLABS_VOICE_ID`) from the environment. If no voice ID is set, list voices with `GET /v1/voices` and pick a warm, friendly, clear English voice; record which one in the README.
2. For each scene, call `POST /v1/text-to-speech/{voice_id}/with-timestamps` (model `eleven_multilingual_v2`). Save `demo_video/public/audio/sceneN.mp3` and the alignment JSON.
3. Turn the character timings into word timings, then into captions: bottom centre, max 2 lines, about 6–8 words per page, the current word highlighted. Also export `out/captions.srt`.
4. Each scene's length = its narration length + 0.6 s of padding. Time the animations to the words (e.g. the "silicon" label pops in when "silicon" is spoken).
5. Check the total is ≤ 120 s. If it's longer, tighten padding first, then speed up the speech slightly (≤ 1.1×). Never cut narration text.
6. If the API key is missing or calls fail, don't stop: estimate timings at 2.4 words per second, render with captions only, and say so clearly in the README.

## Quality loop (required)

- After building each scene, render stills with `npx remotion still` at its start, middle and end, and look at them. Fix: overlapping elements, text outside a 5% safe margin, the cat covering captions or UI, inconsistent cat size, unreadable text, empty-looking frames.
- After the full render, verify the duration with `ffprobe`, extract one frame every 5 s into `out/contact_sheet.png`, review it, and fix anything off. Do at most two full polish passes.
- The final pass should feel smooth and calm: no element appears without an entrance, nothing pops jarringly, and the cat is always alive (idle animation).

## Deliverables

- `demo_video/` Remotion project with one component per scene plus `Captions.tsx` and a shared `theme.ts`. Import the cat from `../assets/cat/Cat.tsx` (copy it into the project only if the bundler can't import outside its root, and keep the copy identical).
- `demo_video/out/catalyst.mp4` (H.264, 1080p), `demo_video/out/captions.srt`, `demo_video/out/contact_sheet.png`.
- `demo_video/README.md`: how to preview (`npx remotion studio`), re-render, change the narration, and which voice was used.
- Commit on branch `demo-video/explainer` (do not merge). Don't commit `node_modules/` or `out/` except the three files above. Don't commit `.env` or the API key.
