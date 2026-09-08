# Local Hono Gateway

`src/frontend/server` is the trusted Node/Hono boundary for the self-contained
desktop and self-hosted local composition. Local Better Auth, signup, sessions,
passwords, JWT/JWKS, API-key administration, and auth-triggered onboarding were
removed in accountless Phase 1. Phase 2 makes Hono the only browser-facing
application origin, and Phase 3 makes the React composition credential-free.

## Current Local Boundary

At readiness, `createFrontendApp` (also exported as
`createAccountlessGatewayApp`) loads two server-side values once:

- the migration-generated installation principal through an injected
  `InstallationPrincipalProvider`;
- a 32-byte internal token through an injected value or a mode-0600 file.

The Docker composition reads the principal from PostgreSQL after migrations and
mounts the same private token file into Hono and FastAPI. Neither value comes
from the renderer. The principal is a non-secret ownership identifier; the
token never enters HTML, JavaScript, responses, URLs, telemetry, or logs.

Hono serves or proxies:

- `GET /health`, a bounded gateway-health response;
- `/v1` HTTP, uploads, SSE, ranges, and protected bytes to private FastAPI;
- the one known FastAPI WebSocket at `/v1/logs`;
- Vite traffic and HMR upgrades in development, or built SPA files with
  navigation-only fallback;
- `POST /api/telemetry/:signal` through the bounded telemetry proxy.

In Compose development, private Vite admits the exact service hostname `web`
used by Hono. This preserves Vite's host protection while allowing the one
trusted internal proxy path; it is not a public-host wildcard.

The local composition has no deployment-mode switch. `src/index.ts` is the
supported native entrypoint and rejects a non-loopback
`ANIMAMA_LOCAL_BIND_HOST`. `src/compose-index.ts` has a hard-coded bridge-network
listener; rendered Compose validation proves that its sole host mapping is
`127.0.0.1:<gateway-port>`. Only the separate, opt-in `dev-tools` profile may
publish pgAdmin and Dozzle on literal loopback; other services stay private.

FastAPI `/health`, `/docs`, `/redoc`, `/openapi.json`, identity-provider routes,
and private `/_desktop` controls are not exposed through the gateway.

## Request Policy

Before application traffic is forwarded, Hono checks the exact configured Host
and Origin, Fetch Metadata, and a CSRF marker on state-changing `/v1` methods.
WebSocket upgrades require the exact Origin. It copies only allowlisted headers,
drops browser Authorization and client-supplied internal identity headers, then
sets `X-Animama-Principal-Id` and `X-Animama-Internal-Token` from cached trusted
state. Upstream failures and policy rejections return bounded errors without
private values or upstream addresses.

Embedded desktop additionally requires its renderer capability on every
request, including gateway health and bootstrap. Originless mutations are
rejected; originless safe requests require `none` or `same-origin` Fetch
Metadata. Request bodies are streamed with a 128 MiB default ceiling, and
client aborts cancel upstream HTTP/SSE. WebSocket close/drain tears down both
peers. The base Docker health probe remains available for internal orchestration.

The local React entrypoint installs one fetch interceptor that adds only
`X-Animama-CSRF: 1` to same-origin, state-changing `/v1` requests. It has no
session, bearer-token store, identity header, or direct FastAPI origin. Private
byte loaders use the same Hono origin and preserve their Range and integrity
checks.

## Production Asset And Manifest Delivery

`gateway/app-asset-cache.ts` is the shared server-only policy. Vite's trusted
`.vite/manifest.json` enumerates build-emitted fingerprinted JS/CSS; looking
like a hashed filename is not sufficient. Packaged `gateway/static-spa.ts`
reads that inventory from its staged SPA root. Compose keeps `web/dist` in the
private Vite service, whose `app-asset-cache` preview plugin reads its own build
inventory and applies the same policy before Hono forwards the response.
Neither the inventory nor an additional public Vite origin is exposed.

Successful GET/HEAD and conditional 304 responses for those files use
`public, max-age=31536000, immutable`. HTML, maps, mutable configuration and
unlisted files revalidate. Errors/redirects are never immutable; missing chunks
return a non-cacheable 404 without a SPA fallback, including encoded attempts
to reach the inventory. Static serving preserves MIME types and body-free
HEAD/304. Fingerprinted code uses weak file validators and Last-Modified;
HTML uses a content hash because desktop staging normalizes timestamps across
builds. Unversioned static resources keep an always-current 200 response rather
than trusting normalized timestamps. Vite preview retains its own conditional
handling. If-None-Match takes precedence over timestamp checks.
Missing or malformed build inventories degrade safely to revalidation.
Hono's origin/capability checks run before every delivered response. A new
coherent build replaces HTML and fingerprints; keep its inventory with it.

FastAPI compresses only successful runtime-manifest JSON, negotiating gzip or
identity. Hono forwards the encoded stream and its Content-Encoding, Vary,
Content-Length and representation ETag without decoding or recompressing it.
Fresh authorization and lease issuance still run for every manifest GET;
matching a content revision does not permit 304 reuse of an old lease. Private
file bytes, range streams, uploads, SSE and WebSockets are unchanged. See
[Local content runtime](local-content-runtime.md).

## Runtime Readiness

FastAPI prepares the installation at process startup. `LocalRuntimeProvider`
first reads `GET /v1/runtime-context`; a ready response mounts the app without
repeating the content scan or default creation. Only `repair_required` triggers
`POST /v1/runtime/bootstrap:ensure`, whose context response is used directly.
Concurrent initialization shares one in-flight operation, including development
Strict Mode's repeated effect setup. Completed and rejected operations are not
cached, so Retry reads current backend state and can repair again when needed.
Network or authorization failures do not trigger repair mutations.

The provider exposes the non-secret principal to
local composition through `useLocalPrincipalId()` and to shared code only as a
cache and draft partition through `RuntimeOwnerContext`; it never receives
either gateway credential. A fresh installation requires a private display name
in setup. A completed installation opens the last visited owned Anima's chat,
falling back to the first owned Anima (Annie for fresh installs). Runtime failure
presents a bounded Retry surface rather than an account or sign-in flow.

## Electron Capability

The gateway accepts an optional renderer-capability policy. Electron creates a
fresh 32-byte value on every launch and installs it as a host-only, HttpOnly,
SameSite=Strict cookie in Animama's dedicated persistent partition before the
first window loads. Docker/browser self-host mode leaves this extra check
disabled. The embedded desktop gateway receives the matching value in memory
through this existing option.

`createFrontendGateway` binds one stable loopback listener in bootstrap mode,
then promotes it using the already verified principal, internal token, static
SPA root, and private FastAPI origin. Promotion never replaces the listener.
Draining stops new product requests, bounds in-flight streams, and closes
upgraded sockets before provider restarts or shutdown. While restarting, normal
SPA document navigation (including the current deep chat route) receives the
bootstrap page; it reloads on readiness without losing its route. Bootstrap and
static delivery share the navigation classifier, so API, model, and private-byte
paths are never disguised as HTML. Browser authority checks still run first.
Disabled desktop
telemetry returns 204; no remote collector is configured by the supervisor.

When an approved Parakeet pack is active, the ready configuration also supplies
its verified file inventory and root to `src/gateway/model-pack.ts`. The fixed
`/onnx/models/parakeet-tdt-0.6b-v2/` route passes the same browser/capability
checks, serves only inventoried regular files, and supports bounded byte ranges
and ETags. Only exact `?v=<asset version>` requests receive immutable caching;
stale versions and undeclared files return 404. No arbitrary filesystem mount or
separate media origin is exposed. Pack transitions drain this listener before
replacing its ready configuration.

## Hosted Identity Boundary

Better Auth may return only in a separately composed Animama Cloud service. Its
hosted user ID, migrations, profiles, cookies, and environment variables do not
enter this local Hono package. Connecting a hosted account for Discover cannot
replace the local installation principal.

## Remote Self-Host Boundary

Animama does not provide local multi-account or network authentication. A
remotely reachable operator must keep Hono and every private service on the
container network and place an authenticated TLS reverse proxy, VPN, or tunnel
in front of loopback Hono. The gateway still validates its exact configured
public Host and Origin, but it cannot assess the outer identity policy. Every
request admitted by that operator boundary acts as the same installation owner;
external identity headers are stripped rather than mapped into Animama.

The local gateway factory, installation-principal provider, runtime-context
routes, renderer-capability policy, migrations, and environment contract are
local-only composition code. Shared React features receive only a neutral
runtime owner ID. A hosted BFF must supply its own session resolver and app
factory instead of selecting different trust behavior through an environment
flag in this package.

## Source Map And Validation

- `src/app.ts`: local gateway composition and route order.
- `src/local-config.ts`: Docker/self-host environment composition.
- `src/security/`: token, browser-request, and renderer-capability policy.
- `src/gateway/`: HTTP, WebSocket, header, and built-SPA transport adapters.
- `src/gateway/lifecycle.ts`: embedded bootstrap/promotion/drain/close lifecycle.
- `src/gateway/model-pack.ts`: verified optional model delivery.
- `src/local-principal/`: injected and PostgreSQL principal providers.
- `src/telemetry.ts`: bounded OTLP proxy.
- `src/index.ts` and `src/local-bind.ts`: loopback-only native entrypoint.
- `src/compose-index.ts`: fixed private Compose listener.
- `src/start-local-gateway.ts`: shared listener/upgrade wiring after the bind
  has been selected by one of those entrypoints.
- `../web/src/main.local.tsx`: explicit local React composition root.
- `../web/src/app/local-runtime/`: installation readiness and first-run state.
- `../web/src/app/runtime/`: neutral owner-provider interface for shared UI.

Run:

```bash
cd src/frontend
pnpm server:check
pnpm server:test
pnpm server:smoke:accountless -- --origin "$ANIMAMA_PUBLIC_ORIGIN"
```

The smoke command accepts only the public origin and never reads or prints the
internal token or principal.
