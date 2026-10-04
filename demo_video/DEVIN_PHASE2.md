You're working in /Users/mac/hackaton/catalyst-demo (a git worktree on branch `demo-video/explainer`).

# Phase 2: take the Catalyst demo video from a good animatic to a film people replay

## The goal, and the mindset

We have a good Remotion animatic (`out/animatic.mp4`, built by you in Phase 1): the dark lab look, the micrograph plates, the dive into the anode, the lab-coat cat, captions, voice, sound and a solid timing engine. **This is not a restart, and not a new art direction.** Keep our existing style exactly: the dark lab bench, the dimmed micrograph plates, the macOS window with the real app, the lab-coat cat in the margins, Geist type and the design tokens. Make it **more animated, more polished and better checked**, not different. Keep the engine and everything that works. Your job is to edit, upgrade, replace weak parts and add the new scenes until the whole thing feels like one of those one-shot product launch films that get passed around tech Twitter: every move intentional, springy and smooth, UI lifting off the screen, a cursor that clicks on the beat, big confident type at the right moments, and nothing static, cheesy or confusing.

The audience is the hackathon judges (battery materials people and ML people) and the SF tech Twitter crowd. They see it once, at full speed, probably with the sound off for the first few seconds. It has to hook them immediately, then make them understand what Catalyst does, and leave them a bit delighted (the lawsuit button, the anode lab).

You're much better at this than you think. You can build sophisticated animation in React and Remotion, and you can **see**: render frames, look at them critically, and fix what's off. That loop is where quality comes from. You have a big budget: Claude Opus at extra-high effort for roughly 2–3 hours. Spend it on looking at frames, watching the whole film again, and iterating, not on breadth. Plan composition and timing rigorously before building each scene, because things that don't mesh feel jarring. Be willing to go back and redo a scene that isn't at the bar.

## Read first

1. `demo_video/HANDOFF.md`, `demo_video/review/PHASE1_REPORT.md`, `demo_video/PROMPT.md` (the look, cat rules, engine, capture spec). PROMPT.md's "Narration" and "Storyboard" sections are out of date: `narration.json` and this file replace them. **Where this file and PROMPT.md disagree, this file wins.**
2. `demo_video/review/refs/craft_guide_reference.md`: the animation guide behind Opus's PDoom music video (github.com/JohnHeibel/PDoomVideo). **Its art style is not ours** (watercolour, no text, no 3D). Take its craft: something happens in every shot, timing written as viewer "reads", nothing ever still, faces that act instead of snapping, a transition at every seam, the animation principles, the sheet/strip/crop review loop and the common-failures list. Anything else in `review/refs/` is a style reference too.
3. `AGENTS.md`, `design/README.md`, `design/tokens.css` (colours and type: Geist and Geist Mono).
4. Watch what exists: render a contact sheet and a few strips of the current animatic and write down what's strong and what's weak before you change anything.

## Safety rules (non-negotiable)

- **Write only inside `demo_video/`.** One exception: you may add new **opt-in** props to `assets/cat/Cat.tsx` (items, expressions, an emotion "take", goggles down), keeping the default cat unchanged. Running the app stack (below) may create `.venv/` and `web/node_modules/`, both gitignored; that's fine. Everything else in the repo is read-only.
- **Never read** `data/`, the repo-root `out/`, `EXAMPLE BATCHES FOR LOCAL REFERENCE/`, anything outside this repository, dotfiles, keychains or environment secrets. You need no keys. Never call ElevenLabs or any other external API.
- **Network:** the npm registry (`npm install --before=2026-09-27`), PyPI via `uv sync`, Remotion's own headless browser download, and **the Catalyst app on localhost** (`APP_URL=http://localhost:5174`, API on `:8001`, both started by you). Nothing else.
- **Starting the app (a subagent's job).** This worktree has the latest app code, and the real data is already in place in `data/` and `out/` (gitignored). **Ports 8000 and 5173 may be serving an older app from another workspace: never use them, and never stop them.**
  - From the repo root, start the API with `uv sync --frozen && nohup .venv/bin/uvicorn qc.api:app --port 8001 > demo_video/.cache/api.log 2>&1 &`.
  - Start the web app with `cd web && npm ci && CATALYST_API=http://localhost:8001 nohup npm run dev -- --port 5174 > ../demo_video/.cache/web.log 2>&1 &` (node@22 on the PATH as below).
  - Use `npm ci` and `--frozen`, never plain `npm install` or `uv sync`, so the tracked lockfiles don't change.
  - Use `APP_URL=http://localhost:5174`. Before capturing, `GET http://localhost:8001/openapi.json` must list `/api/impact/{batch}` and `/api/slab/{batch}`.
  - Kill only the processes you started.

  The app reads the data; you don't read it directly. The app's own caches under `out/` are fine. In this brief, `out/` always means `demo_video/out/`, except here. For Playwright, install `playwright-core` locally and launch the installed Google Chrome (`channel: "chrome"`) or Remotion's headless shell.
- **The live app runs on our real data. Look, don't change.** Allowed: navigating, scrolling, tabs, switches, sliders, the anode lab's controls, Verify buttons (they only re-hash), and the Audit page's **GENERATE LAWSUIT** button (a client-side parody; confirm in the network log that it sends no writes, otherwise skip it). **Never** start a run, measurement or upload, press "Ask Claude" (a paid call), or change settings or the baseline. Don't mock or fake API responses: what's on screen is what the app really shows.
  - **Hidden writes to avoid:** opening an Identify result whose tile has no measurements auto-POSTs `/api/measure`, so open only rows whose tile already has KPIs (check `GET /api/tiles`). The Compare baseline picker runs a comparison immediately. Never use it, "Compare now", Settings or Print.
  - **Seatbelt:** in Playwright, add a `page.route` that aborts every non-GET request except `POST /api/verify/*`, and logs each blocked call. That blocks writes; it isn't mocking.
  - Playwright's `channel: "chrome"` runs with a temporary profile. Never use the user's Chrome profile, and never run `npx playwright install`.
- **No git commands that change anything** (commit, push, checkout, switch, reset, stash, rebase, merge, branch, clean, config). Read-only git is fine. We commit.
- **The voice is final:** never run `tools/voice.py`, never edit `narration.json`'s text or voice settings, never cut narration. `public/audio/`, `public/sfx/`, `public/music/` and `tools/` are read-only.
- No `sudo`, global installs or edits outside the repo. Caches and temp files go in `demo_video/.cache/`.
- If something needs a rule broken, don't: note it in the report and carry on.

Environment (the system node is broken), from `demo_video/`:
`export PATH=/opt/homebrew/opt/node@22/bin:$PATH npm_config_cache=$PWD/.cache/npm TMPDIR=$PWD/.cache/tmp XDG_CACHE_HOME=$PWD/.cache REMOTION_DISABLE_TELEMETRY=1`

## What changed since Phase 1 (facts)

- **New narration, already voiced** (`narration.json` + `public/audio/<id>.{mp3,json}` with word timings). Ten scenes, in order: `news, science, compare, identify, inspect, audit, impact, lab, aged, outro`. `impact`, `lab` and `aged` are new. Every scene except `news` has new words, so **re-key the beats in `script.json`**: keep beats whose idea still fits, delete those whose words are gone, and add the new scenes. `voice.gap_seconds` is 0.3.
- **Hard time cap: total ≤ 119.5 s; aim for 116–118 s.** Narration plus gaps is 108.5 s, which leaves about 9 s of lead and hold across the whole film. Use these holds, checked against the real audio durations, for about **118.5 s** in total: news lead 0.6 and hold 0.4; science 0.3; compare 1.0 (so the Manager tab can be read); identify 0.4; inspect 0.4; audit 3.4 (the lawsuit gag); impact 0; lab 1.3 (the charge animation plays between `lab` and `aged`); aged 0.6 ("cracked" lands late in a 3 s line); outro 1.6. Check with `ffprobe` after every full render.
- **The real app now has everything the script mentions.** Routes:
  - `#/compare/<batch>[/<baseline>]`
  - `#/identify`
  - `#/library/<batch>/<image_id>` (segmentation with silicon and pore layers)
  - `#/audit` (decision log, batch passport, Verify, and the GENERATE LAWSUIT "Recall mode" card, which runs a fake checklist and ends on a "READY FOR COUNSEL" card)
  - `#/impact/<batch>/<baseline>` (experimental Wear & impact; `?warnings=cards|banner|ladder` picks how worst cases are drawn)
  - `#/anode` (experimental 3D anode lab: a rotatable block with state-of-charge, C-rate, cycles and FIB-slice controls)

  Read `web/src/router.ts`, `web/src/components/*` and `web/src/slab/*` (read-only) for labels and ARIA. The UI is still being polished, so locate everything by visible text and ARIA, never by pixel position. We'll re-run your capture when the UI settles.
- **A meow for the ending:** `public/sfx/meow.mp3` (mix 0.09) plays once in the outro hold as the cat blinks. Keep `mrrp` once on the cat's first entrance. No other cat sounds.
- **The lawsuit sound is wired:** `public/sfx/lawsuit.mp3` (2.08 s, mix 1.0) fires 0.75 s after the start of the word "button" in `audit`, about 10.78 s into the scene. The cursor's press frame must be exactly that frame. The separate click sfx on it has been removed.
- **News: a generic "BREAKING NEWS" treatment in our own style.** Build on the current fact cards in `script.json`:
  - a bold **BREAKING NEWS** banner or ticker (generic news-broadcast energy, no real outlet's name, logo or look);
  - big headline type for each story, with the year shown, e.g. "BREAKING NEWS · 2021";
  - keep the `$1.9 billion` count-up, which we love;
  - credits go **small, at the bottom**, e.g. "Sources: CNBC, NBC News (2021); BBC News, 24 Feb 2021". Credits are text only; never show a logo.

## Creative direction

**The hook (0–5 s) decides everything.** Big, confident motion type, plus the news cards, plus a camera that's already moving on frame 1. For example: a BREAKING NEWS banner slams in, the Bolt card slides in tilted in 3D, the camera pushes into the headline, and "GM RECALLED EVERY CHEVY BOLT" lands word by word, in spoken order, as huge Geist type on the empty side of the frame. `$1.9 BILLION` counts up big. Make a viewer with the sound off want to keep watching.

**Text as a motion-graphics layer, with variance.** Text holds attention. Most of the time the narration shows as clean subtitles (the current `Captions.tsx`, refined). At 6–8 **hero moments**, the line, or its key phrase, becomes big kinetic type composed into the shot, and the subtitle steps aside. Compose those shots for it: the window shifts to one side and the type owns the clean side. Candidates:
- the hook: "every Chevy Bolt", "$1.9 billion", "82,000 cars"
- "start a fire"
- "investigate"
- "unfamiliar"
- "eight hundred cycles"
- "Catalyst" in the outro

Choose the strongest and keep the type in our design system (Geist, the token colours, the orange accent sparingly). Never add labels that just repeat what's being said in smaller text.

**The camera system** (the biggest gain; PROMPT.md milestone 4, raised). `Screen.tsx` reads the capture manifest, falling back to `standins.json`, then to a placeholder card. Build one consistent motion language:
- **Spring camera:** one shared spring config, no linear moves. Pans and zooms land on manifest boxes. Add a subtle perspective tilt (≤ 8°) while travelling, settling flat for reading. `@remotion/motion-blur` on fast travel only; crisp at rest.
- **Spotlight:** dim the rest of the window, with a self-drawing orange outline around the active element.
- **2.5D lift:** crop the active element from the 2x capture and lift it toward the camera (scale 1.04–1.08, deep soft shadow, slight parallax) while the page dims. Use it for the verdict, the investigate pill, the identify result, a hash row, the lawsuit card and an impact card.
- **Cursor:** macOS pointer on curved paths with a slight overshoot. It arrives 0.15–0.25 s before its word, presses (scale 0.9) and leaves an orange ripple. Each click cross-fades `@state` shots or starts a clip.
- **In-app navigation:** the cursor clicks the sidebar, the content changes, and the window stays put. It's one app.
- **Finish:** a light sweep across the glass when the window first enters, a soft vignette, very faint film grain (≤ 3%). Captions never cover the active element. Keep a 5% safe margin.

**Circle and zoom is our signature move.** We love "ring a thing, then zoom into it": the app's own region peek (ring plus magnified crop) and our camera's self-drawing outline plus push-in. Use it at least in inspect (the region peek, required), and wherever the narration points at something small.

**Real motion from the real app.** Some moments must move: the 3D anode charging until lithium plates, the anode aging to 800 cycles until the silicon cracks, the lawsuit checklist running, Verify ticking, the segmentation layers switching on. Capture them as clips from the live app. Ideally record deterministically: Playwright `page.clock` (fake timers including requestAnimationFrame) stepped frame by frame with a screenshot each frame, CSS animations seeked via `document.getAnimations()`, then encoded with ffmpeg. Fall back to a CDP screencast. Save to `public/clips/<name>.mp4` (H.264, CRF ≤ 18, 2x, ≤ 25 MB each). Where a capture can't give you the motion, animate it in Remotion over the real screenshots, but never invent data.

**One world, with a gentle colour arc, all within our existing palette and plates:**
- **news:** cold and grey
- **science:** the micrograph's grey, orange and blue, ending in a fire-orange glow
- **compare to audit:** the dark lab with an orange accent
- **impact, lab, aged:** a slightly cooler tint on the background plate, with an `EXPERIMENTAL` chip
- **outro:** back to the warm coloured micrograph

Rhyme the ending with the opening.

**The cat acts.** Every expression change gets anticipation: a blink or squint, a small squash "take", sometimes an emote mark (!, sweat drop, sparkle), then the new face. Add that once and use it everywhere. Overlapping action: the head leads, the body and tail follow, the coat settles last. It reacts to what happens (the fire, the lawsuit, the cracked silicon) and points into the app, never covering it.

**Honesty stays.** Real app footage and real numbers only. Credit the sources. The experiments are introduced as experiments.

## Storyboard (a starting point: improve it in your plan)

| Scene | What happens | Cat |
|---|---|---|
| **news** | The hook (above). Dark, dim plate. A BREAKING NEWS banner or ticker first. Then the news cards fly in as tilted glass cards stacked in depth; the camera pushes into each headline; an orange marker sweep on the key phrase. "GM": Bolt. "billion": `$1.9 BILLION` counts up big. "Hyundai": the Hyundai card lands on top, "82,000" big. Note 7 optional, behind, no narration. Fix Phase 1's card overlap | Off screen |
| **science** | "I'm Catalyst": the cards slide away, the mark draws in, and the dive goes car → pack → cell → anode. Reveal the bright micrograph on "anode" (fixes Phase 1's 1.5 s dark gap). "Grey", "Orange", "swells", "Blue": the phase reveals and the swell inset. **New:** "plate out as metal": silver lithium needles grow from the top (self-drawing SVG). "short": a sharp arc flash (2–3 bright frames). "fire": warm ember glow from below, a few rising sparks, big "FIRE" type optional, then it burns down to dark as the window rises. Tasteful, not cartoonish | Waves on "I'm Catalyst"; magnifier; startled on "swells"; ears back and eyes wide on "fire" |
| **compare** | The window rises on `#/compare/<batch>`. "promised": the baseline. "row": the camera glides down the "what moved" rows, top row spotlit. "investigate": the verdict pill lifts off in 2.5D (hero type). "held": the next step. "tabs … operator to manager": the cursor clicks all four explain tabs in rhythm and the text cross-fades | Pointer; small shrug on "investigate" |
| **identify** | The cursor clicks Identify in the sidebar. "single image": the cat tosses a tile card onto the drop zone. "closest": the real result card lifts out; the bars grow. "sure": spotlight the confidence. "unfamiliar": the unfamiliar flag (hero type) | Carries the tile; proud, then surprised |
| **inspect** | **Must include the app's region peek** (a favourite; see `design/canvas/Identify-Result-Peek.dc.html` and `design/README.md`). On "check my work": the cursor hovers a region of the result tile, the real ring draws around it, and the magnified peek pops out beside it (lift it in 2.5D and push the camera in). "Open any image": click to pin it, so the inspector or the library viewer opens (shared-element zoom). "overlay": the cursor flips the segmentation or silicon layer; grey cross-fades to silicon. "pores": pore layer on. Push close enough to see pixels. Capture the hover and pinned states as `@state` shots, or as a clip if the ring animates | Goggles down, magnifier |
| **audit** | "fingerprint": a hash row lifts and the hash types itself. "verify": the cursor clicks Verify and ticks run down. "one more button": the camera pushes to the pulsing red GENERATE LAWSUIT button. The click lands exactly on the sfx, then a 2-frame shake, the real checklist clip (sped up if needed) and the "READY FOR COUNSEL" card lands. "Parody, not legal advice" stays readable. About 0.5 s to let it land | Tiny gavel or stamp (new opt-in item); smug |
| **impact** | "experiments": the `EXPERIMENTAL` chip; the plate shifts to lab mode; the cursor clicks Experimental → Wear & impact. "capacity", "charge": the camera moves card to card. "worst case": the chain draws itself step by step (ladder view if it reads best). "rule it out": spotlight what rules it out | Goggles up, thoughtful |
| **lab** | "3D anode": the cursor opens the anode lab; the block rotates slowly (clip). "too fast": the cursor sets a high C-rate and presses charge; the fast-charge clip plays. "metal": plating visible; push in. **Hold** while it grows | Goggles down, leaning in |
| **aged** | "eight hundred cycles": the cursor drags cycles to 800 and the aging clip plays (hero type "800 CYCLES"). "cracked": push in on the cracked silicon | Wince |
| **outro** | The window scales down and fades and the coloured plate returns. Wordmark and subtitle, then "Team Batch Size 2". Rhymes with the opening | Curls up by the logo, slow blink, then a soft **meow** (`public/sfx/meow.mp3`, wired 0.9 s after the last word; time it to the blink, in the hold, never over the voice) |

## Pre-flight facts and corrections (these override the storyboard and PROMPT.md where they differ)

These come from a review of the current UI code. **The UI is still changing, and the Compare screen is being redesigned for two batches.** Re-check labels in `web/src` when you run, and map to whatever is there.

**PROMPT.md instructions that are void:**
- committing, pushing or opening a PR;
- adding `data-demo` attributes in `web/`;
- regenerating assets in `assets/cat`;
- developing against fixtures by copying `tests/fixtures` into `out/` (**never do that: it would overwrite the real data**);
- `@remotion/google-fonts`;
- `.glass.png` captures (opaque only);
- "at most two polish passes" (do at least two);
- cat callouts that repeat the narration (remove them).

When the window shifts aside for hero type, the cat moves to the free margin. Captions keep inside the 5% safe margin. "Calm" means confident, not timid: small springy overshoots on the cursor and lifts are wanted. The old `out/animatic.mp4` has the old narration; use it as a visual reference only.

**Per scene:**
- **news:** the hero type follows the spoken order ("GM recalled every Chevy Bolt"). 82,000 is spoken "eighty-two" (beat `at: "eighty-two"`). Start the `$1.9 billion` count-up on "nearly" so it lands on "billion". Illustrative art with no numbers (cars, cells, needles, fire) is fine. Data shown as data must be real.
- **compare:**
  - The verdict is `section[aria-label="Answer"]` and the next step is `section[aria-label="Next steps"]`.
  - "What moved" is `section[aria-label="Look here first"]` (three finding cards). The per-property rows are in the collapsed "All N properties" fold.
  - The explain tabs are in a collapsed fold, "Explain it to an operator, engineer, scientist or manager", near the bottom. The tabs are `role="tab"`: Operator, Process engineer, Materials scientist, Manager.
  - Open the fold on "tabs". Spread the four clicks evenly from "explain" to "manager", with Manager landing on "manager". Hold for reading.
  - Use a batch whose verdict is INVESTIGATE (`GET /api/batches`); never hard-code batch names or image ids.
- **identify:**
  - The sidebar link is "Identify tile". The result is `section[aria-label="Answer"]`, with an "Unfamiliar tile" or "Familiar tile" chip. The bars are static in the app; animate them in Remotion.
  - Uploading is forbidden, so there's no live "analyzing" state. Drop that beat, or animate the drop over the empty state.
  - If no tile in the data is unfamiliar, spotlight the real chip in its real state, or an "unfamiliar" flag in Recent identifications if one exists. Never fake it.
- **inspect (the region peek):** it lives on the **Identify result** page, so it continues straight on from identify.
  - Numbered spots have aria-labels "Silicon particle N, …". Hover shows a `role="tooltip"` popover (ring, magnified crop, zoom factor, scale bar). It's `position: fixed` and ignores the pointer, so capture **viewport** frames, not full-page.
  - Click pins `aside[aria-label="Region inspector"]`, which has `role="switch"` "Silicon" and "Pore". They're disabled unless the tile has layers, so pick a tile that does.
  - Beats: hover on "check my work", pin on "Open any image", Silicon on "silicon", Pore on "pores".
- **audit:**
  - Select the INVESTIGATE row first: the passport and the lawsuit card follow the selected row. Replace the stand-in `audit.hash` in `script.json` with the real passport text.
  - Verify sets all its ✓ marks at once. Stagger them in Remotion over the real states.
  - The lawsuit button (`section[aria-label="Generate lawsuit"]`) pulses only while running, so add an idle pulse in Remotion.
  - The real checklist takes about 5 s to reach "READY FOR COUNSEL*". Play it about 2× so the final card is readable for at least 1 s before the scene ends.
- **impact:**
  - `?warnings=` goes **before** the hash (`/?warnings=ladder#/impact/<batch>/<baseline>`). It persists in localStorage; the default is cards.
  - "What rules it out" shows only when a chain is open (the ladder opens the worst one).
- **lab / aged:**
  - The controls are a button "Charge at 1.0C" (it becomes "Pause") and sliders "State of charge", "Charge rate" (log scale 0.25–8C) and "Ageing (cycles)". The ageing slider can't land on exactly 800.
  - URL params `?soc=&c=&cycles=` set states deterministically: use `cycles=800` for the end state.
  - There's no auto-rotate, so rotate with a scripted mouse drag.
  - A charge at 8C takes about 3 s. "Silicon cracked / lost contact" is inside the collapsed "All measurements" fold.
- **outro:** the meow plays in the hold after the last word **ends**, timed to the blink.

**If a live state is missing** (no unfamiliar tile, a verdict that isn't INVESTIGATE, no layers): show the nearest real state, note it in the report, and never fake it.

**Capture feasibility and freeze:**
- Time-box any deterministic-capture spike to 30 minutes.
- For the lab and aged clips, the simplest reliable method is to set the slider or URL state per frame and screenshot, with no fake clock. The fallback ladder is `page.clock` plus `getAnimations()`, then a CDP screencast, then stills animated in Remotion.
- 2x full-page screenshots over about 6,000 CSS px can hit Chrome's 16,384 px limit, so capture per section.
- Clips: ≤ 6 s, 30 fps, `-crf 18 -g 15 -pix_fmt yuv420p -movflags +faststart`.
- **Freeze `public/screens` and `public/clips` about 45 minutes in**, and re-capture only to fix bugs. We'll re-run the capture when the UI is final.

**Render budget:**
- `@remotion/motion-blur` isn't installed. Install it pinned to 4.0.529, and use it only on sub-second travel with ≤ 5 samples.
- Iterate with partial renders (`--frames=a-b --scale=0.5`). At most 5 full renders.
- Checkpoints, logged in PROGRESS: about T+1h, the first full render; T+2h, the first review pass done; T+2h40, freeze and the final render.

## How to work

1. **Plan before you change things.** Write `review/PLAN_V2.md`:
   - what you keep from Phase 1, and what you change and why;
   - a shot list: time range, narration words, the **reads** in order (what the viewer must understand, each with enough time), camera, cat, hero type yes or no, and the transition **out** of each shot;
   - which moments are captured clips.

   Then build from it and keep it true as you go.
2. **Use subagents where they help.** For example:
   - one subagent starts the app stack (see Safety rules) and keeps it running;
   - one subagent builds the capture (`capture/capture.mjs`, `shots.json`, `public/screens/` + `manifest.json`, and `public/clips/`) against the live app, mapped to the current UI, and checks every shot and clip by looking at it;
   - after the shared motion system exists, subagents take whole scenes in parallel.

   You alone own the shared files (`core.ts`, `state.ts`, `Screen.tsx`, `CatActor.tsx`, `Captions.tsx`, `Animatic.tsx`, theme). Give each subagent a short guide: the motion system, these rules and how to check.
3. **Build the review tools early** (npm scripts):
   - `sheet`: first, middle and last frames of every shot, labelled.
   - `strip`: every frame of a 0.3–1.0 s moment, tiled.
   - `crop`: a full-resolution region.

   Use a strip for every click, lift, seam, cat take, the fire flash and the lawsuit hit. Use a crop for every piece of UI text the narration points at, to confirm it's readable at 1080p. Use a sheet for every shot.
4. **Check sync, not just pictures.** Every cursor click lands on its sfx frame. Every hero word appears on its spoken word (from `public/audio/*.json`). The lawsuit click frame equals the lawsuit sfx frame. Verify by computing beat frames and looking at strips around them.
5. **Keep a usable render at all times.** Render the full film after the first complete pass (`out/catalyst.mp4`), then improve. If you run out of time, the last good render is the deliverable.
6. **Second generation.** After the first full render, watch the whole film again (sheet plus strips at every seam). Critique every shot against the craft rules and the failure list below, then rewrite the weakest scenes properly. Do at least two full review-and-fix passes. Ask for every shot: is something happening, can a first-time viewer follow it, does it lead into the next one?
7. **Progress log:** after each step, append one line to `review/PROGRESS.md`: `<HH:MM> P2 <step>: <status>`. Add a line when blocked and a final `P2 DONE`.

**Failures to hunt for:**
- the window sitting still while the cat talks
- one constant brisk speed with no holds
- reads stacked on top of each other, or moments over before they're understood
- UI text the narration points at that nobody can read
- faces snapping between expressions
- linear or perfectly synchronised motion; timid moves that barely read
- hard cuts everywhere, or starting or ending on a hard frame
- the cursor teleporting or clicking beside its target
- labels repeating the captions
- each scene looking like a different video
- cheesy effects (lens flares, generic glitch, stock-looking particles)

## Deliverables

- `out/catalyst.mp4` (1920×1080, 30 fps, H.264 + AAC, ≤ 119.5 s) and `out/catalyst-720p.mp4`; `out/captions.srt`; `review/contact_sheet.png` (one frame every 4 s, labelled).
- `review/PHASE2_REPORT.md`: duration and scene timings; what's real capture and what's still a placeholder; an honest pass/fail against the failures list; the sync check; and what you'd do next.
- `demo_video/README.md` for us: start the app, `npm run capture`, check the screens, `npm run render`. Also: how to re-capture after the UI changes, and how to change a shot, a highlight, a clip, a hero-type moment or a beat.
- npm scripts: `capture`, `studio`, `stills`, `sheet`, `strip`, `crop`, `render`.
- Don't commit or open a PR; we review and commit.
