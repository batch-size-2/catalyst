# Handoff: Catalyst demo video

For the next agent picking this up. Read this first, then `review/PHASE1_REPORT.md` (Devin's detailed build notes) and `PROMPT.md` (the full brief).

## Goal

A **≤ 2-minute animated demo video** for the Catalyst hackathon submission (Polaron track, team "Batch Size 2"). It has a dark look that matches the app, the real app shown inside a macOS-style browser window, a mascot cat (orange tabby in a lab coat) floating in the margins and pointing into the app, a voiceover by the cat in the first person, subtitles the whole way through, subtle sound effects and quiet background music. It's built in **Remotion** (React → MP4, fully local).

## Where things are

- **Worktree:** `/Users/mac/hackaton/catalyst-demo` (a git worktree of `batch-size-2/catalyst`). **Branch:** `demo-video/explainer`.
- **Commits:**
  - `9588885`: groundwork (brief, narration, voice, sounds, background plates, style frames, tools). Pushed.
  - `411d283`: Compare before Identify, voice at 1.15×, a tighter Devin prompt. Pushed.
  - `28d5fcb`: the Remotion animatic (built by Devin) plus the lab-coat cat. Pushed.
  - Then: the v3 script voiced (10 scenes; `lab`/`aged` split for the charge animation; `gap_seconds` 0.3), the GENERATE LAWSUIT sfx cue, and `DEVIN_PHASE2.md` (**the current brief: Phase 2, polish with real app capture**). `origin/main` was merged in so the worktree runs the latest app (impact, anode lab, lawsuit button).
- **Current render:** `out/animatic.mp4` (87.6 s, 1080p30, H.264 + AAC; gitignored). Devin's pre-tweak version is `out/animatic_devin.mp4`. Subtitles are in `out/captions.srt`.

| Path | What |
|---|---|
| `PROMPT.md` | The full brief: look, cat rules, data-driven engine, storyboard, quality loop. Phase 1 (animatic) is done; Phase 2 (real captures and the screenshot camera) is not |
| `DEVIN_PHASE1.md` | The safety-scoped prompt Devin ran with (a template for the next Devin run) |
| `narration.json` | **The script.** 7 scenes, voice id and settings (speed 1.15). Edit the text here, then re-voice |
| `script.json` | Beats per scene (keyed to spoken words), cat moves, callouts, sfx cues, the music file and level, the per-scene `lead`/`hold` |
| `standins.json` | Phase-1 hand-measured highlight boxes on the stand-in screenshots (replace with a capture `manifest.json` in Phase 2) |
| `src/` | Remotion code: `core.ts` (timing engine), `state.ts` (pure layout per frame), `Animatic.tsx`, `Background.tsx`, `BrowserWindow.tsx`, `Screen.tsx`, `Captions.tsx`, `CatActor.tsx`, `scenes/*` |
| `public/audio/` | The narration MP3s and per-word timings (from `tools/voice.py`) |
| `public/sfx/` | drop, done, click, whoosh, stamp, mrrp (from `tools/sfx.py` and `sfx.json`) |
| `public/music/` | `bed_v2_soft.mp3` (in use) and `bed_soft.mp3`: 30 s ElevenLabs sound-effect loops looped to 120 s, EQ'd away from speech, loudnorm −30 LUFS |
| `public/bg/` | Background plates built from the app's real segmentation overlays (`tools/make_backgrounds.py`; needs the local data in `out/masks/`) |
| `public/standins/` | Copies of `docs/screenshots/*.png` used as placeholder app footage |
| `review/` | `style/*.jpg` (the target look), `contact_sheet.png`, `PHASE1_REPORT.md`, `PROGRESS.md` |
| `../assets/cat/Cat.tsx` | The mascot. A new opt-in `outfit="labcoat"` prop (coat, sleeves, pens, badge, graphite strap); `CatActor` passes it. The default cat is unchanged (the web app doesn't use this file) |

## How to run

The system `node` (Homebrew 19) is **broken** (missing ICU), so use Homebrew's node@22. From `demo_video/`:

```bash
export PATH=/opt/homebrew/opt/node@22/bin:$PATH npm_config_cache=$PWD/.cache/npm TMPDIR=$PWD/.cache/tmp XDG_CACHE_HOME=$PWD/.cache REMOTION_DISABLE_TELEMETRY=1
npm run studio                 # live preview
npm run stills -- 24 40.5      # review stills at given seconds -> .cache/stills/
npm run animatic               # full render + SRT, ~10 min -> out/animatic.mp4
npm run sheet                  # contact sheet -> review/contact_sheet.png
npx tsc --noEmit -p .          # typecheck
```

- Remotion is pinned to **4.0.529**. Install with `npm install --before=<a week ago>` (a repo rule).
- This ffmpeg has **no `drawtext`**, so label frames with PIL (`uv run python` from the repo root) or Remotion.
- To review cheaply, tile frames: `ffmpeg -ss 2 -i out/animatic.mp4 -vf "fps=1/4,scale=384:216,tile=5x5" -frames:v 1 sheet.jpg`.

## Audio pipeline (keys never in the repo)

- `python3 demo_video/tools/voice.py` (run from the repo root) re-voices only the scenes whose text or settings changed, writes `public/audio/<id>.{mp3,json}` and builds `out/voice_preview.mp3`.
- `tools/sfx.py` regenerates the sound effects.
- The ElevenLabs key comes from `ELEVENLABS_API_KEY` in the environment, or a gitignored `demo_video/.env`. **Ask the user for it, pass it to the one command, and never write it into tracked files.**
- What the key's plan supports: TTS and sound-effects work. **The Music API is paid-plan only, and the user doesn't want extra spend**, so make music with sound-generation loops. Voice listing is not permitted, so get voice IDs from the user.
- Voice: `awmINsgxT6tx4sTpVomM`, model `eleven_multilingual_v2`, speed 1.15 (the user wanted it a bit faster).

## Decisions already made (don't re-litigate)

- **Look:** dark lab bench, matching the app (`design/README.md`, `design/tokens.css`), with Geist and Geist Mono. The dimmed coloured micrograph is the background, and the app floats on it in a macOS window. The cat lives in the margins and points into the app with a stick; it never blocks the content.
- **Hook:** real battery recalls, not the old "£50k on microscope images" line. These are stated as facts with a source line, not fake BBC screenshots (no logos):
  - GM recalled every Chevy Bolt (2021); faulty LG cells; LG reimbursed up to $1.9bn (CNBC, NBC).
  - Hyundai replaced the batteries in about 82,000 EVs, about £640m (BBC News, 24 Feb 2021, https://www.bbc.co.uk/news/technology-56156801).
  - An optional card with no narration: Samsung Note 7, battery faults, about $17bn in lost sales (BBC business-38714461, NBC).
  - **Honesty point:** these were cell-manufacturing defects, so never claim Catalyst would have caught them. The pitch is "check the earliest link: the material".
- **Order:** News → Science → **Compare** (delivery vs promised baseline; the commercially important feature, so first) → **Identify** (which batch a tile looks like; the hackathon's set task, so it must be shown) → Inspect → Audit → Outro.
- **Narration:** the cat speaks in the first person, plainly; no "AI-slop" phrasing. Current lines are in `narration.json`.
- **The "rules frozen" claim was dropped:** the app shows "Rules not frozen yet". Only add it back if the team actually freezes the rules (the `rules-frozen` git tag).
- **Sound:** sfx stay subtle (one or two per scene). `mrrp` plays once on the cat's entrance; a second soft one at the outro is optional. Music sits about 21 dB under the voice.

## Next steps (Phase 2 and polish)

1. **Real app footage.**
   - Build `capture/capture.mjs` and `shots.json` (spec in `PROMPT.md` → "Data-driven pieces"). Capture with Playwright at 1400×780 @2x: opaque and transparent ("glass") PNGs, plus `manifest.json` with highlight boxes and click targets. Then switch `Screen.tsx` from `standins.json` to the manifest.
   - **The UI has changed since the shot list was written**: check `web/src/router.ts` and `web/src/components/*`. The app now has Identify tile / Compare batch / Library / Audit log, and maybe more (another session is redesigning the UI).
   - The user captures on the **real data** locally; the screenshots are allowed in git (AGENTS.md).
2. **Screenshot camera (milestone 4):** a spotlight plus a self-drawing orange outline on the active highlight, and the cursor clicking the four "Explain it to…" tabs, the Segmentation switch and "Verify everything". This is Devin's top suggestion and the biggest legibility gain.
3. **Polish noted in review:**
   - At about 19–21 s the dive through the cell is dark for about 1.5 s before the bright micrograph. Consider revealing it on "anode".
   - The Hyundai card slightly overlaps the Bolt card's last line.
   - The window drifts a bit off-centre during camera moves.
   - The cat's `thinking`/`focused` expressions and `goggles: "down"` don't exist yet (they fall back to `curious`).
4. **Script questions for the user:**
   - The four audiences in Compare go by fast.
   - Audit is the shortest scene (about 6 s).
   - Total length is 1:28, so there's room (≤ 2:00) to give the app scenes more time.

## Working with this user

- **Claude usage is limited; Devin credits are plentiful.** Write tight briefs, delegate heavy building to the **Devin CLI** (`~/.local/bin/devin`, model `claude-opus-5-5-high`), and review via contact sheets and stills rather than reading code. Never spend extra paid credits (ElevenLabs Music, overage) without asking.
- **Claude Code's auto-mode classifier blocks Claude from launching Devin unattended** with auto-approve. The user runs it **in the foreground of their own terminal**. Working pattern:
  ```bash
  cd ~/hackaton/catalyst-demo && perl -e 'alarm 18000; exec @ARGV' -- ~/.local/bin/devin -c --model claude-opus-5-5-high --permission-mode dangerous -- "<prompt: scope, safety rules, progress log>"
  ```
  - `--sandbox` forces Devin's "autonomous" mode, which rejects file writes in `-p` runs, so don't use it.
  - `-c` continues the previous Devin session; drop it for a fresh task.
  - Have Devin append milestones to `review/PROGRESS.md`, and watch that file plus `git status` and the branch from Claude with a Monitor.
- **Other Claude sessions share this machine.** The "Catalyst UI redesign" session once ran `git switch --detach origin/main` in this worktree, which removed the video's tracked files mid-run. It agreed to stop. If the branch changes unexpectedly, check `git reflog` and switch back with `git checkout demo-video/explainer`.
- **Commit and push only when asked.** Scan for the ElevenLabs key before every commit.
