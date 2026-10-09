# 0017: Common web application and hosted artifact

- Status: accepted
- Recorded: 2026-10-05
- Retrospective: no
- Decision basis: owner-approved option 3 and implementation of [#272](https://github.com/raymond-van/animama/issues/272)

## Context

The extracted Anima/chat package preserves a small shared surface, while the
application's router, settings, creators, memory, voice and avatar runtime live
in `web`. Rebuilding those screens in another product shell increases drift.
Hosted identity, tenant storage, credentials and usage limits have different
owners from an accountless local installation.

## Decision

Build the existing web source through thin explicit local and hosted entrypoints
using the same router, screens and browser runtime. The hosted build becomes a
verified immutable static application alongside the public wheel/npm/contracts.
A private consumer supplies HTTP admission, sessions, tenancy, storage, providers,
quotas and operations. Animama builds/tests without private source or a Cloud
checkout. Do not require whole-application npm extraction or deployment-mode flags.

Hosted retains web workflows except Anima creation (including package import),
chat attachments, document ingestion/OCR, user provider credentials/connections,
host filesystem administration and native/Electron actions. The existing capability
schema states these permissions; browser support, asset readiness and temporary
service failures remain separate. Missing hosted implementations remain delivery work.

Model and role selection use only the consumer's admitted catalog. They are
independent of connection/catalog/key administration. This supersedes ADR 0011's
restriction of owner role choices to the local composition; its operator catalog,
credential custody and application-owned companion boundaries remain applicable.

The application owns a browser session lifetime distinct from owner ID. Revocation,
sign-out and account change dispose private browser resources before readmission.
Durable server receipts survive disconnects so committed work can be recovered.

## Rationale and consequences

One application source keeps browser behavior aligned while explicit adapters
preserve authority boundaries. The existing public packages remain useful; moving
every screen into another package is unnecessary for static artifact reuse.
This extends ADR 0005's UI reuse beyond the extracted chat surface. Its local/native
service supervision and independent native acceptance remain unchanged.

The common artifact requires a closed resource inventory, notices, supported
backend contract bounds, workers/WASM/media policy and independent consumers.
Public fixtures establish portability; actual hosted parity additionally requires
real providers, physical audio, playback, tenant isolation and release acceptance.
Implementation authority supplies no merge, paid-test, promotion or deployment approval.

## Evidence

- [Approved spec snapshot](../plans/hosted-web-parity/hosted-web-parity-spec.md)
  and [execution order](../plans/hosted-web-parity/hosted-web-parity-execplan.md).
- [Composition and resource contracts](../../contracts/hosted-web.md) and
  [action coverage](../plans/hosted-web-parity/hosted-web-parity-coverage.md).
- [ADR 0005](0005-client-rendered-ui-and-local-native-composition.md) and
  [ADR 0011](0011-application-owned-companion-features-and-composition-catalog-policy.md).
