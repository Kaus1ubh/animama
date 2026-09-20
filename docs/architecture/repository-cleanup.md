# Repository cleanup and measurement

Cleanup preserves the supported local application, stable package contracts and
required runtime assets. Remove a dependency or file only after checking its
imports, scripts, packaging, generated inputs, runtime assets and independent
builds. Search and unused-code tools identify candidates; they do not establish
that deletion is safe.

## Where material belongs

- `docs/backend` and `docs/frontend` contain current implementation and operator
  guides. Cross-cutting deployment and ownership guidance stays here.
- `contracts` remains an active local build/check input and does not require a
  Cloud checkout.
- License notices and attribution stay with the relevant source. Preserve their
  rights dispositions during moves; refresh source-license review coverage when
  preparing a release candidate.
- Private plans, historical cleanup measurements, split receipts and maintainer
  backlog are retained privately, outside the contributor documentation.
- Generated output and caches are separate from source. Never classify durable
  installation data, Local content, receipts, vaults or databases as disposable.

## Measuring a change

The [measurement tools](../../scripts/repository-cleanup/README.md) pin `scc`,
record exact source/rule hashes and distinguish authored source, tests,
generated files, vendored material and assets. Keep before/after inputs and
rules comparable. Report what was actually measured; documentation relocation
is not a runtime performance improvement.

Use Knip and Vulture as review aids, then verify each proposed removal against
real consumers. Retained compatibility fixtures, provider adapters, native
packaging inputs and framework callbacks can appear unused to a scanner.
Independent wheel/npm builds and supported desktop/self-host journeys are
necessary checks when cleanup touches their boundaries.

For startup or serving changes, compare the same hardware, content, optional
packs and workload. Separate first installation from unchanged launches and
recovery. Record service/document readiness, idle CPU, process-group memory,
download and installed sizes. Do not trade integrity or recovery checks for an
unmeasured speed claim.

## Validation and publication

Use the relevant subsystem guides and `make help` to select checks. Record
inherited failures and unrun native/audio journeys explicitly. A green lint or
scanner result does not replace behavior verification or establish licensing
permission. The working checkout stays proprietary until a separately reviewed
source candidate satisfies publication requirements; see
[repository boundaries](repository-boundaries.md).
