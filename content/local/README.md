# Local Content

Animama manages this readable library, and the self-host operator may also add,
edit, rename, or remove ordinary files with normal filesystem tools.

Creator Save writes Actions as readable folders containing a same-stem
`.meta.json` control document and same-stem `.json` or `.vrma` playable file.
Simple manually added leaf files may still stand alone.
Valid changes become selectable after Save or an authoritative Rescan, but are
never automatically equipped. A Discover download will be copied here as an
editable Local copy.

There are intentionally no `workspace`, `applied`, `installed`, `drop-ins`,
digest-blob, or staging trees here. Temporary operations, imports, exports, and
runtime bookkeeping belong under `data/`.
