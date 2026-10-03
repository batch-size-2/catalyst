"""Generates the narration with ElevenLabs, locally, so no agent ever needs the API key.

Reads demo_video/narration.json and writes, per scene:
    demo_video/public/audio/<id>.mp3    the voice line
    demo_video/public/audio/<id>.json   text, hash, voice, duration and word timings (for captions and beats)
plus demo_video/out/voice_preview.mp3 (all lines with gaps, to listen to the pacing).

Only scenes whose text, voice, model or settings changed are regenerated.

Setup, once: put these in demo_video/.env (gitignored), or export them:
    ELEVENLABS_API_KEY=...
    ELEVENLABS_VOICE_ID=...        # optional, overrides narration.json voice.voice_id
    ELEVENLABS_MODEL=...           # optional, overrides narration.json (e.g. eleven_v3)

Run from the repo root:
    python3 demo_video/tools/voice.py              # changed scenes only
    python3 demo_video/tools/voice.py --only hook  # one scene (comma-separate several)
    python3 demo_video/tools/voice.py --force      # everything
    python3 demo_video/tools/voice.py --dry-run    # show what would be generated
"""

import argparse, base64, hashlib, json, os, shutil, subprocess, sys, urllib.error, urllib.request, uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]          # demo_video/
AUDIO = ROOT / "public" / "audio"
API = "https://api.elevenlabs.io/v1"


def load_env() -> None:
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def request(path: str, key: str, body: bytes, content_type: str) -> dict:
    req = urllib.request.Request(f"{API}{path}", data=body, method="POST",
                                 headers={"xi-api-key": key, "Content-Type": content_type, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"ElevenLabs {path} failed: HTTP {e.code} {e.read().decode(errors='replace')[:500]}")


def words_from_chars(chars: list[str], starts: list[float], ends: list[float]) -> list[dict]:
    """Character timings -> [{text, start, end}] per whitespace-separated word."""
    words, cur = [], None
    for c, s, e in zip(chars, starts, ends):
        if c.isspace():
            cur = None
            continue
        if cur is None:
            cur = {"text": "", "start": s, "end": e}
            words.append(cur)
        cur["text"] += c
        cur["end"] = e
    return [{"text": w["text"], "start": round(w["start"], 3), "end": round(w["end"], 3)} for w in words]


def forced_alignment(key: str, mp3: bytes, text: str) -> list[dict]:
    """Fallback for models that don't return timestamps."""
    boundary = uuid.uuid4().hex
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"text\"\r\n\r\n{text}\r\n"
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"line.mp3\"\r\nContent-Type: audio/mpeg\r\n\r\n").encode()
    body += mp3 + f"\r\n--{boundary}--\r\n".encode()
    r = request("/forced-alignment", key, body, f"multipart/form-data; boundary={boundary}")
    return [{"text": w["text"], "start": round(w["start"], 3), "end": round(w["end"], 3)}
            for w in r.get("words", []) if w["text"].strip()]


def duration(path: Path, fallback: float) -> float:
    if not shutil.which("ffprobe"):
        return fallback
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                         capture_output=True, text=True)
    try:
        return round(float(out.stdout.strip()), 3)
    except ValueError:
        return fallback


def preview(ids: list[str], gap: float) -> Path | None:
    files = [AUDIO / f"{i}.mp3" for i in ids if (AUDIO / f"{i}.mp3").exists()]
    if not files or not shutil.which("ffmpeg"):
        return None
    out = ROOT / "out" / "voice_preview.mp3"
    out.parent.mkdir(parents=True, exist_ok=True)
    pads = "".join(f"[{n}:a]apad=pad_dur={gap}[a{n}];" for n in range(len(files)))
    cat = "".join(f"[a{n}]" for n in range(len(files))) + f"concat=n={len(files)}:v=0:a=1[out]"
    cmd = ["ffmpeg", "-y", "-loglevel", "error"] + sum([["-i", str(f)] for f in files], []) + \
          ["-filter_complex", pads + cat, "-map", "[out]", "-b:a", "128k", str(out)]
    subprocess.run(cmd, check=True)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="comma-separated scene ids")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    load_env()
    cfg = json.loads((ROOT / "narration.json").read_text())
    voice = cfg["voice"]
    model = os.environ.get("ELEVENLABS_MODEL") or voice["model_id"]
    voice_id = os.environ.get("ELEVENLABS_VOICE_ID") or voice.get("voice_id", "")
    key = os.environ.get("ELEVENLABS_API_KEY", "")
    if not args.dry_run and not (key and voice_id):
        sys.exit("Set ELEVENLABS_API_KEY in demo_video/.env (and a voice_id in narration.json).")

    scenes = cfg["scenes"]
    only = set(args.only.split(",")) if args.only else None
    AUDIO.mkdir(parents=True, exist_ok=True)

    for n, sc in enumerate(scenes):
        sid, text = sc["id"], sc["text"]
        spec = {"text": text, "voice_id": voice_id, "model_id": model, "voice_settings": voice["voice_settings"]}
        h = hashlib.sha256(json.dumps(spec, sort_keys=True).encode()).hexdigest()[:16]
        meta_path, mp3_path = AUDIO / f"{sid}.json", AUDIO / f"{sid}.mp3"
        old = json.loads(meta_path.read_text()) if meta_path.exists() else {}
        fresh = old.get("hash") == h and mp3_path.exists()
        if (only and sid not in only) or (fresh and not args.force):
            print(f"  {sid:9s} up to date" if fresh else f"  {sid:9s} skipped")
            continue
        if args.dry_run:
            print(f"  {sid:9s} would generate ({len(text)} chars)")
            continue

        body = {"text": text, "model_id": model, "voice_settings": voice["voice_settings"]}
        if n > 0:
            body["previous_text"] = scenes[n - 1]["text"]   # keeps intonation consistent across lines
        if n < len(scenes) - 1:
            body["next_text"] = scenes[n + 1]["text"]
        r = request(f"/text-to-speech/{voice_id}/with-timestamps?output_format=mp3_44100_128", key,
                    json.dumps(body).encode(), "application/json")
        mp3 = base64.b64decode(r["audio_base64"])
        mp3_path.write_bytes(mp3)
        al = r.get("alignment") or r.get("normalized_alignment")
        if al and al.get("characters"):
            words = words_from_chars(al["characters"], al["character_start_times_seconds"], al["character_end_times_seconds"])
        else:
            print(f"  {sid:9s} no timestamps from {model}, using forced alignment")
            words = forced_alignment(key, mp3, text)
        meta = {"id": sid, "text": text, "hash": h, "voice_id": voice_id, "model_id": model,
                "voice_settings": voice["voice_settings"],
                "duration": duration(mp3_path, words[-1]["end"] if words else 0.0), "words": words}
        meta_path.write_text(json.dumps(meta, indent=1))
        print(f"  {sid:9s} generated  {meta['duration']:5.1f} s  {len(words)} words")

    total, gap = 0.0, voice["gap_seconds"]
    for sc in scenes:
        p = AUDIO / f"{sc['id']}.json"
        if p.exists():
            total += json.loads(p.read_text())["duration"] + gap
    print(f"narration total incl. {gap}s gaps: {total:.1f} s (budget 120 s, leave room for visuals)")
    if not args.dry_run and (out := preview([s["id"] for s in scenes], gap)):
        print(f"listen: {out.relative_to(ROOT.parent)}")


if __name__ == "__main__":
    main()
