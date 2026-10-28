# Public contract inputs

This directory holds the small source inputs used to build and compare public
package sets. It is required by local builds and stays in this repository.

- [`versions.json`](versions.json) records each contract's semantic version,
  source and generated artifact filename. Changes to wire compatibility require
  the corresponding version review.
- [`runtime-owner/schema.json`](runtime-owner/schema.json) describes the neutral
  owner projection (`id` and optional `displayName`). It supplies no credentials
  or authorization; each application composition resolves its own trusted owner.
- The `local-http` entry refers to the FastAPI OpenAPI schema generated offline
  from the same source snapshot, rather than a checked-in schema in this folder.
- [Common web composition and artifact contracts](hosted-web.md) define the
  local/hosted handoff. The capability schema is backend-owned and generated in
  `local-http`; [the hosted fixture](runtime-capabilities/hosted.json) verifies the
  eight exceptions while retaining model and role choices. The same contract defines
  the immutable whole application, resource inventory and non-static Included seed.

The [package-set tools](../scripts/package-sets/README.md) copy these inputs and
produce contract artifacts alongside the Python/frontend packages, the hosted
application archive and the landing site archive. Their independent consumer and compatibility checks compare the resulting schemas and
versions against the reviewed baseline.

The frontend [`@animama/runtime-contracts`](../src/frontend/packages/runtime-contracts/README.md)
package provides the shared TypeScript owner types and generated HTTP client.
Regenerate its client through the documented offline generation workflow.
Consumers pin immutable, reviewed package sets.
