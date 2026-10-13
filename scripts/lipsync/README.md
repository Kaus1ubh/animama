# Lip-sync evaluation clips

The lip-sync evaluation scores plan sources against recorded speech, offline:

```bash
pnpm --dir src/frontend/web lipsync:eval
pnpm --dir src/frontend/web lipsync:eval --source estimated --mode whole --json /tmp/eval.json
```

It reads the committed fixtures in `src/frontend/web/tests/lipsync/fixtures/`. Each
fixture holds one test line's text as sent (tags included), its audio features at
100 frames per second, any provider character timing, reference word and vowel
timings, and the inputs today's estimated planner needs. Fixtures hold no audio.

The lines are listed in `src/frontend/web/tests/lipsync/testset.json`. Lines with
`heldOut: true` were not used for tuning and are reported separately. Lines with
no groups are kept for spelling and listening checks but not scored, because
providers read their numbers differently and no reference words match.

## Rebuilding fixtures

Maintainers keep the clips (raw TTS audio) outside the repository. To add or
change a line, edit the test set, then make its clip and rebuild its fixture:

```bash
# Speak new lines. Paid requests skip clips that already exist.
uv run --env-file "$SECRETS_FILE" --with websockets --with scipy --with onnxruntime --with sentencepiece \
  python scripts/lipsync/clips.py generate "$CLIPS" --pocket-store "$(python3 scripts/models/browser_speech.py path)"

# Reference timings for scoring (evaluation only, see below).
uv run --no-project --python 3.12 --with "torch==2.8.*" --with "torchaudio==2.8.*" \
  --with uroman --with pypinyin --with pyopenjtalk-plus --with numpy \
  python scripts/lipsync/clips.py reference "$CLIPS"

# Inputs for today's estimated planner (needs the backend's gruut).
uv run python scripts/lipsync/clips.py estimated "$CLIPS"

pnpm --dir src/frontend/web lipsync:fixtures --clips "$CLIPS"
```

`$SECRETS_FILE` is the owner-only file holding `GEMINI_API_KEY` and
`ELEVENLABS_API_KEY`; the tool never prints them. Gemini lines use the backend's
own client and request shape. ElevenLabs lines use the Text to Dialogue socket
the way the app does (one input per sentence and a flush after the first) and keep
every frame's timing in `<id>.socket.json`. The fixture builder replays those
frames through the app's timing collector. The `e-` lines were recorded earlier
with HTTP timestamps (`<id>.alignment.json`); the app no longer uses that path.

## Reference timings

`clips.py reference` force-aligns each clip's romanised words with torchaudio's
MMS aligner. Its weights are licensed CC-BY-NC-4.0, so it is an evaluation tool
only: it is never shipped, and tests never run it. Japanese is romanised from
`pyopenjtalk-plus` readings, Chinese from `pypinyin`, Korean with `uroman`.

The committed reference timings derive from that aligner. Their redistribution
in a public source candidate is a pending rights question, recorded in
`licenses/source-review.json`.
