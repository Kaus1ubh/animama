# Animama Content Library

This is the canonical self-hosted typed-content library.

- `included/` is read-only content shipped with the application.
- `local/` is the managed, inspectable library for creator saves, imports, and files deliberately added by the host operator.

Both roots use ordinary typed folders: `avatars`, `gestures`, `pose-clips`,
`reactions`, `vfx`, `sfx`, `idle-styles`, `music`, `appearances`, `voices`, and
`animas`. A valid standalone file is enough for simple leaf content. Gestures
and Reactions are Action folders: `<stem>.meta.json` is their typed control
document and `<stem>.vrma` or `<stem>.json` is their executable animation or
Anima Pose Clip. Other self-describing JSON kinds may remain one `<stem>.json`
document. `pose-clips/` is reserved for clips intentionally reused by more than
one product; one-owner clips belong inside their Action.

Do not place private chat attachments here. They belong under the separate
private data root (`data/` by default for self-hosting). Back up PostgreSQL,
`content/local` and durable private data together. See
[storage and backup](../docs/backend/architecture/local-content-storage.md#private-data).

Animama scans only registered types and formats. Valid files become selectable,
not automatically equipped. Invalid files stay inert with diagnostics. Editing
a source never hot-swaps content already prepared by an active Anima mount.
