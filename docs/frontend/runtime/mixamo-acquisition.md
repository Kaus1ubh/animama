# User-supplied Mixamo animations

Mixamo-derived animation bytes are excluded from Git and Docker build contexts.
Existing private working copies are retained. The exclusion covers 65 gesture
VRMAs and six idle VRMAs; original project-authored definitions remain source.
Git history and old LFS objects are unchanged. Public source must come from a
reviewed clean snapshot, not a visibility change to this repository.

## Manual acquisition helper

From the repository root, run:

```bash
python3 scripts/acquire-mixamo.py --prepare --open
```

This opens Adobe's own website and writes a private checklist at
`data/mixamo-acquisition/checklist.json`. Sign in yourself, select a character,
search the Animations tab, preview each motion, adjust settings, then download
FBX files using Adobe's Download button. Keep those files in
`data/mixamo-acquisition/`. See [Adobe's manual workflow](https://helpx.adobe.com/creative-cloud/help/animate-characters-mixamo.html).
Running without flags only prints instructions and the list. Existing answers
are never overwritten. The helper does not receive credentials, scrape Adobe,
download animations automatically, convert files or install content.

The checklist names the 29 intended starter targets: 23 gestures and six idle
motions. `plead` and `posture_sad_custom` were retired from the starter selection.
The full 71-path exclusion inventory is in `scripts/mixamo-assets.json`.
Names are local search hints: the exact original Adobe animation IDs, character
and export settings have not been recovered. Record them while downloading;
matching a name alone does not prove matching motion or redistribution rights.

## Deferred work and current limitation

This is a preparation helper, not a complete source setup path. FBX-to-`.vrma`
conversion, retargeting, reviewed installation receipts and behavior verification
remain deferred. Renaming an FBX file to `.vrma` does not convert it.

A fresh clone lacks required starter animation bytes. Existing starter resolution
and native staging intentionally reject missing or untracked distribution inputs;
do not disable these checks to package private copies. Fresh-clone desktop and
built-image acceptance remain blocked until the user-supplied workflow or approved
replacements are completed. A bind-mounted maintainer checkout may still see its
private copies, so a successful local launch would not establish public readiness.

No animation test, download or conversion has been performed for this helper.
Review the then-current Adobe terms before use; this script grants no rights to
Adobe assets and does not authorize redistributing them with source or binaries.
