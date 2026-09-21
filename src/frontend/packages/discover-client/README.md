# Discover compatibility package

Discover and local-to-hosted account connection are discontinued. This
unpublished package stays in the existing public artifact set for compatibility
with pinned consumers. The root export retains proposed, unratified contract
identifiers; it implements no Discover requests, authorization or product flow.

The `fixtures` export constructs GET `Request` objects under one configured
HTTP(S) origin without fetching them or sending credentials. Redirects are
rejected. Fixture paths do not represent supported service endpoints.

Build with `pnpm packages:build` and run the package tests with
`pnpm --filter @animama/discover-client test` from `src/frontend`.
`pnpm packages:pack` creates local unpublished tarballs. Contract identifiers
and packaging success do not establish API compatibility or feature completion.
