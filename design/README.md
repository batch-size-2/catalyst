# Catalyst design system

The look, the logo and the screen designs for the app. The current `web/` UI is being replaced by these designs. Live canvas (private, ask Patrik for access): <https://claude.ai/artifact/5iii2hJP5upK9V76kk6Gjb>

| Path | What |
|---|---|
| `tokens.css` | Colours, type, glass, buttons, pills, segmented control. Import it once in `web/` |
| `logo/` | The mark, wordmarks, app icon, favicon, a construction drawing, and the cat's moods |
| `canvas/` | The screen designs as `.dc.html` artboards plus `canvas.json` (layout). Image URLs (`/_blob/…`) only resolve on the live canvas; the raw TIFFs are too big for git (AGENTS.md) |

## Principles

- **A dark lab bench.** A near-black ground with a faint 32 px grid under everything. Hairline borders, generous spacing.
- **Glass floats, panels sit.** Frosted glass (`.glass`) is for anything that floats: verdicts, pickers, toolbars over images. Tables and charts sit on solid panels (`.panel`).
- **Data under glass.** Hero surfaces put the real micrograph behind a glass card, so the material is always on screen.
- **Every colour means one thing.** Orange is the cat (and silicon in images). Batches keep their colour everywhere. Verdicts always come with a word.
- **Honest by default.** Every call shows its probability, the model's held-out accuracy next to chance, and an "unfamiliar" flag. "Differs from the reference", never "defective".
- **Cat, lightly.** The mascot shows up in empty, working and sure/unsure states and in a line of microcopy. Never in the numbers.

## Information architecture

Four places, in the sidebar:

| Place | Job |
|---|---|
| **Identify tile** | Drop one tile (BSE + ETD/SE + InLens, paired by ID) → closest batch, confidence, the model's reasons, nearest known tiles, measurements against the baseline band |
| **Compare batch** | Pick a batch and a baseline (the default from Settings, or a one-off) → verdict + next steps, shift per property in baseline σ with a ±1.5σ tolerance band, every tile on the baseline band, odd tiles, explanations per audience |
| **Library** | Every tile, with the viewer: detector switch, segmentation layers (Si / pore / binder), particle inspector |
| **Audit log** | Append-only decision log, rules-frozen banner, "Verify everything", printable batch passport, the parody lawsuit button |

**Labs** (wear and impact, sample size, 3D slab) sit in the sidebar as "Soon".

## Boards

| Boards | What |
|---|---|
| `Brand` | Identity and components |
| `Main`, `Identify-Analyzing`, `Identify-Result` | v1 Identify flow: drop, analysing, result |
| `Compare`, `Viewer`, `Audit` | v1 Compare, tile viewer, audit log + passport. Implemented in #16 |
| `Compare-Focus`, `Identify-Result-Focus` | v2: the answer, "Look here first", everything else folded |
| `Settings-Baseline` | v2: default baseline, baseline tiles to leave out, who picks the highlights |
| `Compare-Guided` | v3: Claude as a guide. Summary and walkthrough over Catalyst's verdict |
| `Identify-Result-Peek` | Region peek and pin: look closer at an image region without leaving the page |

v2 and v3 are designs only. They wait until Pat's evaluation tells us which findings matter.

## Focus: where the reviewer looks first (v2)

Every analysis screen has the same four levels, top to bottom:

1. **Answer.** Verdict and one plain sentence. No code names.
2. **Caveats, pinned.** Imaging changed, unfamiliar tile, rules not frozen. Always shown, never ranked.
3. **Look here first.** At most three cards. A card = title, numbers, baseline band, the tiles behind it, why it matters, and "why it's here".
4. **Everything else, folded.** One row per section with a one-line summary.

The UI renders the top three of a ranked list the backend sends. Who ranks is a setting, so it can change without UI work: statistics (`compare()` drivers, today), Pat's feature ranking, or Claude (below).

## Baseline

- **Default** (Settings): written to `config/decision.yaml` → `baseline`, logged in the audit, locked once rules are frozen. Baseline tiles can be left out (`reference_exclude`).
- **One-off** (Compare picker): any other batch for one comparison. The default doesn't move; "Make default" links to Settings.

## Claude as a guide, not a judge (v3)

Catalyst decides; Claude points and explains. No language model measures, decides or sets the verdict (AGENTS.md).

- **In:** the evidence JSON and dictionary entries. Never images.
- **Out:** JSON, not free text: `summary` (≤3 sentences), `steps` (≤4, each targeting `verdict`, `moved`, `tiles` or `next`), and `whatifs` from a fixed menu (leave tiles out, other baseline) that Catalyst computes.
- **Numbers are slots** (`{diff:si_graphite_ratio}`, `{tile:4ih2ggld.si_graphite_ratio}`, `{whatif:1}`) that the UI renders as chips from the evidence. A slot that doesn't resolve drops its sentence; two failures fall back to the `qc/explain.py` template.
- **House style:** ≤28 words per sentence, ≤2 sentences per step. "Differs", never "defective". "Not settled" when the status is unclear. No "significant", "crucial" or "notable" unless a rule fired. No restating the verdict. Next steps only from `next_action` and the dictionary's supplier check.
- **Labelled:** "Written by Claude", a "numbers match the evidence" check, and a one-click switch to the plain template.

## Look closer without leaving (region peek)

Any marked image region, reason card, tile thumbnail or tile chip can be inspected in place:

- **Peek** on hover or keyboard focus: a glass popover beside the region (on the side with more room) with a magnified crop, the region ringed, a scale bar, and one line of what was measured there. It never covers the region itself.
- **Pin** on click: an inspector panel on the right with a detector switch (BSE / ETD / InLens), silicon and pore layers, ← → through all regions, and "Open full tile" for the Library. Close returns you to where you were.
- **Crop maths:** zoom so the region fills about 70% of the box (1.4× to 12×), clamp so the crop never shows past the image edge, and pick the scale bar from 20 / 10 / 5 / 2 / 1 µm (at most 110 px). Tile width is 174.6 µm (6,984 px at 25 nm).
- Regions stay marked PREVIEW until the model returns real heatmap regions. Particle spots use real centroids from `particles.csv`.

## Colour

| Role | Token | Hex |
|---|---|---|
| Ground | `--cx-bg` | `#0A0B0D` |
| Ink | `--cx-text` | `#EDECE8` |
| Muted / faint text | `--cx-muted` / `--cx-faint` | `#A3A4A9` / `#8A8C92` |
| Brand (cat) | `--cx-orange` | `#FF7A2F` |
| Batch 3, baseline | `--cx-batch-3` | `#2DD4BF` |
| Batch 1 | `--cx-batch-1` | `#6EA8FF` |
| Batch 2 | `--cx-batch-2` | `#B794FF` |
| Accept / Investigate / Reject | `--cx-accept` / `--cx-investigate` / `--cx-reject` | `#4ADE80` / `#FACC15` / `#F87171` |
| Silicon / pore / binder overlay | `--cx-phase-*` | `#FF9A3C` / `#38BDF8` / `#C48CFF` |

Batch 1 moved from amber (in `docs/APP.md`) to blue so orange stays the cat's.

## Type

- **Geist** for words. Page titles 40/600 at −3% tracking, section titles 15–18/500, body 14–16.
- **Geist Mono** for numbers, IDs, hashes and the small uppercase labels (`.lbl`).

## Charts

- **Baseline band:** every value is drawn against the baseline mean ±1σ / ±2σ / ±3σ, shaded in baseline teal.
- **Shifts in σ**, next to physical units (`0.075 → 0.105 · +2.1σ`).
- **Intervals,** not just points. The tolerance (±1.5σ, the margin δ) is a dashed teal zone.
- **Status chips:** Similar (green), Unclear (yellow), Paused (grey, imaging changed).

## Logo

The head is a benzene hexagon, the chemist's shorthand for a catalyst. The two top bonds lift into ears and the side bonds become whiskers. One stroke weight, on an 8-unit grid. Below 32 px use `favicon.svg` (no whiskers, chunkier eyes).

| File | Use |
|---|---|
| `logo/catalyst-mark.svg` | Mark on dark |
| `logo/catalyst-mark-on-light.svg` | Mark on light / print |
| `logo/catalyst-wordmark-on-dark.svg`, `-on-light.svg` | Mark + "catalyst" (live text in Geist Semibold) |
| `logo/app-icon.svg` | 128 px app icon |
| `logo/favicon.svg` | 16–32 px |
| `logo/catalyst-mark-construction.svg` | The construction drawing |
| `logo/moods/{ready,sniffing,sure,unsure,peeking}.svg` | Empty, working, confident, unsure states; `peeking` sits on the drop zone's top edge |

`assets/logo/` (the earlier monoline sketch) and `assets/cat/` are still used by the demo video.
