# Discover compatibility package

Discover and local-to-hosted account connection are discontinued. This
unpublished package stays in the existing public artifact set for compatibility
with pinned consumers. The root export retains proposed, unratified contract
identifiers; it implements no Discover requests, authorization or product flow.

The `fixtures` export constructs inert, credential-free GET `Request` objects
for fixture paths under one configured HTTP(S) origin. It never fetches a URL,
selects an API endpoint, sends tokens or treats a fixture path as a supported
Discover route. Redirects are rejected. These objects are for inert compatibility
tests, not integration with an operated service.

Build with `pnpm packages:build` and run the package tests with
`pnpm --filter @animama/discover-client test` from `src/frontend`.
`pnpm packages:pack` creates local unpublished tarballs. Contract identifiers
and packaging success do not establish API compatibility or feature completion.
