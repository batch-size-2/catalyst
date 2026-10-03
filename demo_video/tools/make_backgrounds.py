"""Builds the video's background plates from the app's own segmentation overlays.

Reads the overlay PNGs in out/masks/<batch>/<id>.png (BSE grey with silicon, pore and
binder blended in at 50%, written by qc.run.save_overlay), recovers the grey image and
the phase masks from them exactly, and tiles a few strips into one large plate:

    demo_video/public/bg/micro_grey.jpg     raw-looking grey micrograph
    demo_video/public/bg/micro_color.jpg    the app's coloured look
    demo_video/public/bg/mask_{si,pore,binder}.png   white = that phase, for tinting in Remotion

Run from the repo root after `uv run python -m qc.run` has written the overlays:
    uv run python demo_video/tools/make_backgrounds.py
"""

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
MASKS = ROOT / "out" / "masks"
OUT = ROOT / "demo_video" / "public" / "bg"

# Must match qc/run.py OVERLAY_RGB.
PHASES = {"pore": (40, 120, 255), "si": (255, 140, 0), "binder": (190, 90, 255)}
SIZE = (3200, 1800)      # 16:9 with room for slow pans and zooms at 1080p
COLS, ROWS, FEATHER = 2, 4, 64


def split(overlay: np.ndarray) -> tuple[np.ndarray, dict[str, np.ndarray]]:
    """Overlay (H, W, 3) uint8 -> grey (H, W) and one boolean mask per phase."""
    o = overlay.astype(np.float32)
    best_err = np.abs(o[..., 0] - o[..., 1]) + np.abs(o[..., 1] - o[..., 2])  # 0 for plain grey
    grey = o.mean(axis=2)
    label = np.full(o.shape[:2], "", dtype=object)
    for name, color in PHASES.items():
        est = 2 * o - np.array(color, dtype=np.float32)       # grey estimate per channel
        err = est.max(axis=2) - est.min(axis=2)
        ok = (err < best_err) & (est.min(axis=2) > -4) & (est.max(axis=2) < 259)
        best_err = np.where(ok, err, best_err)
        grey = np.where(ok, est.mean(axis=2), grey)
        label = np.where(ok, name, label)
    masks = {name: label == name for name in PHASES}
    return np.clip(grey, 0, 255).astype(np.uint8), masks


def ramp(n: int, length: int, start: bool, end: bool) -> np.ndarray:
    """1-D alpha that fades in over `FEATHER` px at the start and out at the end."""
    a = np.ones(length, dtype=np.float32)
    f = np.linspace(0, 1, n, dtype=np.float32)
    if start:
        a[:n] = f
    if end:
        a[-n:] = f[::-1]
    return a


def mosaic(layers: list[np.ndarray], tile_w: int, tile_h: int) -> np.ndarray:
    """Tiles same-sized layers COLS x ROWS with feathered overlaps."""
    step_w, step_h = tile_w - FEATHER, tile_h - FEATHER
    shape = (step_h * ROWS + FEATHER, step_w * COLS + FEATHER) + layers[0].shape[2:]
    acc = np.zeros(shape, dtype=np.float32)
    wsum = np.zeros(shape[:2], dtype=np.float32)
    for i, layer in enumerate(layers):
        r, c = divmod(i, COLS)
        w = np.outer(ramp(FEATHER, tile_h, r > 0, r < ROWS - 1), ramp(FEATHER, tile_w, c > 0, c < COLS - 1))
        y, x = r * step_h, c * step_w
        weighted = layer * (w[..., None] if layer.ndim == 3 else w)
        acc[y:y + tile_h, x:x + tile_w] += weighted
        wsum[y:y + tile_h, x:x + tile_w] += w
    wsum = np.maximum(wsum, 1e-6)
    return acc / (wsum[..., None] if acc.ndim == 3 else wsum)


def main() -> None:
    paths = sorted(MASKS.glob("*/*.png"))
    if len(paths) < COLS * ROWS:
        raise SystemExit(f"need {COLS * ROWS} overlays in {MASKS}, found {len(paths)}; run qc.run first")
    # Spread the picks across batches and strips so neighbours differ.
    picks = [paths[round(i * (len(paths) - 1) / (COLS * ROWS - 1))] for i in range(COLS * ROWS)]
    tiles = [np.asarray(Image.open(p).convert("RGB")) for p in picks]
    th, tw = min(t.shape[0] for t in tiles), min(t.shape[1] for t in tiles)
    tiles = [t[:th, :tw] for t in tiles]

    split_tiles = [split(t) for t in tiles]
    color = mosaic([t.astype(np.float32) for t in tiles], tw, th)
    grey = mosaic([g.astype(np.float32) for g, _ in split_tiles], tw, th)
    masks = {n: mosaic([m[n].astype(np.float32) * 255 for _, m in split_tiles], tw, th) for n in PHASES}

    # Cover-crop to 16:9, then resize to SIZE.
    h, w = grey.shape
    target = SIZE[0] / SIZE[1]
    cw, ch = (w, round(w / target)) if w / h < target else (round(h * target), h)
    y0, x0 = (h - ch) // 2, (w - cw) // 2

    def save(arr: np.ndarray, name: str) -> None:
        im = Image.fromarray(np.clip(arr[y0:y0 + ch, x0:x0 + cw], 0, 255).astype(np.uint8))
        im = im.resize(SIZE, Image.LANCZOS)
        if name.endswith(".jpg"):
            im.save(OUT / name, quality=88)
        else:
            im.save(OUT / name, optimize=True)

    OUT.mkdir(parents=True, exist_ok=True)
    save(color, "micro_color.jpg")
    save(grey, "micro_grey.jpg")
    for n, m in masks.items():
        save(m, f"mask_{n}.png")
    print("tiles:", ", ".join(f"{p.parent.name}/{p.stem}" for p in picks))
    print("wrote", ", ".join(sorted(f.name for f in OUT.iterdir())), "to", OUT.relative_to(ROOT))


if __name__ == "__main__":
    main()
