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

A hand-built monoline wordmark: every letter is drawn with the same round pen, no font involved. The cat hides inside the word: the orange **c** is a line-drawn cat head (ears grow out of the same stroke), and the **y** ends in a curled tail. The mark is the cat-c alone with two eyes.

| File | Use |
|---|---|
| `logo/catalyst-logo.svg` | On light backgrounds, e.g. the app's top-right corner |
| `logo/catalyst-logo-on-dark.svg` | On dark backgrounds |
| `logo/catalyst-mark.svg` | The cat-c with eyes: favicon, avatar, small spaces |

## Colours

| Token | Hex | Used for |
|---|---|---|
| Orange (fur) | `#F59A3C` | The cat |
| Logo orange | `#EF7F1A` | The cat-c in the logo |
| Stripe | `#D6721C` | Tabby stripes |
| Cream | `#FFF0DC` | Belly, muzzle, paws |
| Pink | `#FF9FB0` | Ears, nose, blush |
| Ink | `#2B2D42` / `#23262F` | Cat outlines / logo letters |
| Teal | `#14A39A` | Goggle strap; also Batch_3 (baseline) in the app |

## Rebuilding

```bash
python3 assets/logo/build_logo.py                                       # logos (pure Python, no dependencies)
cd web && npm install && cd ..
node assets/build.mjs                                                   # cat SVGs + preview.html (Node >= 20.19)
```

Build the logos first: the preview embeds `catalyst-logo.svg`.
