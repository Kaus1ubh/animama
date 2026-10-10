# 0021: Shared product HTTP routes for every composition

- Status: accepted (owner, 2026-10-10)
- Recorded: 2026-10-09
- Retrospective: no
- Decision basis: [issue #379](https://github.com/raymond-van/animama/issues/379),
  requested by the owner after [#284](https://github.com/raymond-van/animama/pull/284),
  and the [execution plan](../plans/shared-product-routes/shared-product-routes-execplan.md)

## Context

Since #284 the local and hosted compositions serve the same React build, so both
must answer the same `/v1` API. Only the application layer is shared: the hosted
consumer reuses Animama's services, repositories, contracts and chat executor, but
re-implements every product route, response serializer, SSE frame and error
mapping. An audit after #284 found about 25 behaviour differences between the two
HTTP layers (for example, hosted turns ignore the Anima's stored emotional state,
emit no phoneme payloads and have no face-part routes), and every new product
endpoint on `main` needs a hand-written hosted twin.

[ADR 0017](0017-common-web-application-and-hosted-artifact.md) and the
[hosted contract](../../contracts/hosted-web.md) require a consumer to implement
the contracts "without importing local routes". Today the product routes cannot be
imported without the local composition: handlers construct SQLAlchemy repositories
and filesystem content stores, read process-global settings and create local
directories during requests.

## Decision

1. **One shared HTTP package.** Product routes move to `animama.product_http`, a
   package that imports no local composition code. Its handlers construct no
   repositories, stores or settings; they depend on the request principal and on a
   typed ports object (`ProductPorts`) that each composition installs on its app.
   Missing ports fail closed with a stable 503.
2. **Route metadata.** Every route is classified as shared (with its stage and
   access class), local-only, or hosted-excluded (with the runtime capability that
   excludes it). A test keeps the metadata equal to the local app's route table and
   consistent with the hosted capability contract in both directions.
3. **Compositions mount, not copy.** The local composition mounts the shared
   routers with local ports and keeps its local-only routes (desktop control, logs,
   model assets and configuration, provider keys, filesystem rescan, accountless
   bootstrap). A consumer mounts the shared routers with its own ports and
   admission, and keeps its own routes (sign-in, hosted runtime context, quotas).
4. **Commit authority stays with the composition.** Write ports hand handlers a
   session whose commit the composition controls, so a hosted consumer can settle
   metering and recheck leases before a write becomes durable.
5. **Owner-strict visibility.** Shared routes have no nullable-owner exceptions; a
   record without the caller's owner is not found.
6. **Staged migration.** Foundations, then thin owner-scoped routers, then content,
   then paid utilities, then chat streaming. Each stage keeps the public OpenAPI
   operations and generated SDK unchanged and is releasable on its own; the
   consumer retires its duplicate routes per stage.

This supersedes the requirement in ADR 0017 and the hosted contract that a
consumer re-implement product routes: a consumer still never imports the local
composition, installation state or a sibling checkout, but it imports the shared
HTTP package from the published wheel. ADR 0017's single web application,
artifact, capability and authority boundaries are unchanged.

## Alternatives

- **Keep separate HTTP layers.** No refactor, but drift grows with every endpoint
  and each behaviour fix is made twice.
- **Mount the whole local app with a deployment flag.** Contradicts ADR 0017's
  rule against security-changing mode flags and exposes installation authority.
- **Generate consumer routes from OpenAPI.** Shares shapes, not behaviour; the
  differences found by the audit are behavioural.

## Consequences

- The local app's routes, operation IDs and SDK stay byte-for-byte compatible;
  route order is pinned by a test.
- Test overrides that replace only the database session move to the ports object;
  tests that call handlers directly keep working while handler names and
  parameters are preserved.
- The published wheel gains a supported HTTP surface; the boundary checks and an
  installed-wheel consumer guard its imports.

## Evidence

- [Issue #379](https://github.com/raymond-van/animama/issues/379) and the
  [execution plan](../plans/shared-product-routes/shared-product-routes-execplan.md)
  (route inventory, couplings and milestones at `42d38faf`).
