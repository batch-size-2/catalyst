"""Generates the background music bed with ElevenLabs Music, locally.

    python3 demo_video/tools/music.py [--out bed.mp3] [--force]

Writes demo_video/public/music/bed.mp3 from the prompt below. Uses ELEVENLABS_API_KEY
from the environment or demo_video/.env.
"""

import argparse, json, os, sys, urllib.error, urllib.request

from voice import ROOT, load_env

PROMPT = ("Sparse, low-key background underscore for a calm narrated tech explainer; it must sit quietly under a voice. "
          "Soft warm synth pads and a gentle, slow plucked motif with lots of space, curious and quietly hopeful, "
          "clean and modern, about 85 BPM. Keep the middle frequencies (where speech sits) uncluttered: no lead melody, "
          "no vocals, no drums until a very light pulse in the second half, no big builds or drops, even dynamics, "
          "smooth fade-out ending.")
SECONDS = 120


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--out", default="bed.mp3", help="file name in public/music/")
    args = ap.parse_args()
    load_env()
    key = os.environ.get("ELEVENLABS_API_KEY") or sys.exit("Set ELEVENLABS_API_KEY.")
    out = ROOT / "public" / "music" / args.out
    if out.exists() and not args.force:
        sys.exit(f"{out.relative_to(ROOT.parent)} exists; use --force to regenerate")
    out.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps({"prompt": PROMPT, "music_length_ms": SECONDS * 1000}).encode()
    req = urllib.request.Request("https://api.elevenlabs.io/v1/music", data=body, method="POST",
                                 headers={"xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg"})
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            out.write_bytes(r.read())
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code} {e.read().decode(errors='replace')[:400]}")
    (out.with_suffix(".json")).write_text(json.dumps({"prompt": PROMPT, "seconds": SECONDS}, indent=1))
    print("wrote", out.relative_to(ROOT.parent))


if __name__ == "__main__":
    main()
