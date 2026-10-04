# Phase 2 plan: from animatic to launch film

Times are global seconds from `node scripts/words.ts` with the holds from the brief (news lead 0.6 / hold 0.4, science 0.3, compare 1.0, identify 0.4, inspect 0.4, audit 3.4, impact 0, lab 1.3, aged 0.6, outro 1.6). **Total 118.47 s** (3555 frames). Lawsuit press = sfx frame = `audit` "button" + 0.75 s = **82.67 s, frame 2480**.

## Phase 1 review (what I watched before changing anything)

Strong, keep:
- The engine: `core.ts` (narration + word timings + beats → one timeline), every layer a pure function of `t`, missing assets never crash.
- The stage: dimmed micrograph plate with the 32 px grid and vignette, the macOS window, Geist type, captions with the current word in orange.
- Science: the phase reveals (grey → graphite edges → silicon → pore → colour) and the dive whose anode layers are windows onto the real plate.
- The lab-coat cat in the margins, the mrrp entrance.

Weak, change:
- **No hook.** News is two small glass cards in the middle of a mostly empty dark frame for 14 s; nothing big, nothing moving on frame 1.
- **Dark gap** (~1.5 s) between the dive and the bright micrograph.
- **App scenes are static stand-ins**: tiny unreadable text, a window that never moves, no cursor, no spotlight, the eye doesn't know where to look.
- Cat callouts repeat the narration; faces snap; the cat rarely reacts.
- Outro is a static card; nothing rhymes with the opening.
- One brisk speed, hard cross-fades between routes.

## What stays, what changes, and why

| Piece | Decision |
|---|---|
| `core.ts` | Keep. Extend `BeatSpec` with camera/cursor/spot/lift/hero/clip/frame fields. Caption pages skip words shown as hero type. |
| `state.ts` | Rewrite the screen part: a manifest camera (scroll + zoom over a virtual 1400×780 screen = fixed sidebar + scrolling page), one shared spring, cursor paths, spotlight/lift state, window layout (centre / left / right for hero type), tilt from camera velocity. Keep bg/plate/cat code, extended. |
| `Screen.tsx` | Rewrite: reads `public/screens/manifest.json` → `standins.json` → placeholder. Draws page shots (full page + fixed sidebar crop from the viewport shot), viewport shots, and clips (`OffthreadVideo`); camera, spotlight + self-drawing outline, 2.5D lift, cross-fades, sidebar-click navigation. |
| Cursor | New `Cursor.tsx`: macOS arrow on curved paths with overshoot, arrives ~0.2 s early, presses (scale 0.9) on its beat frame, orange ripple. Click sfx on the same frame. |
| Hero type | New `HeroType.tsx`: words land in spoken order (each on its word's audio start), Geist 700, token colours; the window slides aside and the subtitle steps aside. |
| News | Rebuilt: BREAKING NEWS banner + year roll, 3D-tilted glass cards stacked in depth on the right, camera push, hero headline on the left, `$1.9 BILLION` count-up (starts on "nearly", lands on "billion"), `82,000 CARS`, small text-only sources at the bottom. |
| Science | Keep the dive and reveals; new mark-draw at centre on "I'm Catalyst"; reveal the bright micrograph on "anode" with no dark gap; new lithium needles, arc flash, ember fire, "FIRE" hero type, burn down into the lab plate as the window rises. |
| App scenes | Real captures + the camera system, cursor clicks on the beat, lifts, clips (lawsuit, anode). |
| Impact / lab / aged | New scenes. Cooler plate tint + `EXPERIMENTAL` chip in the title bar. |
| Outro | Rebuilt to rhyme with the news: the plate returns in colour, the huge left-side hero type slot now says "catalyst" (where "GM RECALLED…" was), the banner slot carries the subtitle; cat curls up, slow blink, meow. |
| Cat | `Cat.tsx` gets opt-in props (`goggles="down"`, `blink`, `ears`, `headTilt`, `squash`, new expressions `focused`, `thinking`, `wince`, `smug`, `scared`); `CatActor` adds the acted change (squint → squash take → new face with overshoot → settle) and emotes (!, sweat, sparkle), head leads/body follows, item gavel. Callouts removed. |
| Finish | Glass light sweep on the window's first entrance, vignette, ≤ 3 % grain, motion blur only on sub-second camera travel, 5 % safe margins. |

## Motion language (shared, owned by me)

- **One spring** for all UI/camera travel: `{damping: 22, stiffness: 120, mass: 0.9}` (fast, tiny overshoot); a softer one for the window frame `{damping: 20, stiffness: 70}`; the cat bouncier `{damping: 14, stiffness: 90}`.
- **Camera**: `focus` a manifest highlight → scroll so it's centred, zoom to fit (capped by `zoom`), clamp to the page; long travels dip the zoom ~8 % mid-flight; window tilts ≤ 6° with camera velocity, flat at rest.
- **Spotlight**: page dims to 55 % outside a rounded cut-out; orange outline draws itself (0.45 s) with a soft glow.
- **Lift**: crop of the highlight from the 2× capture rises to 1.06 with a deep shadow and a 6 px parallax while the page dims.
- **Cursor**: arrives 0.2 s before the word, press on the word frame, ripple 0.5 s; a click cross-fades to the `@state` shot 2 frames after the press.
- **Navigation**: the cursor clicks a sidebar item; the page cross-fades with a 10 px rise; the window doesn't move.
- **Hero type**: window springs to `left` (scale 0.74, left edge ≈ 96 px) and type owns x 1150–1824; words rise 40 px + de-blur on their spoken frame; exit by sliding up and fading as the window recentres.
- **Transitions**: every seam is a move (card fly-out, dive, burn-down + window rise, sidebar click, window scale-down), never a hard cut.

## Shot list

Reads are in order; each must be found, understood and registered before the next starts.

### 1 news · 0.00–14.58 · cold grey
| Time | Words | Reads | Camera / FX | Cat | Hero |
|---|---|---|---|---|---|
| 0.00–2.3 | (lead) "In 2021," | BREAKING NEWS · 2021 | plate already drifting + push; red rule wipes, banner slams (overshoot), year rolls to 2021 on "2021"; faint car rows fill in behind | off | — |
| 2.34–5.0 | "GM recalled every Chevy Bolt" | the Bolt was recalled, all of them | Bolt card flies in tilted (rotY −28° → −14°) on the right; camera pushes toward it | off | **GM RECALLED / EVERY / CHEVY BOLT** word by word, left; orange marker sweep under "EVERY CHEVY BOLT" |
| 5.0–8.3 | "it had ever sold. The battery cells were faulty, and fixing them cost" | the cells were the fault | headline slides up and fades; card's "faulty battery cells" gets the marker; captions back | off | — |
| 8.34–10.2 | "nearly two billion dollars" | it cost $1.9 billion | count-up starts on "nearly", lands on "billion" | off | **$1.9 BILLION** |
| 10.26–11.9 | "Hyundai had to swap the batteries in" | it happened again, to Hyundai | Hyundai card lands on top; Bolt card falls back in depth; sources line extends | off | — |
| 11.94–13.3 | "eighty-two thousand cars." | 82,000 cars | camera pushes into the Hyundai card | off | **82,000 CARS** (count-up) |
| 13.3–14.58 | (hold) | there's a pattern | Note 7 card slides in behind, dim; sources complete | off | — |
| out | | | cards fly off right/back in depth on "I'm" (stagger) | | |

### 2 science · 14.58–37.75 · grey → orange/blue → fire
| Time | Words | Reads | Camera / FX | Cat |
|---|---|---|---|---|
| 14.58–15.8 | "I'm Catalyst," | the narrator is Catalyst (the cat) | mark draws in at centre (stroke then fill), shrinks up to the top | enters left-low, waves, mrrp; happy |
| 15.85–19.2 | "check battery material before it's made into cells. This is an anode" | the material goes into cells | car draws (15.85) → dive car → pack → cell → anode lands on "anode" 19.21 | float, curious |
| 19.21–21.0 | "under a microscope" | this is a real micrograph | bright plate fades in *during* the last 0.5 s of the dive (no gap) | magnifier |
| 21.08–22.5 | "Grey is graphite." | grey = graphite | edge glow + pinned label | |
| 22.56–25.8 | "Orange is silicon, which holds far more lithium" | orange = silicon | silicon mask + label | |
| 25.89–27.7 | "but swells every charge." | silicon swells | swell inset ×1.5 pulses | **startled take**, "!" |
| 27.80–30.5 | "Blue is the space the lithium moves through." | blue = pores | pore mask + label | curious |
| 30.54–31.9 | "If the mix is off," | mix matters | all phases (colour plate), labels out | thinking |
| 31.91–34.9 | "lithium can plate out as metal, and in the worst case" | metal needles grow | silver dendrites self-draw down from the top edge | worried |
| 34.94 | "short" | short circuit | 3 bright arc frames where needles meet, 2-frame shake | **scared take**, sweat |
| 36.15–37.2 | "start a fire." | fire | ember glow from below, rising sparks, plate warms then burns down to dark | ears back, eyes wide |
| out | | | burn-down into the lab plate while the window rises (37.6→) | |

Hero: **FIRE** (36.15, the word "fire" at 36.46), centre-right, ember-lit.

### 3 compare · 37.75–53.35 · dark lab + orange (Batch 1 vs default Batch 3)
| Time | Words | Reads | Camera | Cursor / lift | Cat |
|---|---|---|---|---|---|
| 37.75–39.2 | "When a batch arrives," | we're in the app, comparing a batch | window rises with glass sweep on `compare` top | — | rides up from left-low, thinking |
| 39.27–41.6 | "I compare it with what the supplier promised." | it's checked against the baseline (Batch 3) | focus `answer`; spot `baseline` on "promised" | | pointer to baseline |
| 41.74–44.9 | "Each row shows how far one measurement has moved." | rows = measurements that moved | glide to `moved`; spot row1 on "row", glide row2/row3 on "far"/"moved" | | pointer follows |
| 44.99–47.1 | "This batch says investigate," | the verdict is Investigate | spring back to `answer`, window → left | **lift** `verdict` | small shrug take on "investigate" |
| 47.2–48.7 | "so it's held for a closer look." | next step: hold it | window recentres; spot `next1` on "held" | | |
| 48.76–53.35 | "The tabs explain it for each role, from operator to manager." (+1.0 hold) | one call, four audiences; Manager readable | focus `explain`, zoom so the text is ≥ 24 px | clicks: fold on "tabs", Operator on "explain", engineer/scientist evenly, Manager on "manager"; text cross-fades | happy |

Hero: **INVESTIGATE** (yellow, right side, 45.97) with the real verdict lifted in the window.

### 4 identify · 53.35–63.53
| Time | Words | Reads | Camera | Cursor / lift | Cat |
|---|---|---|---|---|---|
| 53.35–54.5 | "You can also give me" | new page: Identify | page change under a sidebar click (press 53.2) | click "Identify tile" | carries a tile card |
| 54.52–55.5 | "a single image." | one tile goes in | focus `dropzone` | cat tosses the tile onto the drop zone (arc, land on "image" + drop sfx) | proud |
| 55.56–57.0 | "I'll tell you which batch it looks" | → the result | tile card shrinks into the result tile (cross-fade to `identify_result`) | | |
| 57.04–58.0 | "closest to," | closest batch + probabilities | focus `answer` | **lift** `answer`; bars grow | pointer to bars |
| 58.13–59.4 | "and how sure I am." | confidence | spot `confidence` | | |
| 59.42–63.53 | "If it sits outside even that batch, I flag it as unfamiliar." | the familiarity check | spot `familiar` (real chip, real state) + `distance` if present | | surprised take on "unfamiliar" |

Hero: none if the chip says "Familiar tile" (would contradict); only if a real "Unfamiliar" state exists.

### 5 inspect · 63.53–71.89 (continues on the same result page)
| Time | Words | Reads | Camera | Cursor | Cat |
|---|---|---|---|---|---|
| 63.53–64.8 | "You can check my work." | you can look closer | focus `tile_image`, push in | hover the spot on "check" → `@hover`: real ring + peek pops; **lift** `tooltip` | goggles down (take), magnifier |
| 64.88–68.9 | "Open any image and turn on the overlay to see which pixels I counted as" | pinned inspector | focus `inspector` (push) | click spot on "Open" → `@pinned` | focused |
| 69.07 | "silicon" | orange = silicon pixels | push to `inspector_img` | click Silicon → `@silicon` | |
| 70.39–71.89 | "and which as pores." | blue = pores | hold close enough to see pixels | click Pore → `@pore` | proud |

### 6 audit · 71.89–86.32
| Time | Words | Reads | Camera | Cursor / lift | Cat |
|---|---|---|---|---|---|
| 71.89–73.8 | "Every comparison is saved" | a log of decisions | page change; spot `row` | click "Audit log" (press 71.75) | smug |
| 73.86–75.9 | "with a fingerprint of its images and settings." | each has a hash | focus `hash_row` | **lift** `hash_row`; the hash types itself (left-to-right reveal of the real pixels + caret) | |
| 76.08–78.6 | "Press verify, and I check that nothing has changed." | verified ✓ | focus `verify_btn` → `verify_result` | click Verify on "verify" → `@verified`; ticks stagger | |
| 79.34–82.66 | "And if a batch turns out bad, there's one more button." | the red button | push to `lawsuit`; idle pulse on the button | cursor glides in, hovers | gavel out, smug |
| **82.67** | (sfx) | GENERATE LAWSUIT | 2-frame shake | **press on frame 2480**, the lawsuit clip at 2× | |
| 82.7–86.32 | (hold 3.4) | READY FOR COUNSEL · parody | push on `counsel`; ≥ 1 s readable incl. disclaimer | | stamp/gavel take |

### 7 impact · 86.32–99.34 · cooler tint + EXPERIMENTAL
| Time | Words | Reads | Camera | Cursor | Cat |
|---|---|---|---|---|---|
| 86.32–88.9 | "Last, two experiments we're still testing." | this is experimental | plate cools; `EXPERIMENTAL` chip pops in the title bar | click "Wear & impact" on "experiments" | goggles up, thinking |
| 88.99–92.8 | "The first estimates what the differences I found could mean for the cell," | effects on the cell | focus `cards` | | |
| 92.85–94.4 | "like its capacity" | capacity | spot `card_capacity` | | |
| 94.45–95.3 | "or how fast it can charge." | charging | spot `card_charge` | | |
| 95.33–97.9 | "It also shows the worst case," | the worst-case chain | focus `worst`; steps draw one by one | | |
| 97.95–99.34 | "and what would rule it out." | what rules it out | spot `rules_out` | | |

### 8 lab · 99.34–107.77
| Time | Words | Reads | Camera | Cursor / clip | Cat |
|---|---|---|---|---|---|
| 99.34–102.4 | "The second turns the measurements into a 3D anode you can charge." | a 3D anode | page change; `anode_rotate` clip | click "Anode lab" on "second" | goggles down, leaning in |
| 102.5–103.7 | "Charge it too fast," | high C-rate | focus controls | drag C-rate to max on "fast" | |
| 104.0–107.77 | "and lithium plates out as metal." (+1.3 hold) | plating | `anode_charge` clip from the press; push into `block` | press Charge ~104.0 | worried |

### 9 aged · 107.77–111.64
| Time | Words | Reads | Camera | Clip | Cat | Hero |
|---|---|---|---|---|---|---|
| 107.77–109.2 | "After eight hundred cycles," | 800 cycles of ageing | window → left | `anode_age` (cursor drags Ageing) | | **800 CYCLES** |
| 109.28–111.64 | "the silicon has cracked." | cracked silicon | recentre, push into `block` / `cracked` row | end state | wince take |

### 10 outro · 111.64–118.47 · warm colour plate (rhyme)
| Time | Words | Reads | FX | Cat | Hero |
|---|---|---|---|---|---|
| 111.64–112.3 | "That's me," | leaving the app | window scales down + fades; colour plate warms | moves to the logo | — |
| 112.36–113.0 | "Catalyst." | the name | mark + **catalyst** land in the hero slot where "GM RECALLED" stood | | **catalyst** |
| 113.0–114.3 | "Send me your next batch." | what it does | subtitle "Batch QC for battery materials" | | |
| 114.34–116.4 | "Made by Team Batch Size 2." | team | team line | curls up | |
| 116.4–118.47 | (hold) | end | slow blink, **meow** (116.92), fade to black last 0.6 s | blink + meow | |

## Captured clips (real motion)
`lawsuit` (checklist to READY FOR COUNSEL, played 2×), `anode_rotate` (scripted drag), `anode_charge` (8C charge to plating), `anode_age` (0 → 800 cycles). Everything else is stills (`@state` shots) animated by the camera, cursor, spotlight and lifts; bars growing and ticks staggering are animated in Remotion over the real states.

## Review plan
- `npm run sheet` (first/middle/last of every shot, labelled), `npm run strip -- <t0> <t1>`, `npm run crop -- <t> x,y,w,h`, all into `review/check/` (the `.cache` is gitignored so I can't open images there).
- Strips at every click, lift, seam, cat take, the arc flash and the lawsuit hit; crops for every UI text the narration points at.
- Checkpoints: first full render ≈ T+1h15, review pass 1, rewrite weakest scenes, review pass 2, final render.
