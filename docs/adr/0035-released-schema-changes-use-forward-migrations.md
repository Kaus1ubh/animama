# 0035: Released schemas change only through forward migrations

- Status: accepted (owner, 2026-11-12)
- Recorded: 2026-11-12
- Retrospective: no
- Original decision date: 2026-11-12 (owner agreement in
  [#875](https://github.com/raymond-van/animama/issues/875))
- Decision basis: Explicit owner decision

## Context

During development, the local schema had a single Alembic revision,
`baseline_20260908`, whose SQL artifact was edited in place for every schema
change. Developers reset their databases to pick changes up. Signed desktop
previews have since been published, and their installed profiles all carry
that one revision. When #872 added `anima_chat_profiles.reasoning_effort` by
editing the baseline, the 0.1.3 preview reported the same head as 0.1.2.
Alembic had nothing to run, and the desktop supervisor's schema-digest check
stopped 0.1.2 profiles with `database_schema_mismatch`. A release that cannot
upgrade the previous release's profile cannot pass its acceptance check
`update_preserves_local_state`.

## Decision

1. **The baseline is frozen at the schema released in desktop 0.1.2.**
   `0001_baseline.sql` matches that release byte for byte, and a test pins its
   SHA-256.
2. **Every later schema change is a new Alembic revision** on a single linear
   chain. A revision upgrades an existing database in place, imports no live ORM
   metadata, and lands together with its ORM change. The first is
   `reasoning_effort_20261112`.
3. **Merged revisions are never edited.** Installed profiles may already carry
   them; a correction is another revision.
4. **A test compares the ORM with the migrated schema**, so an ORM change to
   tables, columns, types, nullability, server defaults, indexes, or unique and
   foreign-key constraints fails without a revision. Six legacy objects whose
   ORM and baseline names differ are listed explicitly. CHECK constraints and
   index predicates are not compared and need review by hand.

## Alternatives

- **Keep editing the baseline and reset profiles on upgrade.** That discards
  owners' chats, memory and settings on every schema change.
- **Repair schema drift at startup.** Ad hoc DDL outside Alembic would hide the
  real history, and the digest check would still need a reviewed target.
- **Squash a new baseline for each release.** Every installed profile would then
  need a bridge from its own baseline, which is a migration chain under another
  name.

## Consequences

- Upgrades run through the existing desktop path: a pre-migration snapshot,
  `alembic upgrade head` in database bootstrap, then the schema-digest check.
- A revision must leave an upgraded profile with exactly the schema of a fresh
  database. Column order counts, because the digest hashes `pg_dump` output.
- Development databases created from an older edit of the baseline (before it
  was frozen) still need a reset. Profiles created by the 0.1.3 preview have
  `reasoning_effort` in a different column position and stop with
  `database_schema_mismatch`; pre-launch previews get no repair.
- Earlier specs and plans that say "no Alembic revision" describe the old rule.

## Evidence

- [#873](https://github.com/raymond-van/animama/issues/873): the 0.1.3 preview
  and its stable blocker.
- `tests/test_alembic_fresh_install.py`: frozen-baseline fingerprint, linear
  history, released-profile upgrade and ORM drift checks.
