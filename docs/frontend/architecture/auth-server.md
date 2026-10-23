# Local HTTP boundary

FastAPI serves the built React application, APIs and permitted bytes from one
application origin. There is no frontend Node server in a desktop or built
self-host installation. Electron still uses Node for its main process.

Compose development publishes Vite with hot reload. Its closed proxy forwards
application API, health, telemetry and log-WebSocket traffic to private FastAPI
without changing Host, Origin or Fetch Metadata into trusted identity. Vite
serves development assets and HMR; FastAPI authorizes application requests.

## Composition and ports

- Packaged desktop: Electron supervises PostgreSQL, FastAPI and enabled workers.
  FastAPI owns the saved loopback port and serves the audited React build.
- Built self-host: `docker-compose.yml` bakes React into the application image;
  FastAPI alone publishes `127.0.0.1:${WEB_SERVER_PORT:-8000}`.
- Development: `docker-compose.development.yml` removes FastAPI's host mapping
  and publishes Vite at that same application port.
- External-stack Electron development opens `ANIMAMA_DESKTOP_WEB_URL`.

`reset.sh` selects the graph using `ANIMAMA_WEB_BUILD_MODE=development` (default)
or `production`. This is a build/serving selection. Source the generated
`.animama-stack.env` before follow-up Compose commands; it records `COMPOSE_FILE`,
project identity, ports and isolated storage. PostgreSQL and workers stay private.
Optional `dev-tools` publishes only loopback pgAdmin and Dozzle separately.

## Request policy and ownership

The local ASGI boundary checks exact configured Host and Origin, Fetch Metadata,
and `X-Animama-CSRF: 1` for application mutations. The only product WebSocket is
`/v1/logs`; it requires the configured Origin. The boundary writes successful
admission into server-owned request state. The installation principal resolver
uses that state only after completed bootstrap. Client headers cannot choose
an owner. Admission is local to the FastAPI process.

Supervised desktop also requires the launch capability cookie on product
requests. Private desktop operations require a separate control credential;
a renderer cookie does not authorize controls. Self-host composition does not
mount desktop controls. HTTP `/docs`, `/redoc` and `/openapi.json` remain disabled;
`pnpm openapi-ts` uses the deterministic offline exporter.

Request bodies have a 128 MiB transport ceiling, including streamed requests
without Content-Length, before multipart parsing. Route/package limits may be
stricter. Partial multipart files are closed on limit/disconnect. SSE remains
incremental and WebSocket disconnects clean up their handlers. An ordinary HTTP
client disconnect does not cancel a durable mutation already owned by FastAPI.
The native, Compose and frozen launchers use the reviewed H11 protocol with a
15-second header deadline, five-second keepalive and 15-second shutdown grace.

React uses `window.location.origin` for the generated client and protected byte
loaders. Its fetch interceptor adds only the mutation CSRF marker. It has no
local session, bearer store, owner header or separate API origin.

## Static and model delivery

The local asset adapter serves only explicit build/model roots, checking
containment, regular files and file identity through opened descriptors. Only
navigation requests may fall back to the SPA. Missing API, script, model or
private-file routes never return HTML. Hidden build inventories are not public.

Vite emits `.vite/manifest.json`. Only successful inventory-listed fingerprinted
JS/CSS gets one-year immutable caching. HTML uses a content hash and revalidates;
unlisted mutable resources do not gain immutable caching by resembling a hash.
Missing or malformed inventories degrade safely. MIME types, HEAD and conditional
responses are preserved. Registered content retains its existing authorization,
integrity and range handling.

With `ANIMAMA_PARAKEET_SOURCE=asset-store`, the optional Parakeet mounts are
resolved on each request from the installed model-asset sets, with their exact
version and validated file inventory; with `operator`, FastAPI serves no models
because Vite serves the host sets. The fixed `/onnx/models/parakeet-tdt-0.6b-v2/` and
`/onnx/models/parakeet-tdt-0.6b-v2-webgpu/` routes serve only those regular
files, including single byte ranges and If-Range. Exact `?v=<version>`
requests may be immutable; stale versions and undeclared files return 404.
Static application assets retain full-response behavior for Range requests.

Runtime manifests retain scoped gzip, representation ETags and fresh lease
issuance on each authorized read. The development proxy preserves encoded bytes;
there is no second production proxy. See [Local content runtime](local-content-runtime.md).

## Readiness, recovery and desktop controls

FastAPI prepares the installation at startup. React reads `/v1/runtime-context`
and requests bootstrap only for `repair_required`. Concurrent reads/repair share
one in-flight operation; Retry reads current state. A ready context supplies the
non-secret owner through `RuntimeOwnerContext`. First-run setup, saved chats,
Local content and the last visited Anima remain installation-owned.

Electron verifies private readiness against its exact spawned process/start
token, build identity, local HTTP schema and installation principal before
installing a host-only HttpOnly SameSite=Strict capability cookie or navigating
any product window. An occupied saved port opens independent recovery rather
than silently changing the origin. The persisted `{version: 1, gatewayPort}`
representation stores FastAPI's application port under the `gatewayPort` key.

For restart and pack transitions Electron retains a validated application route,
destroys product windows and their workers, and shows its independent recovery
window. Token-authenticated `POST /_desktop/runtime:quiesce` closes new product
admission and waits up to 15 seconds for active work. It is idempotent and leaves
controls available. `runtime_busy` prevents the transition; failed transitions
restart the prior configuration. Resuming admission requires a backend restart.
The runtime manifest is `animama-desktop-runtime/2` with
`local_http_schema_version: 1`; this changes packaged resources, not user data.

## Telemetry and remote access

The bounded `/api/telemetry/{signal}` forwarder accepts only configured OTLP
destinations. It limits request/response bytes and receive/upstream time and
never forwards credentials. Desktop disables forwarding with 204. The local
composition never advertises the `browser_telemetry` runtime capability, even when
this forwarder is enabled, so the browser registers no exporter and posts nothing
to it. See [browser telemetry](overview.md#browser-telemetry).

Remote self-hosting requires an operator-owned TLS and authentication boundary
in front of the loopback application. Configure its exact public origin. Every
admitted request remains the same installation owner; forwarded identity headers
do not create Animama accounts. Hosted identity is a separate, deferred service.
Discover and local-hosted account connection are discontinued.

## Implementation and validation

Backend composition lives in `src/backend/animama/server/local_http.py` and
`src/backend/animama/local/http/`. Vite proxy configuration lives in
`src/frontend/web/vite.config.ts`; Electron supervision lives under
`src/frontend/desktop/src/main-process/runtime/`.

From the repository root, run focused boundary and app-composition tests:

```bash
uv run pytest -q tests/test_local_http_*.py tests/test_local_app_composition.py
```

Also run frontend checks, web and desktop tests, both Compose configuration
checks and the supported browser/native journeys in the scoped guides. Transport
unit evidence does not replace first-run, upgrade or recovery acceptance.
