# Optional Pocket TTS voice cloning

This set contains the pinned Mimi voice-cloning encoder and its notices.
Ordinary Pocket speech generation uses the bundled generation models and does
not require this set. The app downloads the encoder only when explicitly
requested, verifies its size and SHA-256, and serves it locally to the worker.

Maintainers explicitly acquire publication inputs with
`python3 scripts/models/pocket_cloning.py acquire --source upstream`, or import
verified existing files with `acquire --offline --import-from DIRECTORY`.
`verify` and `path` never download. The producer can therefore stage a new set
before its immutable objects have been published.
