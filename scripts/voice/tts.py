"""Render narration lines to WAV with Kokoro (local, offline, Apache-2.0 weights).

Reads a JSON list of {"id", "text", "file"} on stdin, writes each WAV that is
missing, and prints {"id": seconds} as JSON. Called by scripts/voice/narrate.mjs.

Env: KOKORO_MODEL, KOKORO_VOICES (paths), KOKORO_VOICE (default af_heart),
KOKORO_SPEED (default 1.1, set by narrate.mjs).
"""
import json
import os
import sys

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

lines = json.load(sys.stdin)
voice = os.environ.get("KOKORO_VOICE", "af_heart")
speed = float(os.environ.get("KOKORO_SPEED", "1.1"))
kokoro = None
durations = {}

for line in lines:
    path = line["file"]
    if not os.path.exists(path):
        kokoro = kokoro or Kokoro(os.environ["KOKORO_MODEL"], os.environ["KOKORO_VOICES"])
        samples, rate = kokoro.create(line["text"], voice=voice, speed=speed, lang="en-us")
        # Trim model padding so clip timing is predictable; keep 60 ms tails.
        loud = np.flatnonzero(np.abs(samples) > 0.01)
        if loud.size:
            pad = int(rate * 0.06)
            samples = samples[max(0, loud[0] - pad):loud[-1] + pad]
        sf.write(path, samples, rate, subtype="PCM_16")
        print(f"voice  {line['id']}", file=sys.stderr)
    info = sf.info(path)
    durations[line["id"]] = info.frames / info.samplerate

json.dump(durations, sys.stdout)
