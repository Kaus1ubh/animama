# Runtime contracts

This unpublished public-source package owns neutral owner, capability, lifecycle
and HTTP transport types plus the backend-generated SDK. It contains no local
origin, installation startup, Electron, service credentials or hosted identity
composition.

Use `@animama/runtime-contracts` for runtime contracts,
`@animama/runtime-contracts/sdk` for generated operations and `createClient`,
`@animama/runtime-contracts/api-types` for DTOs, and
`@animama/runtime-contracts/validators` for generated response validation.
Create one API client from each provider's injected `ProductApiTransport` and
pass it explicitly to SDK operations. The `default-client` export preserves the
local web adapter's singleton; its
configuration remains in the local app and must not configure another provider.

From `src/frontend`, run `pnpm openapi-ts` to regenerate `src/generated` from
the backend's offline schema exporter. Set up the backend environment first;
the exporter uses the existing environment without a network dependency sync.
Never hand-edit generated files or copy them into a private consumer.

`pnpm packages:build` emits JavaScript and declarations. `pnpm packages:pack`
creates unpublished tarballs under `.artifacts/public-packages`; use
`--destination DIRECTORY` for another location. The packed package contains
`dist`, including the existing proprietary notice, and no application source.
A consumer needs only the packed artifacts and declared dependencies.
