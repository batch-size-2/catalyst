You're working in /Users/mac/hackaton/catalyst-demo (a git worktree on branch `demo-video/explainer`).

Read `demo_video/PROMPT.md` in full first, then `AGENTS.md`, `design/README.md` and `design/tokens.css`. Do **Phase 1 (the animatic) only**, as described at the top of PROMPT.md, then stop. Where this file and PROMPT.md disagree, this file wins.

## Safety rules (non-negotiable)

- **Write only inside `demo_video/`.** Everything else in the repo is read-only for you. Never touch `web/`, `qc/`, `config/`, `assets/`, `docs/` or `data/`, and never read `data/`, `out/` or `EXAMPLE BATCHES FOR LOCAL REFERENCE/`.
- **Never read anything outside this repository**: no home-directory files, no dotfiles, no `/tmp` or `/private` paths, no keychains or credential stores. Never search for, print or use API keys, tokens or environment secrets. You need none: there are no keys for you, and you must not call any external API or service.
- **Network:** only `npm install` from the npm registry, and Remotion downloading its own headless browser. Nothing else: no curl or wget to other hosts, no uploads, no telemetry opt-ins.
- **No git commands that change anything** (no commit, push, checkout, switch, reset, stash, rebase, merge, branch, clean, or config). Read-only git (`status`, `diff`, `log`) is fine. We'll review and commit your work ourselves.
- **No system changes:** no `sudo`, no global installs (`npm -g`, `brew`, `pip` outside a local venv), no edits to shell profiles or anything in `~`. Install npm packages locally in `demo_video/` with `npm install --before=<date one week ago>` (repo rule). Keep caches and temp files in `demo_video/.cache/` (gitignored): in every shell, first run `export npm_config_cache=$PWD/demo_video/.cache/npm TMPDIR=$PWD/demo_video/.cache/tmp XDG_CACHE_HOME=$PWD/demo_video/.cache` (from the repo root). Your commands run in a sandbox, so writes outside this repo fail by design. Don't try to get around that.
- **Don't delete or overwrite** anything you didn't create, apart from what this brief asks you to produce.
- If something needs to break a rule above, don't do it: write it in the report and carry on with the rest.

## Scene order (changed)

Compare comes before Identify: News, Science, **Compare** (the main, commercially important feature), **Identify** (the hackathon's set task), Inspect, Audit, Outro. Follow `narration.json` and the storyboard in PROMPT.md. Phase 1 stand-ins: Compare → `docs/screenshots/compare.png`; Identify → `identify-empty.png`, then `identify-result.png`; Inspect → `viewer.png`; Audit → `audit.png`.

## Inputs that are final; don't regenerate or edit them

`demo_video/public/audio/` (narration and word timings), `demo_video/public/sfx/`, `demo_video/public/bg/`, `demo_video/review/style/`, `demo_video/narration.json`, `demo_video/sfx.json`, `demo_video/tools/`.

## How to work

- **Progress log:** after each milestone, append exactly one line to `demo_video/review/PROGRESS.md`: `<HH:MM> <milestone>: <one-line status>`. Also add a line when you're blocked, and a final `DONE` line. We read it to check on you.
- **Quality:** after each scene, render stills (`npx remotion still`) and look at them yourself. Compare them with `demo_video/review/style/*.jpg` and fix anything that looks off before moving on. Calm, smooth and cohesive beats busy.
- **When done:** make sure `demo_video/out/animatic.mp4` (1080p) and `demo_video/review/contact_sheet.png` exist. Then write `demo_video/review/PHASE1_REPORT.md` with the duration, the scene timings, what's still a placeholder, what you'd improve, and any script or timing suggestions.
