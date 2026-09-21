# Local Content

Animama manages this readable library, and the self-host operator may also add,
edit, rename, or remove ordinary files with normal filesystem tools.

Creator Save writes Actions as readable folders containing a same-stem
`.meta.json` control document and same-stem `.json` or `.vrma` playable file.
Simple manually added leaf files may still stand alone.
Valid changes become selectable after Save or an authoritative Rescan, but are
never automatically equipped. Imported typed packages become editable Local
copies.

Temporary operations, imports, exports, and runtime bookkeeping belong under
the managed private data root (`data/` by default for self-hosting); see
[private storage](../../docs/backend/architecture/local-content-storage.md#private-data).
