"""Generates the video's small UI sounds with ElevenLabs sound effects, locally.

Reads demo_video/sfx.json and writes demo_video/public/sfx/<id>.mp3 (+ <id>.json with the prompt hash).
Only changed sounds are regenerated. Uses ELEVENLABS_API_KEY from the environment or demo_video/.env.

    python3 demo_video/tools/sfx.py [--only drop,done] [--force]
"""

import argparse, hashlib, json, os, sys, urllib.error, urllib.request
from pathlib import Path

from voice import ROOT, load_env

OUT = ROOT / "public" / "sfx"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    load_env()
    key = os.environ.get("ELEVENLABS_API_KEY") or sys.exit("Set ELEVENLABS_API_KEY.")
    only = set(args.only.split(",")) if args.only else None
    OUT.mkdir(parents=True, exist_ok=True)

    for s in json.loads((ROOT / "sfx.json").read_text())["sounds"]:
        h = hashlib.sha256(f"{s['prompt']}|{s['seconds']}".encode()).hexdigest()[:16]
        meta, mp3 = OUT / f"{s['id']}.json", OUT / f"{s['id']}.mp3"
        fresh = meta.exists() and mp3.exists() and json.loads(meta.read_text()).get("hash") == h
        if (only and s["id"] not in only) or (fresh and not args.force):
            continue
        body = json.dumps({"text": s["prompt"], "duration_seconds": s["seconds"], "prompt_influence": 0.6}).encode()
        req = urllib.request.Request("https://api.elevenlabs.io/v1/sound-generation", data=body, method="POST",
                                     headers={"xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg"})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                mp3.write_bytes(r.read())
        except urllib.error.HTTPError as e:
            sys.exit(f"{s['id']}: HTTP {e.code} {e.read().decode(errors='replace')[:300]}")
        meta.write_text(json.dumps({"id": s["id"], "hash": h, "prompt": s["prompt"], "seconds": s["seconds"]}, indent=1))
        print(f"  {s['id']:7s} generated")


if __name__ == "__main__":
    main()
