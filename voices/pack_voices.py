#!/usr/bin/env python3
"""Pack voices/clips/*.mp3 into voices/voices.js (window.WR_VOICES), which the build embeds into index.html."""
import base64, json, os
HERE = os.path.dirname(os.path.abspath(__file__))
lines = json.load(open(os.path.join(HERE, "lines.json"))); clips = {}
for i, text in enumerate(lines):
    row = []
    for key in "mf":
        p = os.path.join(HERE, "clips", f"{i}_{key}.mp3")
        row.append(base64.b64encode(open(p, "rb").read()).decode() if os.path.exists(p) else None)
    if any(row): clips[text] = row
js = "window.WR_VOICES=" + json.dumps({"chars": [{"g": "m"}, {"g": "f"}], "clips": clips}, separators=(",", ":")) + ";"
open(os.path.join(HERE, "voices.js"), "w").write(js)
print(len(clips), "lines,", len(js) // 1024, "KB")
