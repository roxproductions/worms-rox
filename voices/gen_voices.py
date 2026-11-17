#!/usr/bin/env python3
"""Render every in-game voice line with Qwen3-TTS (VoiceDesign) into voices/clips/<line>_<m|f>.mp3.

Resumable: existing clips are skipped. Needs: pip install qwen-tts soundfile, ffmpeg and sox on PATH.
Runs on CPU (~15-40 s per clip); a GPU is much faster. Edit VOICES to change the characters, then run
`python3 voices/pack_voices.py` (or `npm run voices:pack`) to rebuild voices/voices.js.
"""
import json, os, subprocess, sys
import soundfile as sf, torch
from qwen_tts import Qwen3TTSModel

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "clips"); os.makedirs(OUT, exist_ok=True)
VOICES = {
    "m": "A man in his 40s with a thick, slow Southern American drawl from rural Georgia, loud and a little tipsy and unhinged, grinning and cackling, like he's had three beers too many.",
    "f": "A woman in her 30s with a thick Southern American accent from Alabama, sassy, loud and a little tipsy and wild, giggling and cackling like she's had a few too many.",
}
dev = "cuda" if torch.cuda.is_available() else "cpu"
model = Qwen3TTSModel.from_pretrained("Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign", device_map=dev,
                                      dtype=torch.bfloat16, low_cpu_mem_usage=True)
TRIM = "silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse"
for i, text in enumerate(json.load(open(os.path.join(HERE, "lines.json")))):
    for key, prompt in VOICES.items():
        out = os.path.join(OUT, f"{i}_{key}.mp3")
        if os.path.exists(out): continue
        wav, sr = model.generate_voice_design(text=text, language="English", instruct=prompt)
        tmp = os.path.join(OUT, "tmp.wav"); sf.write(tmp, wav[0], sr)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", tmp, "-ac", "1", "-b:a", "56k", "-af", TRIM, out], check=True)
        print(i, key, flush=True)
print("done")
