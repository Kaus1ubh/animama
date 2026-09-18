# 0001: Independent local product and packaged sharing

- Status: accepted
- Recorded: 2026-09-17
- Retrospective: yes
- Original decision dates: 2026-08-31 (source ownership and one-way reuse); 2026-09-08 (artifact-only verification).
- Decision basis: Recorded decisions and current documented and enforced package boundaries.

Acceptance records the existing boundary. It does not establish unknown historical
human approval or authorize new implementation, deployment or publication.

## Context

The local desktop/self-host product and reusable product code need to remain
usable independently of private operated services. Keeping them in one source
tree or producing a filtered public mirror would make private-source disclosure
and contribution ownership harder to review. Repository ownership and permission
to publish are separate decisions.

## Decision

Animama owns the local product, reusable backend and frontend code, public-facing
contracts and sufficient contributor documentation. It builds and runs without
a Cloud checkout, hosted credentials or private plans. Shared code accepts
explicit composition inputs rather than importing installation state or local
application entrypoints.

Private consumers select immutable built wheel/npm/contract artifacts. They do
not import sibling source. Animama remains the source of truth for shared code;
there is no separately maintained private copy of that implementation. The
retained Discover package is inert compatibility, not an active product promise.

## Reason and consequences

The recorded historical rationale was to establish source ownership before
publication, reduce accidental disclosure from a private-to-public mirror, and
make the dependency direction reviewable. Later isolated consumers verified
that the boundary worked without access to the producing checkout.

The current trade-off is explicit version selection, packaging and compatibility
checks in exchange for independent builds and clear ownership. Convenient
cross-checkout source imports would weaken that independence. Neither artifact
tests nor this record establish hosted deployment readiness or publication rights.
Acceptance records the existing boundary; it authorizes no new release or change
to repository visibility.

## Evidence

The historical dates above summarize retained decision records; the following
self-contained repository references establish the current contract and its
enforcement without requiring access to those records:

- [Repository boundaries](../architecture/repository-boundaries.md): ownership,
  stable artifacts, private planning and publication limits.
- [Artifact tooling](../../scripts/package-sets/README.md): package-set production.
- [Python import checks](../../scripts/repository-boundary/check-python-imports.py)
  and [frontend package builds](../../src/frontend/scripts/build-typescript-package.mjs):
  executable source-boundary enforcement.
- [Mounted package checks](../../src/frontend/packages/product-ui/tests/README.md):
  isolated distribution consumption and the limits of that verification.
