# 0028: Browser-cacheable runtime revision members

- Status: accepted
- Recorded: 2026-10-21
- Retrospective: no
- Original decision date: 2026-10-21, through the owner's approval of decision P-7 in the [scene content loading ExecPlan](../plans/scene-content-loading/scene-content-loading-execplan.md) for [#630](https://github.com/raymond-van/animama/issues/630)
- Decision basis: Explicit owner decision

## Context

A starter Anima's runtime revision names about 1,200 descriptor members. Every
mount fetched each optional member again with `cache: "no-cache"`, and the local
composition served them `private, no-cache`, so even an unchanged revision cost one
revalidation round trip per member. The documented local guidance kept the
immutable cache policy away from private content.

A runtime member's URL already names its exact revision and file
(`/v1/animas/{anima_id}/runtime/revisions/{revision}/files/{file_ref}`), and the
client verifies every member's size and SHA-256 against the issued descriptor
before using it.

## Decision

In the local composition, a runtime file response and a complete binary bundle
response carry `private, max-age=31536000, immutable`, so the browser may reuse
them for a year without revalidating. A bundle with an unavailable member stays
`no-store`. `ProductPorts.file_response` gains an `immutable` flag the shared routes
set; each composition chooses its own policy for it, and a hosted composition may
stay stricter.

`VerifiedByteLoader` and `RuntimeBundleLoader` fetch with `cache: "default"`. After
a verification failure (a size or digest mismatch, or a malformed bundle) they read
once more with `cache: "reload"` before failing the member, so a damaged cached
copy cannot stick.

Manifests, JSON bundles, previews and other private bytes keep their policies.

## Rationale and consequences

- A remount of the same revision loads its members and complete binary bundles from
  the browser cache instead of the network. A different revision (any loadout or
  content change) has different URLs and downloads again.
- Authorization is unchanged for every request that reaches the server. A cached
  member is reused without a request, so lease expiry, current access and admission
  are not rechecked for it, but only in the browser profile that already received it
  under the same revision, and it is verified again before use. The local app is
  accountless and loopback-only (ADR 0002), so that profile can already open the
  app. `private` keeps shared proxies from storing the bytes.
- Drift is still found on every mount: runtime issuance, which is never cached,
  hashes every member on disk and marks a changed file for rescan, and the
  host-notification watcher reports changes too. Only a change between issuance and
  a member's read in the same mount goes unnoticed on a cache hit, because the file
  route's and the bundle route's own drift checks (`mark_scan_required` after a
  failed verified read) run only on requests that reach the server. A client holding
  a good cached copy keeps using the exact bytes its revision names.
- A remote self-hosted installation behind an operator's authentication boundary
  (ADR 0002) keeps these cached bytes in the browser after that boundary's session
  ends, as it keeps other browser-retained data; they are keyed by revision URLs.

Alternatives considered: keep revalidation (one round trip per member per mount),
or cache only Included members (the local composition does not distinguish them on
this route, and all members are equally revision-named).

## Evidence

- [Scene content loading ExecPlan](../plans/scene-content-loading/scene-content-loading-execplan.md):
  decision P-7, the Phase 5 measurement and its reviews.
- `src/backend/animama/server/product_ports.py` (`local_file_response`) and
  `src/backend/animama/product_http/routes/anima_runtime.py`: the policy and the
  routes that set `immutable`.
- `src/frontend/web/src/lib/runtime-content/VerifiedByteLoader.ts` and
  `RuntimeBundleLoader.ts`: the cache mode and the single reload.
