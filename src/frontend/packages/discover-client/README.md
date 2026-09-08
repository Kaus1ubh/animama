# Discover client contract boundary

This unpublished package establishes a public build boundary while Discover's
protocol remains proposed and unratified. The root export names proposed
contract families and explicitly records their status. It does not implement
Discover requests, account connection, authorization or feature behavior.

The `fixtures` export constructs inert, credential-free GET `Request` objects
for fixture paths under one configured HTTP(S) origin. It never fetches a URL,
selects an API endpoint, sends tokens or treats a fixture path as a supported
Discover route. Redirects are rejected. Use these objects with test transports
until the owning contracts are ratified.

Build with `pnpm packages:build` and run the package tests with
`pnpm --filter @animama/discover-client test` from `src/frontend`.
`pnpm packages:pack` creates local unpublished tarballs. Contract identifiers
and packaging success do not establish API compatibility or feature completion.
