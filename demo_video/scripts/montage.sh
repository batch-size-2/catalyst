#!/usr/bin/env bash
# Labelled review grid of stills: scripts/montage.sh out.png cols a.png b.png ...
set -euo pipefail
out=$1; cols=$2; shift 2
args=(); filters=""; i=0
for f in "$@"; do
  args+=(-i "$f")
  label=$(basename "$f" .png)
  filters+="[$i:v]scale=640:360[v$i];"
  i=$((i+1))
done
rows=$(( (i + cols - 1) / cols ))
layout=""
for ((k=0; k<i; k++)); do
  x=$(( (k % cols) * 640 )); y=$(( (k / cols) * 360 ))
  layout+="${x}_${y}|"
  filters+="[v$k]"
done
filters+="xstack=inputs=$i:layout=${layout%|}:fill=black"
ffmpeg -loglevel error -y "${args[@]}" -filter_complex "$filters" -frames:v 1 "$out"
