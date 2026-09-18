# 0004: Readable filesystem content and recoverable catalog mutations

- Status: accepted
- Recorded: 2026-09-17
- Retrospective: yes
- Original decision dates: 2026-08-21 (readable library); 2026-09-07 (shared recoverable mutations).
- Decision basis: Recorded decisions, current storage contract and inspected implementation.

Acceptance records the existing boundary. It does not establish unknown historical
human approval or authorize new implementation, deployment or publication.

## Context and decision

Keep content bytes in a readable Included/Local filesystem library. Included
sources are immutable; Local supports ordinary files, typed creator saves and
operator edits. PostgreSQL owns catalog identity, access scope, revisions,
bindings and operation receipts. Source partition is distinct from ownership.

Coordinate Local Save, Delete, Import and Rescan through `LocalContentMutations`.
A source transaction lock covers publication, reconciliation and the durable
success receipt. Filesystem journals and retained originals support compensation;
the committed database receipt determines whether recovery finalizes work or
restores it. Filesystem and database changes do not share a literal transaction.

## Reason and consequences

Current rationale: ordinary content remains understandable outside the product,
while catalog validation, ownership and exact revision checks protect application
use. Logical loadouts and leased runtime snapshots resolve content for playback
without making arbitrary host paths a browser API.

Recovery must preserve manual edits and recovery copies when restoration
conflicts, rather than guessing which bytes are authoritative. Journals are
recovery evidence, not disposable caches. The catalog is not wholly rebuildable
metadata: ownership, bindings and successful-operation receipts matter too.
Backup and restore must preserve the cooperating data authorities.

Save and Import retries with the same owner-scoped operation identity and
complete request return the original successful result without repeating writes.
That result may describe content changed or deleted later. Delete retains its
own HTTP contract while using internal recovery identity.

Compared with an opaque byte store, readable files permit direct operator changes
but require scanning, containment and integrity checks. Compared with independent
file and database writes, coordinated journals and receipts add recovery work but
avoid treating partial publication as success.

## Evidence and historical limits

Observed implementation: [mutation coordinator](../../src/backend/animama/app/services/local_content_mutations.py),
[filesystem store](../../src/backend/animama/adapters/content_store/filesystem_store.py),
and [catalog repository](../../src/backend/animama/adapters/repositories/sqlalchemy/content_catalog_repo.py).
The [storage contract](../backend/architecture/local-content-storage.md) describes
current custody, replay, recovery and backup behavior.

Recorded historical rationale on 2026-08-21 favored an understandable, portable
library that operators could back up and manage without persistence internals.
The 2026-09-07 decisions extended recovery across Save and Delete while retaining
Import's closure guarantee, and selected committed receipts to distinguish
successful work from work needing restoration. These are recorded decision
dates, not evidence of release acceptance or a comprehensive evaluation of every
storage alternative.
