# Assets

Brand assets shared by the web app and the demo video. Everything is drawn in code, so it stays sharp at any size and can be animated.

## Catalyst the cat (`cat/`)

Our orange tabby mascot, with lab goggles pushed up on the forehead.

| File | What |
|---|---|
| `cat/Cat.tsx` | **Source of truth.** Plain React component, no other dependencies. Pass `t` (seconds) for the idle loop: float, blink, tail sway, ear twitch |
| `cat/catalyst.svg` | Default still (happy, floating) |
| `cat/svg/expression-*.svg` | happy · curious · surprised · proud · shrug |
| `cat/svg/pose-*.svg` | float · hold · point · wave · shrug · stamp |
| `cat/preview.html` | Open in a browser: every expression and pose, animated. Works offline |

```tsx
import { Cat } from "../assets/cat/Cat";
<Cat t={seconds} expression="curious" pose="point" size={240} lookAt={[1, 0]} />
// Remotion: t={useCurrentFrame() / useVideoConfig().fps}
// Static: idle={false}
```

## Logo (`logo/`)

The word "Catalyst" in Fredoka SemiBold, converted to outlines (no font needed), with cat ears on the orange C.

| File | Use |
|---|---|
| `logo/catalyst-logo.svg` | On light backgrounds, e.g. the app's top-right corner |
| `logo/catalyst-logo-on-dark.svg` | On dark backgrounds |
| `logo/catalyst-mark.svg` | The eared C alone: favicon, avatar, small spaces |

## Colours

| Token | Hex | Used for |
|---|---|---|
| Orange (fur, C) | `#F59A3C` | Cat, logo C |
| Stripe | `#D6721C` | Tabby stripes |
| Cream | `#FFF0DC` | Belly, muzzle, paws |
| Pink | `#FF9FB0` | Ears, nose, blush |
| Ink | `#2B2D42` | Outlines, logo text |
| Teal | `#14A39A` | Goggle strap; also Batch_3 (baseline) in the app |

## Rebuilding

```bash
uv run --no-project --with fonttools python assets/logo/build_logo.py   # logos (downloads Fredoka, OFL, on first run)
cd web && npm install && cd ..
node assets/build.mjs                                                   # cat SVGs + preview.html (Node >= 20.19)
```

Build the logos first: the preview embeds `catalyst-logo.svg`.
