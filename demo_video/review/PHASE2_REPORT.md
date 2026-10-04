# Phase 2 report

**Output:** `out/catalyst.mp4` (1920×1080, 30 fps, H.264 CRF 18 + AAC), `out/catalyst-720p.mp4`, `out/captions.srt`, `review/contact_sheet.png` (one frame every 4 s, labelled). **Duration: timeline 118.47 s (3555 frames); first full render measured 118.55 s with ffprobe** (cap 119.5 s). Rebuild: see `demo_video/README.md` (`npm run render`, `npm run contact`).

## Scene timings (holds from the brief)

| Scene | Start | End | Length | Lead / hold |
|---|---|---|---|---|
| news | 0:00.00 | 0:14.58 | 14.58 | 0.6 / 0.4 |
| science | 0:14.58 | 0:37.75 | 23.17 | – / 0.3 |
| compare | 0:37.75 | 0:53.35 | 15.60 | – / 1.0 |
| identify | 0:53.35 | 1:03.53 | 10.17 | – / 0.4 |
| inspect | 1:03.53 | 1:11.89 | 8.36 | – / 0.4 |
| audit | 1:11.89 | 1:26.32 | 14.43 | – / 3.4 |
| impact | 1:26.32 | 1:39.34 | 13.02 | – / 0 |
| lab | 1:39.34 | 1:47.77 | 8.43 | – / 1.3 |
| aged | 1:47.77 | 1:51.64 | 3.87 | – / 0.6 |
| outro | 1:51.64 | 1:58.47 | 6.82 | – / 1.6 (0.7 s fade to black) |

## What was built (kept from Phase 1 / changed)

- **Kept:** the timing engine (`core.ts`), pure-function layers, the plate/grid/vignette stage, the macOS window, Geist type, captions, the lab-coat cat, the science dive and phase reveals.
- **New shared motion system (owned by me):** a manifest camera (scroll + zoom over a virtual 1400×780 screen with the real sidebar fixed), one spring for all travel with a slight zoom dip on long moves, window tilt from camera velocity, motion blur only on fast travel (`@remotion/motion-blur` 4.0.529, 5 samples), a moving spotlight with a self-drawing orange outline, 2.5D lifts (with a "types itself" mode), a macOS cursor on curved paths with overshoot that arrives 0.2 s early, presses on its beat frame and leaves an orange ripple (drag mode for sliders), row-by-row reveals, bar "grow" covers, window layouts for hero type, an EXPERIMENTAL chip in the title bar for the last three scenes, a light sweep on the window's first entrance, vignette and 3 % grain.
- **Hero type** (words land on their spoken word; captions skip them): GM RECALLED / EVERY / CHEVY BOLT, $1.9 BILLION (count starts on "nearly", lands on "billion"), 82,000 CARS, FIRE, INVESTIGATE, 800 CYCLES, and the outro wordmark.
- **Cat acting:** opt-in props added to `assets/cat/Cat.tsx` (default unchanged): `goggles="down"`, `blink`, `earsBack`, `headTilt`, expressions `focused`, `thinking`, `wince`, `smug`, `scared`. `CatActor` does squint → squash take → new face → emote (!, ?, sweat, sparkle) on every change, the head leads, a gavel strikes on the lawsuit hit, the arc flash lights it, a slow blink with the meow. Callouts removed.
- **Scenes by subagents** (on the shared system): News (BREAKING NEWS band slam, year roll, tilted glass cards in depth with line art, marker sweep, credits text-only at the bottom; pass 2 enlarged the cards and removed dead air), Science (mark draws then leaves, no dark gap at "anode", silver lithium needles, 3-frame arc flash, ember fire, burn-down into the window rise), Outro (rhymes with the hook: the wordmark lands in the hero slot, the banner slot carries "BATCH QC FOR BATTERY MATERIALS", team line word by word).
- **Review tools:** `npm run sheet | strip | crop | stills | words`, plus `scripts/vstrip.mjs` (strips from the last render). All images in `review/check/` (scratch; safe to delete).

## Real capture vs placeholder

Everything inside the window is **real app capture** (25 stills, 5 clips, `public/screens/manifest.json`), recorded deterministically (page clock stepped per frame) with a seatbelt that aborted every non-GET except `POST /api/verify/*` — **no blocked calls**, no runs, uploads, measurements, Claude calls or settings changes. Clips: `lawsuit` (real checklist → READY FOR COUNSEL, played 2.4×), `anode_rotate`, `anode_charge` (8C → plating), `anode_age` (0 → 800 cycles), `verify` (unused). Animated in Remotion over real states only: Verify's ticks (row-by-row wipe between the real before/after), the identify bars growing, the hash typing, the lawsuit button's idle pulse, the cat's tile toss onto the drop zone (no live upload state exists). **No placeholders remain.** Illustrative art without data: the news line art, the science dive, needles, arc, fire.

**Deviations and why (no rule broken):**
- **Ports:** 8001 and 5174 were held by other workspaces' processes; with the user's go-ahead we used free ports. The final capture uses **this worktree's `web/` on :5176 proxied to the main checkout's API on :8001**, because this worktree's own API (:8002) has no images for the saved `drop_demo` identification ("images are no longer on disk", no region-peek spots) and its Verify reports changed config. The 8001 API code differs from this worktree only in `config/kpi_dictionary.yaml`; its data has the images and its decisions verify (72/72 files, config ok). Our processes (API 8002, web 5175/5176) are recorded in `.cache/stack.json`; stop only those PIDs.
- **Identify "unfamiliar":** no tile in the data is unfamiliar, so the real "Familiar tile" chip is spotlit in its real state and the word "unfamiliar" stays a caption (no hero type, to avoid contradicting the chip).
- **Impact ladder:** `?warnings=ladder` isn't read by the current build; the default page already shows the worst-case chain on the Fast charging card, which the spotlight walks step by step.
- **Lawsuit clip:** recorded after pressing Verify (so its layout matches), with 348 px of visual bottom padding so the final scroll exists before the card grows.
- **Anode stills:** the fast-charge still is parked at 60 % charge (plating disappears at 100 %); charge/age clips were re-recorded at the rotate clip's final camera angle so the cuts don't snap.

## Sync check (computed from the timeline; frames at 30 fps)

- **Lawsuit:** `audit` "button" starts 81.92 s → press = sfx = **82.67 s, frame 2480**; the cursor press, the `lawsuit` sfx, the clip re-trigger (at its own press frame 7), the 2-frame shake and the hit ring share that one beat. The clip was frozen on its idle frame from "bad" so the camera is settled and the press frame is crisp.
- **Clicks:** every `cursor` beat carries `sfx: "click"` on the same beat, so press frame = click frame: explain fold 48.92 (f1468), Operator 49.29 (f1479), Process engineer 50.06 (f1502), Materials scientist 50.83 (f1525), **Manager 51.60 (f1548, on "manager")**, sidebar Identify 53.35, region pin 64.88, Silicon 69.07 (on "silicon"), Pore 70.39 (on "pores"), Audit 71.89, Verify 76.41 (on "verify"), Wear & impact 87.16 (on "experiments"), Anode lab 99.61, Charge 104.27. State cross-fades start 2 frames after each press. Page targets ride with the camera so presses land on their element (checked in strips: Manager, sidebar, Silicon).
- **Hero words** land on their audio word starts: GM 2.34, recalled 2.78, every 3.21, Chevy 3.68, Bolt 4.05; $ count 8.34 → billion 9.09; 82,000 11.94 → cars 12.92; FIRE 36.46; INVESTIGATE 45.97; 800 108.24 → cycles 108.77.
- **Cat sounds:** mrrp once at 14.58 (entrance); meow once at 116.92, after the last word ends (≈116.44), during the slow blink (closed 116.97–117.27).

## Pass/fail against the failure list

| Failure | Status |
|---|---|
| Window sitting still while the cat talks | Pass: every app beat moves the camera, spot, cursor or a lift; holds keep a slow drift. |
| One constant brisk speed, no holds | Mostly pass: quick moves, held reads (Manager tab ~1.7 s, READY FOR COUNSEL ~1.3 s, outro ~1.8 s). Impact is the busiest stretch. |
| Reads stacked / over before understood | Mostly pass; the 6-step ladder walk (1.1 s) is fast by design — the payoff read is "what rules it out". |
| UI text the narration points at unreadable | Pass on crops at 1080p for baseline, rows, verdict, next step, Manager text, closest/bars/chips, inspector, hash row, verify banner, counsel card, cards, cracked row. The disclaimer is small but framed with the card. |
| Faces snapping | Pass: every expression change is acted (squint/squash/take/emote). |
| Linear or perfectly synchronised motion; timid moves | Pass: springs everywhere, layers offset, small overshoots on cursor, lifts and type. |
| Hard cuts / hard first or last frame | Pass: 0.25 s fade-in under a moving band, every seam is a move, 0.7 s fade out. |
| Cursor teleporting / clicking beside target | Pass after fixing (targets ride the camera; dwell ≥ 0.45 s; travel ≤ 0.6 s). |
| Labels repeating the captions | Pass: callouts removed; hero words leave the captions. The news cards carry a short headline by design (brief asks for cards + type). |
| Each scene a different video | Pass: one stage, one motion language, colour arc cold → micrograph → fire → lab orange → cool experiments → warm outro. |
| Cheesy effects | Pass in review: no flares/glitch; FIRE type and sparks kept restrained. |

## Review passes done

1. Before the first render: per-scene sheets + strips (compare clicks, hook, seams) → fixed cursor drift during camera moves, mark never leaving, dark gap at "anode", Phase-1 mark persisting.
2. After the first full render (sheet every 2 s, frame grids at every narrated UI point, strips at seams and the lawsuit hit) → news cards enlarged and dead air removed, compare rows glide row by row, INVESTIGATE lifts the whole verdict card, hero exits clear the window's return, hash typing on the passport's paper colour, verify zoom eased, lawsuit pre-scrolled for a crisp hit and sped to 2.4× so the result card holds, card + disclaimer framed together, cursor dwell/travel retuned. Then the final render.

## What I'd do next

- Listen-through for the mix (sfx levels were kept from Phase 1; the lawsuit cue is at 1.0 as wired).
- A real "Unfamiliar tile" example would let "unfamiliar" become a hero moment.
- Animate the C-rate/ageing slider thumbs in Remotion during the drags (today the state cross-fades mid-drag).
- When the UI settles: re-run `APP_URL=… npm run capture`, check `review/check/capture/`, re-render.
