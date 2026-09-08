# Discover public contract ownership

Status on 2026-09-08: public contract ownership record. The identifiers
below are **proposed and unratified**. They name intended contract families, not
implemented APIs, approved wire schemas, or released packages. Discover and
central identity still require contract ratification and implementation acceptance.
Full execution plans are private; this durable contract reference stays public.

## Repository and service boundary

The `animama` repository owns portable package formats, safe local validation,
client-visible Discover schemas, connection initiation, browsing, publishing and
acquisition clients, local receipts/materialization, and their fixtures. An
ordinary local build, test, startup, or desktop package must work with only this
repository and its pinned public dependencies. Discover and central identity
are optional external services. Clients depend on versioned contracts and
configured service origins; they never import service source or require a
private repository filesystem path.

The operated services own online identity, creator authorization, publication
and version persistence, artifact acceptance/delivery, moderation, abuse
controls, and operations. Those implementation details belong in the private
repository. Source co-location does not merge service, credential, data, or
migration ownership. Public client code cannot grant creator authority or turn
an installation principal into an online account.

## Proposed contract families

| Proposed identifier | Publicly specified surface | Producer and verification handoff |
| --- | --- | --- |
| `animama-discover-public/1` | Accountless list/detail/version/profile reads, exact-version availability, canonical share URLs, bounded preview/delivery responses, safe errors and compatibility negotiation | Discover service; publish ratified examples and verified publication/version behavior, including the canonical hosted detail-page handoff. |
| `animama-discover-creator/1` | Reviewed submission/update intent, expected publication revision, grant version, operation status/cancellation, owned listing management and explicit creator authorization failures | Discover service; ratify and prove creator authority, revision checks and durable acceptance/status behavior. The client never relies on local source metadata as authorization. |
| `animama-installed-account-connection/1` | Optional authorization initiation/completion, issuer and opaque stable account subject, least-privilege client permissions, expiry/revocation/disconnect outcomes and safe profile operations | Central identity; a verified installed-client authorization release is required for real connection integration, followed by verified lifecycle outcomes before service acceptance. |
| `animama-discover-portable/1` | Portable Anima control root, exact typed dependencies, semantic manifest, digest/provenance/grant facts, format/capability checks and rejection rules | Shared public package boundary; ratify the extension to existing `animama-content-package/2` and prove package/preview/materialization compatibility. This proposed family does not select a replacement package format version. |

Public DTOs must not contain service secrets, database layout, private object
locators, moderation internals, or operator endpoints. Publish only fields a
client needs to validate, present, or perform its operation. Private lifecycle
and service-to-service identity contracts remain private; public clients receive
only the resulting supported account/operation status.

## Compatibility and evidence

When the contract owner ratifies a family, replace its proposed status
with strict examples/schemas, named compatibility rules, fixtures, and an
immutable contract revision plus artifact digest. An implementation claiming
compatibility records the exact public contract revision it consumes. Breaking
changes require a new supported version or explicit compatibility rejection;
clients must never silently reinterpret an unknown schema or switch the exact
publication version selected for an operation.

Public tests use safe fixtures and fake transports. They must not need cloud
source, credentials, private migration graphs, or a live operated endpoint.
Separate integration acceptance uses an explicitly configured compatible
service release, two isolated accountless installations, and a verified central
identity release. Stub tests do not close that integration gate. The private
service owner supplies endpoint/version/health and acceptance evidence through
these public contracts; access to its checkout is not a local build prerequisite.

No publication, service deployment, Discover feature completion or protocol
ratification is authorized by this ownership document. Implementation scheduling
and approval history remain in private planning material. Public contributors
use this contract reference, its ratified schemas/fixtures when delivered, and
the local repository's guides without a private plan checkout. The wider
dependency direction is in [Repository boundaries](repository-boundaries.md).
