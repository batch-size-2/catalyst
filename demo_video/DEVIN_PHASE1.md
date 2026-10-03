You're working in /Users/mac/hackaton/catalyst-demo, on the local git branch `demo-video/explainer`.

Read `demo_video/PROMPT.md` in full first, then `AGENTS.md`, `design/README.md` and `design/tokens.css`. Do **Phase 1 (the animatic) only**, as described at the top of PROMPT.md, then stop.

Ground rules:
- Already made and final for now; use them, don't regenerate or edit them: narration audio and word timings (`demo_video/public/audio/`), sound effects (`demo_video/public/sfx/`), background plates (`demo_video/public/bg/`), style frames (`demo_video/review/style/`), `demo_video/narration.json`, `demo_video/sfx.json` and `demo_video/tools/`.
- Don't call any external API or service (npm installs are fine). There are no API keys for you, and you don't need any.
- Stay inside this repository: don't read or write files outside it (tool and npm caches excepted). Commit locally after each milestone; never push or touch git remotes.
- Quality: after each scene, render stills (`npx remotion still`) and look at them yourself. Compare them with `demo_video/review/style/*.jpg` and fix anything that looks off before moving on. Calm, smooth and cohesive beats busy.
- When done, make sure `demo_video/out/animatic.mp4` (1080p) and `demo_video/review/contact_sheet.png` exist. Then write `demo_video/review/PHASE1_REPORT.md`: the duration, the scene timings, what's still a placeholder, what you'd improve, and any script or timing suggestions.
