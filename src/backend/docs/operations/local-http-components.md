# Local HTTP replacement components

The components in `animama.local.http` are available for isolated acceptance
tests. The shipped local factory, Electron supervisor, frozen launcher and
Compose services still use Hono and its private service assertion. No runtime
selection flag enables these components in the product. Their coordinated
cutover requires separate verification.

## Composition and ownership

`install_local_http(application, config, lifecycle=..., assets=...,
telemetry=...)` installs middleware and a principal resolver on a supplied
FastAPI application after its product routers have been registered. It does
not construct a second product runtime, read environment variables, bootstrap
a database or discover an owner. Construct it once, before ASGI startup.

The owner of installation bootstrap calls `lifecycle.mark_ready(principal_id)`
only after initialization succeeds. Until then, product requests receive 503.
Admission places an object-identity marker in server-owned ASGI state; the
resolver supplies the existing `RequestPrincipal` only for marked requests.
Browser headers, cookies and old gateway assertions never choose the owner.
Existing shared router dependencies and owner filters remain unchanged.

| Component | Responsibility |
| --- | --- |
| `config.py` | Immutable public origin, optional distinct desktop credentials, finite input limits. |
| `admission.py` | Host/Origin/Fetch Metadata checks, capability and CSRF validation, HTTP receive limits, request accounting, receive-idle WebSocket cleanup. |
| `lifecycle.py` | One completed bootstrap identity, admitted principal resolution, active-work drain without in-process resume. |
| `assets.py` | Audited build files and a separately verified active Parakeet mount; no private catalog lookup. |
| `telemetry.py` | Optional fixed-destination OTLP forwarding with bounded input, output and deadlines. |
| `protocol.py` | A narrow Uvicorn h11 hook adding the incomplete-header deadline. |
| `composition.py` | Isolated wiring, hidden infrastructure routes, preserved application lifespan and telemetry cleanup. |

For an acceptance fixture, construct `FastAPI()`, register its test/product
routers, then install `LocalHTTPConfig(public_origin="http://127.0.0.1:PORT")`
with the actual bound port. Supply a `LocalHTTPLifecycle` and mark it ready
from fixture bootstrap. Real transport tests explicitly use:

```python
uvicorn.Config(
    application,
    http=LocalH11Protocol,
    ws="websockets",
    proxy_headers=False,
    timeout_keep_alive=5,
    timeout_graceful_shutdown=15,
)
```

Bind acceptance servers to their own loopback socket. These are test assembly
instructions, not a replacement production start command. Vite proxying,
loopback publication, desktop readiness/cookie custody and native recovery are
still responsibilities of the later launcher/Compose cutover.

## Request admission

Only the configured Host (including its non-default port) is admitted.
Forwarding headers cannot replace it. A present Origin must equal the exact
configured browser origin; null/foreign origins are rejected. Fetch Metadata
may be absent, `same-origin` or `none`; an explicit composition option permits
`same-site` without relaxing Origin. Duplicate authority/security headers fail
closed. This is single-owner local admission, not remote-user authentication.

Mutating `/v1` requests require `X-Animama-CSRF: 1` and matching Origin plus
`Sec-Fetch-Site: same-origin`. The explicitly allowed same-site case also
requires matching Origin. An Origin-less operator mutation is accepted only
outside desktop composition with `Sec-Fetch-Site: none` and the CSRF marker.

Supervised desktop additionally requires the launch-specific
`animama_renderer_capability` cookie. Missing, stale, wrong and duplicate
capabilities fail. An Origin-less safe desktop request must carry `none` or
`same-origin` Fetch Metadata; desktop mutations always require Origin. Cookies
are host-scoped, not port-scoped. This validator does not install cookies or
expose either desktop secret to a renderer.

The only admitted product WebSocket path is `/v1/logs`, with exact Origin and
the same capability policy. A bounded receive pump observes disconnect even
when the existing server-push log handler is waiting for its next log item.
It cancels that WebSocket handler and awaits its cleanup. Excess unread client
messages close the connection with policy code 1008; there is no general
WebSocket proxy or HMR endpoint here.

All `/_desktop` requests need the distinct `X-Animama-Desktop-Control` secret.
They remain usable before product readiness and during quiescence, but a
renderer capability alone never grants control access. Self-host composition
denies this entire prefix and mounts no quiesce control. HTTP documentation,
OpenAPI and retired auth paths are hidden; offline `application.openapi()` is
preserved. New infrastructure routes are excluded from the public schema.

## Input bounds and drain behavior

The transport ceiling is 128 MiB, including streamed requests without
Content-Length. Declared oversize is rejected before dispatch. The receive
wrapper rejects an over-limit chunk before multipart/application parsing sees
it, and enforces a 120-second total body-receipt deadline while receiving input.
A recorded transport failure cannot be translated into a successful response
by downstream exception handling. Limit failures close the connection;
request bodies are not buffered wholesale. Existing narrower package/parser
limits remain in their owning routes. Limit/timeout failures use Starlette's
multipart error protocol so partially opened upload spools are closed. An
incomplete multipart peer disconnect follows the same cleanup path, with the
bounded `request_disconnected` code if a response can still be sent.

`LocalH11Protocol` closes incomplete headers after an absolute 15 seconds;
trickled bytes do not restart the timer. It delegates parsing to Uvicorn and
observes parser state instead of copying the parser. Initial and pipelined
headers, transfer to WebSocket, disconnect and shutdown have transport tests.
The reviewed dependency is Uvicorn 0.38.0, recorded by a test tripwire. Revalidate
the hook against a dependency update. It does not add a connection-count cap.
Transport tests retain Uvicorn's bounded `websockets` implementation; switching
to another WebSocket transport requires its own resource-limit verification.
Five-second keepalive and 15-second graceful shutdown remain distinct from the
body/header deadlines; streamed SSE output has no such response deadline.

`POST /_desktop/runtime:quiesce` closes new product admission before waiting
up to 15 seconds for active work. Controls are excluded from that count.
Repeated calls are idempotent: 200 returns
`{"schema_version":1,"state":"quiesced"}`; a timeout returns 409 with
`{"detail":{"code":"runtime_busy"}}`. A timeout or cancelled control request
does not reopen admission or cancel active product work. Successful resumption
requires a fresh runtime with the unchanged configuration.

HTTP work remains counted until its handler, stream and cleanup finish, even
when a peer disconnects. Socket closure does not promise rollback of a durable
`LocalContentMutations` commit. Before a future pack transition, Electron must
destroy product windows, request this drain, and refuse pointer changes on
`runtime_busy`; that supervisor integration is not present yet.

Admission failures retain the bounded legacy `gateway_request_rejected` code
(400/401/403/421). Readiness/drain failures use `local_runtime_unavailable` or
`runtime_quiescing` (503); transport failures use `request_body_too_large` (413)
or `request_body_timeout` (408). Errors contain no credential, principal or path
detail and use `no-store`. Existing product errors are unchanged.

## Files and telemetry

`LocalAssets` accepts one build root and an optional frozen `ModelMount` of
`ModelFile` records. The caller must verify the build and model-pack digests
before providing them. Requests use directory-relative, no-follow regular-file
opens and stream the checked descriptor. Model size/link checks do not replace
the caller's digest verification. A different build or active mount requires a
new responder instance.

Missing API, script, model, private and reserved paths never become HTML. SPA
fallback requires navigation metadata or an HTML Accept header on an eligible
extensionless route. Hidden path segments, including `.vite`, are denied.
Only fingerprinted JS/CSS files explicitly named by the hidden Vite manifest
receive immutable application caching. HTML uses a byte-derived ETag;
unversioned assets require revalidation. MIME, HEAD and conditional responses
are preserved. Ordinary static files retain Hono's full-200 response to Range.

Parakeet files are served only beneath
`/onnx/models/parakeet-tdt-0.6b-v2/` and from the exact active inventory. An
optional `v` parameter must occur once and match that active version. Model
delivery preserves digest ETags, HEAD, single byte ranges, If-Range and 416;
versioned models retain their private immutable cache policy. Authorization
runs before any static/model conditional 304. Registered Local/Included bytes
remain in the existing owner-protected product handlers.

`TelemetryForwarder` is disabled by default, as on desktop. Valid disabled
signals return 204 without reading a body or creating a collector client.
Enabled forwarding accepts only POST traces/metrics/logs, fixed composition
destinations, JSON/protobuf and identity/gzip metadata. It strips credentials,
rejects query-selected targets and redirects, and never passes collector error
bodies through. Defaults are 1 MiB raw request, 64 KiB raw collector response,
10 seconds total body receipt and 10 seconds total upstream send/drain.
Compressed bytes remain compressed. Application shutdown or failed startup
closes the client, including when the caller supplies a custom lifespan.

## Verification

From the repository root with installed frozen dependencies:

```bash
uv run --no-sync pytest -q tests/test_local_http_*.py
uv run --no-sync ruff check src/backend/animama/local/http tests/test_local_http_*.py
uv run --no-sync mypy --follow-imports=silent src/backend/animama/local/http
uv run --no-sync python scripts/repository-boundary/check-python-imports.py
```

The transport suite owns ephemeral loopback listeners and requires permission
to bind them. It uses no database or provider credentials. Other component
tests use temporary files and controlled collectors. The schema regression
test compares fresh offline schemas without bootstrapping the real app.
These checks do not establish packaged-desktop, Vite/Compose, native upgrade or
release acceptance. The existing shipped-gateway tests remain required until
their behavior is covered and the product is switched as one coordinated change.
