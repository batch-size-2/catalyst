"""T18 helper: per-tile DINOv2-small embeddings (CLS + mean patch) of every detector, for the 31 known
images and the 3 test images, plus multiscale radial power-spectrum bands. Cached in out/experiments/T18/.

Usage: HF_HUB_OFFLINE=1 PYTHONPATH=. uv run python scripts/experiments/T18_tiles.py
"""

from pathlib import Path

import numpy as np

from qc import deep as D
from qc.io import field_paths, load_field
from qc.measure import black_level, valid_rows

OUT = Path("out/experiments/T18")
FOLDERS = [Path("data/Batch_1"), Path("data/Batch_2"), Path("data/Batch_3"), Path("data/Hackathon-Polaron-test")]
CHANNELS = ("BSE", "ETD", "InLens")
BANDS_UM = (0.05, 0.1, 0.2, 0.4, 0.8, 1.6, 3.2, 6.4)  # octave band edges (period, um)


def spectrum_bands(img: np.ndarray, px_um: float) -> np.ndarray:
    """Share of (black-subtracted, valid-row) image variance per octave of spatial period, averaged over
    512 px windows: a scale-by-scale texture fingerprint with no thresholds or segmentation."""
    a = img[valid_rows(img.shape[0])].astype(np.float32)
    a = np.clip(a - black_level(a), 0, None)
    w = 512
    fy, fx = np.meshgrid(np.fft.fftfreq(w), np.fft.fftfreq(w), indexing="ij")
    period = px_um / np.maximum(np.hypot(fy, fx), 1e-9)
    edges = np.array(BANDS_UM)
    acc = np.zeros(len(edges) - 1)
    win = np.outer(np.hanning(w), np.hanning(w))
    for i in range(0, a.shape[0] - w + 1, w):
        for j in range(0, a.shape[1] - w + 1, w):
            t = a[i:i + w, j:j + w]
            p = np.abs(np.fft.fft2((t - t.mean()) * win)) ** 2
            acc += [p[(period >= lo) & (period < hi)].sum() for lo, hi in zip(edges[:-1], edges[1:])]
    return acc / acc.sum()


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    embed = D.default_embed()
    emb, meta, spec = {}, [], []
    for folder in FOLDERS:
        for image_id, paths in field_paths(folder).items():
            f = load_field(folder.name, image_id, paths)
            meta.append((folder.name, image_id, f.strip_id))
            row = []
            for ch in CHANNELS:
                emb[f"{image_id}|{ch}"] = np.asarray(embed(D.tiles(D.stretch(f.channels[ch]))), np.float32)
                row.append(spectrum_bands(f.channels[ch], f.px_um))
            spec.append(np.concatenate(row))
            print(folder.name, image_id, flush=True)
    np.savez_compressed(OUT / "tiles.npz", **emb)
    np.savez_compressed(OUT / "spectrum.npz", meta=np.array(meta), spec=np.array(spec), channels=np.array(CHANNELS), bands=np.array(BANDS_UM))


if __name__ == "__main__":
    main()
