# Pre-publication security hardening

Source agreement: [the spec](pre-publication-hardening-spec.md), agreed by the
owner on 2026-11-03, with three security-review refinements added the same day
(R3.3's switch list, R3.6's throwaway profile, R4.6 on redirects) that this
plan presented and the owner approved with it. Authority:
[#838](https://github.com/raymond-van/animama/issues/838), a sub-issue of #819;
the spec file is its snapshot.
Authorized scope: the whole plan (G0 approved by the owner, 2026-11-03).

## Purpose and context

One branch (`fix/pre-publication-hardening`) and one PR deliver four hardening
changes before the repository is published. The spec owns the required
behavior (R1 to R4); this plan owns how it is built and checked. Checks on
downloaded update artifacts (formerly R5) are out of scope: no later desktop
build checks for updates (Decision Log, 2026-11-04). Hosted CI
(`Portable product validation`) stays disabled, so local checks are the
evidence.

Starting point: `origin/main` at `dacf928c4`, which already contains #834
(markdown shows only app-served images) and #835 (update requests send only
the headers they need; Memory Manager tracing is off on desktop).

Orientation, by requirement:

- **R1, security policy.** `SECURITY.md` at the repository root. The
  open-source readiness plan
  ([its Phase 3](../open-source-readiness/open-source-readiness-execplan.md))
  will move it to `.github/SECURITY.md`; this work edits whichever path `main`
  has when Phase 1 starts and gives that work the final wording for its issue
  form links.
- **R2, Content Security Policy.** FastAPI serves the built web app through
  `LocalAssets` in `src/backend/animama/local/http/assets.py`
  (`_static_response` builds the headers for every built file, including the
  `index.html` fallback for app routes). Stored bytes go through
  `verified_file_response` and `PackageDownloadResponse` in
  `src/backend/animama/product_http/delivery.py`, which the local and hosted
  compositions share. `contracts/hosted-web.md` already specifies the hosted
  entry policy and the Pocket worker exception, and
  `scripts/repository-boundary/consumers/hosted-app/server.mjs` implements it
  for the hosted fixture. Development serves the page from Vite
  (`src/frontend/web/vite.config.ts`), not FastAPI. The renderer's only
  direct outside connections today are the Pocket voice-sample previews
  (`web/src/lib/speech/pocket/voice-catalog.ts`; `huggingface.co`, which
  redirects to its `*.hf.co` download CDN) and the ElevenLabs realtime socket
  (`web/src/hooks/use-elevenlabs-tts-runtime.ts`; `wss://api.elevenlabs.io`).
  The OpenRouter model list is fetched by the backend.
- **R3, Electron.** `src/frontend/desktop/electron-builder.yml` has no
  `electronFuses`; a packed 0.1.1 app reads RunAsNode, `NODE_OPTIONS` and
  inspect arguments on, cookie encryption, asar integrity and
  only-load-from-asar off, and file-protocol extra privileges on. electron-builder
  26.18 flips fuses after `afterPack` and immediately before signing, with
  `@electron/fuses` 1.8.0, and already writes `ElectronAsarIntegrity` into the
  macOS `Info.plist`. Windows are created in `window/create-window.ts`,
  `pip/pip-window-manager.ts`, `quick-chat/quick-chat-window-manager.ts` and
  `runtime/recovery.ts`; the View menu's DevTools item is in
  `ui/application-menu.ts`. Packaged development overrides are refused in
  `runtime/paths.ts` (`prepareDesktopIdentity`). The release smoke
  (`scripts/runtime/smoke-journey.mjs`, with `smoke-macos.mjs`,
  `smoke-windows.mjs`, `ci-smoke.mjs` and the VM helper under `scripts/vm/`)
  drives the installed app with Playwright's `_electron.launch`, which passes
  `--inspect=0 --remote-debugging-port=0` and needs the Node inspector.
  `scripts/native/test-global-input-hook.mjs` runs the packaged Windows
  executable as Node. `scripts/runtime/audit.mjs` audits the stage before
  packing and runs the *staged* Electron as Node, which keeps Electron's
  default fuses, so it is unaffected.
- **R4, keys.** Allowed key references are in
  `src/backend/animama/app/model_clients/credential_store.py`
  (`KNOWN_PROVIDER_CREDENTIAL_ENVS`, `MANAGED_CREDENTIAL_ENV_PATTERN`,
  delivery validation) and resolved per request by
  `StoreModelCredentialResolver` in `credentials.py`, which every model client,
  probe, model listing, embedding and Memory Manager path uses.
  `model_configuration_service.py` validates base URLs and credential settings
  at save; `server/routers/model_configuration.py` reports `credential_state`.
  The desktop vault (`desktop/src/main-process/runtime/vault.ts`) keeps
  connection keys by variable name and delivers them as environment names; its
  IPC types live in `src/frontend/shared/desktop-runtime.ts`. The connection
  form is `web/src/ui/settings/models/ModelConnectionDialog.tsx`, and
  `model-configuration-state.ts` already treats loopback names,
  `127.0.0.0/8`, `::1` and `host.docker.internal` as this computer. Clients
  that send a key in a custom header: ElevenLabs (`xi-api-key`, over an httpx
  client with `follow_redirects=True`), the Anthropic SDK (`x-api-key`),
  Gemini (`x-goog-api-key`) and Brave web search (`X-Subscription-Token`).

Boundaries: other review findings, GitHub settings, Cloud, the desktop version
and release policy stay out (spec non-goals). Generated clients are not
hand-edited; Prettier is not run on Markdown. Public records describe the
hardening, not how a weakness could be used.

## Progress

- [x] Spec agreed (2026-11-03).
- [x] G0: owner approved this plan, including the three review refinements
  (2026-11-03).
- [x] Workspace (2026-11-03): parent issue #838 (sub-issue of #819), branch
  `fix/pre-publication-hardening` from `dacf928c4`, plan and spec snapshot
  committed.
- [x] Phase 1: security policy (light; review folded into the final review).
- [x] Phase 2: Content Security Policy and sandboxed stored bytes (review #2
  passed; one repair round).
- [x] Phase 3: keys bound to their provider and address (review #5 passed;
  two repair rounds plus two owner-approved rounds).
- [ ] Phase 4: Electron fuses, debugging guard, DevTools and the smoke copy.
- [ ] Final integration review.
- [ ] Final validation: full pre-push suite, browser journeys, packed-app
  checks (G1 for paid calls).
- [ ] PR opened with local evidence.

## Surprises & Discoveries

- `audit.mjs` checks the stage before packing and runs the staged Electron,
  not the packed app, so it cannot read a packed fuse wire. The packed-app
  fuse assertion therefore lives in the packaging checks that see packed apps
  (Phase 4), not in `audit.mjs`.
- Playwright's `_electron.launch` waits for the Node inspector's "Debugger
  listening" line before it attaches, so it cannot drive an app whose inspect
  fuse is off. Connecting over the remote-debugging port alone would still need
  a switch that a shipped app refuses.
- The packaged app always uses the canonical profile
  (`~/Library/Application Support/Animama`) and rejects the development
  user-data override, so packed apps are not launched on the owner's own
  account during this work; they run in disposable VM clones.
- `@electron/fuses` 1.8.0 reads Electron 45's ninth fuse
  (`WasmTrapHandlers`) without a name; the expected wire includes it at
  Electron's default.
- Phase 2 sweep: the only violation was Zod 4's start-up probe for string
  evaluation (`try { new Function("") } catch {}`), which Chromium reports as a
  violation on every page although the probe is caught. Zod reads its
  `jitless` setting when each object schema is created, so the app sets it in
  a module that both entries import first (`web/src/lib/zod-runtime.ts`).
  Under the policy Zod already parsed without generated code; the setting only
  stops the probe.
- Chromium logs refused loads and connections on the console, but a refused
  evaluation only as an Issue and a `securitypolicyviolation` page event, so the
  journey check also repeats page events on the console.
- Chrome's fake microphone cannot read its sample file while the audio-service
  sandbox is on; the sweep's throwaway test browser disabled only that sandbox.
- Phase 3: the Anthropic SDK (`x-api-key`), the Gemini SDK's Interactions client
  (`x-goog-api-key`) and the ElevenLabs pool (`xi-api-key`) all follow
  redirects, and httpx keeps those headers on a cross-origin one. The OpenAI
  SDK's httpx2 client follows redirects too but drops `Authorization`. Brave and
  the other keyed clients use httpx's default of not following redirects.
- Phase 3 review: in a shuffled run of the backend selection, an Anthropic
  test that hides two built-in rows in the shared test database makes a model
  benchmark test fail when it runs first. Both are unchanged here (follow-up).
- Phase 3: with no transport of its own, the Gemini SDK sends its other
  resources through aiohttp; Interactions, the only resource Animama calls,
  always uses the SDK's httpx client, which is where the hook is installed.

## Decision Log

- 2026-11-03, owner: one ExecPlan, one branch, one PR for R1 to R5.
- 2026-11-03, owner: best-effort response time; the OpenAI key goes only to
  `api.openai.com`; connection keys are bound to the origin saved with them;
  the release smoke uses a harness-made, inspect-enabled copy for its journey.
- 2026-11-03, owner: pre-launch, so no migration for earlier installations.
- 2026-11-03, owner (from earlier sessions): per-phase checks are targeted;
  the full pre-push suite runs once on the final candidate, which this plan's
  approval authorizes. Each VM run with real provider calls needs the owner's
  go-ahead (G1).
- 2026-11-03, security review: the smoke copy gets a throwaway profile and is
  deleted after the run; the debugging switch list is named; keys never follow
  cross-origin redirects. Presented with this plan.
- Agent: the throwaway profile reuses the existing development user-data
  override, which a packaged app accepts only while its Node inspector runs,
  the same condition that admits debugging switches. A shipped app can meet
  neither.
- Agent: the copy-based journey is a release-smoke mode, not a development
  bypass. Before a signed candidate exists, it is exercised against a local
  development pack by an uncommitted harness whose results are recorded here.
- Agent (superseded 2026-11-04, R5 dropped): the real-Electron local feed
  check (R5.3) uses an uncommitted harness, as #835 did, because it patches
  electron-updater's packaged-app detection; the committed adapter tests cover
  the same decisions.
- Agent (superseded 2026-11-04, R5 dropped): the update artifact checks reuse
  the existing `update_download_invalid` code, so no new update text is
  needed.
- 2026-11-03, owner: G1 approved as planned (built-stack sweep: at most 20
  short OpenAI chat turns and three ElevenLabs replies; VM: at most three
  smoke-journey runs).
- 2026-11-03, owner: allow `data:` connections (R2.1 amended in #838): the
  Library's Pose preview and unsaved-Action previews fetch inline clips, and
  model files may embed data; such data never leaves the device.
- Agent: Zod runs with `jitless` everywhere, development included, so built and
  development parsing behave the same.
- Agent: R4 adds no API field; `credential_state` stays `missing` for a key
  that cannot be used at the connection's address, and the connection form
  explains what to do. New save refusals get stable codes and translated
  messages.
- Agent (Phase 3): the connection form now blocks saving a key over plain HTTP
  to another computer (it used to warn), because the backend refuses that save.
- Agent (Phase 3): the Gemini builder takes a `transport` for tests instead of
  a whole client, so tests run through the same client arguments, hook
  included; the SDK still builds and closes its own client.
- Agent (Phase 3): a malformed origin in a desktop change is
  `credential_origin_invalid`; an origin without a value, or on a provider key,
  is `credential_changes_invalid`. Origins are not added to log redaction.
- 2026-11-04, owner: one extra repair round for Phase 3's look-alike host
  finding, failing closed: no key matches a non-ASCII host name, and owners
  write such names in their ASCII (`xn--`) form. One more independent recheck
  before committing.
- 2026-11-04, owner: R5 (update-download checks) is dropped from #838. #837
  builds 0.1.3 as the final release after #838 with update checks sealed off,
  so no later desktop build checks for updates; checks on downloaded update
  artifacts are out of scope, and a build that re-enables updates should add
  them. Phase 5 and its acceptance items are removed; R1 to R4 and the final
  integration review are unchanged.
- 2026-11-04, owner: fix review #4's user-information finding with strict
  parsing and one more independent recheck before committing.
- Agent (Phase 3 review): R4.3 covers keys that owner connections name. The
  built-in OpenAI connection keeps sending `OPENAI_API_KEY` to the operator's
  `OPENAI_BASE_URL` (R4.1, plan step 2), which no API request can change.

## Phased implementation

Every phase starts from the previous phase's commit on
`fix/pre-publication-hardening`. Phase commits use
`<type>(<scope>)[p#]: <summary>`. Each phase records its check record
(command, directory, result, Git tree) and review below. Per the owner's
direction, phases run targeted checks only; the full pre-push suite runs once
in final validation.

### Workspace setup

Use `implement` → `workspace-setup` in this worktree
(`worktrees/animama/pre-publication-hardening-7b5c0d`):

1. Verify the worktree is clean at `dacf928c4` or a later `origin/main`;
   rename `claude/pre-publication-hardening-7b5c0d` to
   `fix/pre-publication-hardening` (no push yet).
2. Publish the agreed spec as a parent issue with the parent form's sections,
   attach it as a native sub-issue of #819, read it back, and mark the spec
   file as a snapshot of that issue.
3. Add `licenses/source-review.json` entries for the new spec and plan files
   (original-work attestation, as their neighbours) and run
   `python3 scripts/public-release/check_source.py`.
4. Prepare dependencies: `uv sync --python 3.12.13` at the root,
   `pnpm install --frozen-lockfile` in `src/frontend`, `git lfs pull` before
   any stage or full backend suite. Check `orb status` (OrbStack) before
   backend tests.
5. Commit `docs(security)[p0]: plan pre-publication hardening` with the spec
   snapshot, plan and licence entries.

Record (2026-11-03): worktree
`worktrees/animama/pre-publication-hardening-7b5c0d`, branch
`fix/pre-publication-hardening` at `dacf928c4` (`origin/main`), issue #838.
`check_source.py` found three VM smoke scripts from #833 without entries on
`main`; they get the original-work entries their neighbours have, so the check
passes (`licenses/source-review.json covers every tracked file exactly once`).
No stack is running for this task yet.

### Phase 1: Security policy

Review tier: light (documentation only); its review folds into the final
integration review.

Requirements: R1.1 to R1.7.

Steps:

1. Check which path `main` has (`SECURITY.md` or `.github/SECURITY.md`) and
   edit that file. Write sections for: how to report (GitHub private
   vulnerability reporting on this repository, or `security@animama.ai`), what
   not to do (no public issue, pull request or discussion), what to include
   (affected version or commit, platform, steps, impact, and no real keys or
   personal data), response expectations (best effort, no promised time;
   the maintainer acknowledges and coordinates disclosure), supported versions
   (latest published desktop release and `main`), scope and out of scope, and
   self-hosting on shared computers (the loopback API has no credential, so
   any account on the computer can use it; use a computer only you use or put
   your own authentication in front; the desktop app's local server admits
   only its own windows). Link
   [local deployment](../../architecture/deployment-topology.md) for exposure
   beyond the computer.
2. Search current documents for statements that contradict it
   (`rg -n -i "vulnerab|security@|private vulnerability" --glob '!docs/plans/**'`)
   and fix only real contradictions.
3. Send the final wording to the open-source readiness session for its
   `config.yml` link text, and record it in the shared notes.

Checks: relative links resolve (`rg` for each new link target); no Prettier on
Markdown; `check_source.py` if a path changed.

Completion: the policy states every R1 item; commit
`docs(security)[p1]: name the private reporting routes`.

Check record (2026-11-03):

- `SECURITY.md` at the root (`main` had not moved it). Every R1 item is
  present: both routes, no public reports, report contents, best-effort
  responses, supported versions, scope, the shared-computer note.
- Contradiction search over current documents (plans excluded): only the old
  `SECURITY.md` text matched; `README.md`, `SDLC.md` and the parent issue form
  point to the file without restating it.
- Link targets: `docs/architecture/deployment-topology.md` exists; the GitHub
  reporting form answers once private vulnerability reporting is on
  (publication day).
- Review: light tier, folded into the final integration review.

### Phase 2: Content Security Policy and sandboxed stored bytes

Review tier: high risk (a security boundary and shared delivery code).

Requirements: R2.1 to R2.5.

Steps:

1. Tests first (`tests/test_local_http_assets.py`): the entry document, an
   app route's `index.html` fallback, a fingerprinted module script, a
   Vite-emitted worker asset, a `304` revalidation and
   `tts/workers/inference-worker.js` each carry the policy; only the Pocket
   worker's policy contains `'unsafe-eval'`; model mount files are unchanged.
   Delivery tests (`tests/test_local_content_delivery.py`,
   `tests/test_anima_runtime_delivery.py` and the package export tests)
   expect `Content-Security-Policy: sandbox; default-src 'none'` on content
   files, Included files, previews, runtime members and package export
   downloads.
2. In `assets.py`, define the policy once and add it in `_static_response`:

   ```text
   default-src 'none'; script-src 'self' 'wasm-unsafe-eval';
   style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:;
   font-src 'self'; connect-src 'self' blob: data: https://huggingface.co
   https://*.hf.co wss://api.elevenlabs.io; media-src 'self' blob:;
   worker-src 'self' blob:; frame-src 'none'; frame-ancestors 'none';
   object-src 'none'; base-uri 'none'; form-action 'self'
   ```

   The exact Pocket worker name gets the same policy with
   `script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'`. Sources are added
   only when the live sweep (step 5) shows a real need, and each addition is
   recorded under Surprises & Discoveries.
3. In `delivery.py`, add the sandbox policy to `verified_file_response` and
   `PackageDownloadResponse`.
4. Add a check to the browser journeys' evidence fixture
   (`src/frontend/e2e/fixtures/animama.ts`) that fails a journey when the page
   or one of its workers reports a Content Security Policy violation, so
   `pnpm e2e:test:fast` on a built stack becomes a standing check.
5. Live sweep on a disposable built stack, for example
   `ANIMAMA_WEB_BUILD_MODE=production ./reset.sh --name pph --base-port 8900`
   (check free ports and running stacks first), with an uncommitted
   Playwright script that records `securitypolicyviolation` events and
   console reports in the page and its workers. Journeys: setup, chat with a
   streamed reply, both starter Avatars, Avatar, Particle and Scene Effects
   through a Gesture and the creators' previews, Pocket TTS speaking a reply,
   Pocket voice cloning from a recording, a voice-sample preview, Parakeet and
   SenseVoice dictation from a fake microphone file (when their model sets are
   installed), the Safety dialog and page. Paid calls wait for G1.
6. Documentation: the local HTTP architecture page
   (`docs/frontend/architecture/auth-server.md`) states the policy, the worker
   exception and the stored-bytes sandbox; the development guide
   (`docs/backend/operations/development.md`) says Vite sends no policy and to
   check policy-sensitive changes in a built stack or the desktop app;
   `docs/frontend/runtime/vrchat-avatar-conversion.md` describes the served
   policy accurately; `docs/frontend/architecture/content-and-workers.md`
   points to the local policy beside the hosted contract.

Checks: the touched pytest files with `uv run --no-sync pytest -q`;
`uv run ruff check` and `uv run ruff format --check` on touched Python;
`pnpm e2e:check` and `pnpm e2e:test:unit` for the fixture; the live sweep's
results.

Recovery: the policy is one constant per response kind; a missing source shows
as a console violation and is fixed by adding that source, not by loosening
others. If the sweep finds a library that needs `'unsafe-eval'` outside the
Pocket worker, stop and bring it to the owner.

Completion: tests pass, the sweep shows no violation (or every remaining one
is recorded with its owner decision), docs match; commit
`fix(web-security)[p2]: serve the app with a content security policy`.

Check record (2026-11-03, working tree `1cdfc700d` before the licence entries
and this record; base `6d3ab0dda`):

- Root: `uv run --no-sync pytest -q -p no:randomly tests/test_local_http_assets.py
  tests/test_product_http_ports.py tests/test_local_content_delivery.py
  tests/test_anima_runtime_delivery.py`: 155 passed (the new policy tests failed
  first: 11 failures against the baseline source, all a missing
  `content-security-policy` header).
- Root: `uv run --no-sync ruff check` and `ruff format --check` on the six
  touched Python files: passed.
- `src/frontend`: `pnpm e2e:check` (tsc) passed; `pnpm e2e:test:unit`: 25 passed.
- `src/frontend/web`: `pnpm exec vitest run src/lib/zod-runtime.test.ts`: 1
  passed; without the import the same test fails (two `Function` calls);
  `pnpm exec eslint` on the four touched files and `pnpm -s check:source`
  (poses check and `tsc -b`) passed; Prettier check on the touched TypeScript
  passed.
- `python3 scripts/public-release/check_source.py`: covers every tracked file.
- Live sweep: disposable built stack `animama-pph` (base port 9100) from this
  tree, Chrome for Testing 1208 driven over DevTools with a throwaway profile
  and a fake microphone. Policy headers read back on `/` and the Pocket worker.
  Exercised: first-run setup, a streamed markdown chat reply with an emotion,
  both starter Avatars, Pocket TTS speech and voice cloning (encoder download,
  clone, sample playback), a voice-sample preview through the Hugging Face CDN
  redirect, Parakeet and SenseVoice dictation (both transcribed the sample),
  Gesture and Reaction previews, Particle, Avatar and Scene Effect previews, the
  Particle, Avatar and Scene Effect creators, the Safety page, and the ElevenLabs
  realtime socket (opened and closed normally). Before the fix every page
  reported the Zod probe; after rebuilding, the chat page and the Scene Effect
  creator reported no violation. Paid usage: four OpenAI chat turns and two
  ElevenLabs replies. The stack was torn down afterwards.
- Not run in this phase: the full pre-push suite (final validation) and the
  browser journeys (final validation).

#### Code Review #1 Findings

Reviewed source: working tree `d86e8cd53` on `6d3ab0dda`; high-risk tier, full
initial review by an analysis reviewer and a checks reviewer.

- **P2-R1-F1 (blocking):** the Library's Pose preview, and unsaved-Action
  previews, fetch their clip from a `data:` URL, which `connect-src` refused, so
  the Pose did not play. Reproduced live on the built stack.
- **P2-R1-F2 (blocking):** the journey check missed violations inside workers:
  Playwright forwards only a worker's own console calls, and init scripts run
  only in frames.
- **P2-R1-F3 (blocking, wording):** the docs and a code comment said worklets
  take their policy from their own response and may load from `blob:`;
  worklets follow their document's policy, which has no `blob:` scripts.
- **P2-R1-C1 (blocking, checks):** `web/src/app/entrypoints.test.ts` allowlists
  the entries' static imports and failed on the new `zod-runtime` import.
- Non-blocking: N1 the Zod ordering holds because of chunking (no schema in the
  entry's shared chunks); N2 model files with embedded `data:` buffers would be
  refused (same cause as F1); N3 the policy test checked some directives
  loosely; N4 two more stored-bytes routes lacked a route-level assertion; N5
  the journey guide did not list the new failure; N6 cached fingerprinted
  workers keep their old headers; the record miscounted the red-first failures
  (11, not 9). Open question: whether WebGPU dictation reaches ONNX Runtime's
  string-evaluating embind method caller.

#### Code Review #1 Revisions

- F1 and N2: accepted. The owner chose to allow `data:` connections (Decision
  Log); `assets.py`, the test, `auth-server.md`, the spec snapshot and #838
  updated. Verified live after a rebuild: the "Arms Crossed" Pose preview plays
  with no violation.
- F2: accepted. The fixture now also runs the repeating listener inside each
  worker once it starts (`page.on("worker")`); the fixture comment and the
  journey guide say a refusal during a worker's start shows only in DevTools,
  and `auth-server.md` says the check covers the page and running workers.
- F3: accepted. Wording fixed in `assets.py`, `auth-server.md` and
  `content-and-workers.md`.
- C1: accepted. The test allows both `zod-runtime` specifiers and asserts that
  it is the first import in the entries' source; the built bundle's chunk order
  (N1) is guarded only by the journeys' violation check on a built stack.
- N3, N4, N5, N6 and the count: accepted (exact directive assertions; sandbox
  assertions on the package export and Included digest routes; journey guide
  and cache note; record corrected).
- Open question resolved by a live re-sweep: SenseVoice GPU (WebGPU) dictation
  transcribed the sample with live previews, and voice mode (Smart Turn, GPU
  dictation, one chat reply, Pocket speech) completed, with no violation; the
  CPU engines and Parakeet were covered before. Parakeet GPU was not
  downloaded.
- Checks after the revisions (tree `3dc8f2662`): the four test files above
  plus `tests/test_content_package_http.py` and
  `tests/test_included_content_digest_urls.py`: 163 passed, then
  `tests/test_local_http_assets.py` 122 passed after the `data:` change; ruff
  check and format check passed; `pnpm e2e:check:source` passed;
  `node --test scripts/e2e/*.test.mjs` 61 passed; web
  `vitest run src/app/entrypoints.test.ts src/lib/zod-runtime.test.ts` 3 passed;
  Prettier check passed. Paid usage in the re-sweep: one chat turn.
- Repair budget: one of two rounds used; review #2 (targeted recheck) follows.

#### Code Review #2 Findings

Reviewed source: working tree `ff7679e69` (differs from `3dc8f2662` only in this
plan); targeted recheck at the high-risk tier with every affected check rerun,
including the full web unit suite (6,286 passed) and a throwaway Playwright
probe of the worker listener on the journeys' Chromium 145 headless shell. No
blocking findings. Notes: the record overstated where the worker-start gap is
documented, said "six backend files" for four test files, and implied the C1
test guards the built chunk order; and the hosted entry policy in
`contracts/hosted-web.md` and its boundary fixture still allow only
`'self' blob:` connections, so a hosted consumer would refuse the same shared
preview fetches.

#### Code Review #2 Revisions

The three record notes are corrected above; the journey guide now names the
worker-start gap; `content-and-workers.md` says local builds serve their own
policy, which also allows `data:` connections. The hosted contract stays out of
scope (Cloud is a non-goal) and is listed as a follow-up under Outcomes &
Retrospective. Phase 2 passes; one repair round of two was used.

### Phase 3: Keys bound to their provider and address

Review tier: high risk (credential and ownership boundary, desktop IPC
contract and vault contents).

Requirements: R4.1 to R4.6.

Backend steps (tests first in `tests/test_runtime_credential_store.py`,
`tests/test_model_connection_credentials.py`,
`tests/test_model_configuration_api.py`, `tests/test_model_connection_probe.py`
and `tests/test_desktop_credentials_route.py`):

1. `credential_store.py`: replace the provider-name set with a mapping from
   each provider variable to its origin (`OPENAI_API_KEY` →
   `https://api.openai.com`, `DEEPSEEK_API_KEY` → `https://api.deepseek.com`,
   `HF_TOKEN` → `https://router.huggingface.co`, `OPENROUTER_API_KEY` →
   `https://openrouter.ai`). Accept `ANIMAMA_CONNECTION_<NAME>_ORIGIN` beside
   each connection key, both from the process environment and in desktop
   deliveries, and validate its value as a canonical `http(s)://host[:port]`
   origin. The web-search name stays outside connection rules.
2. `credentials.py`: the resolver sends an owner connection a key only when
   the key's origin (its provider's, or the `_ORIGIN` value delivered or set
   with it) equals the origin of the connection's base URL, and the transport
   is HTTPS or plain HTTP to this computer (the same host rule as the web
   form). Otherwise the connection's key is `missing`. Built-in connections
   are unchanged.
3. `model_configuration_service.py`: at create and update, refuse a provider
   key at another origin and any key over plain HTTP to another computer
   (`credential_origin_mismatch`, `credential_insecure_transport`), and a
   self-hosted connection key whose configured origin differs (the service
   receives the resolver for this check). A desktop connection whose saved key
   has another origin can still be saved; it reports `missing` until the key
   is entered again.
4. Router and errors: map the new codes, add them to the web app's
   user-visible error codes and add translated messages for every locale.
5. Redirects (R4.6): a shared httpx response hook refuses a redirect to
   another origin; the ElevenLabs, Anthropic, Gemini and web-search clients use
   it (or disable redirects where the provider never redirects). Tests send a
   cross-origin `302` through a mock transport and check that no second request
   carries the key; a test also confirms that the OpenAI SDK's client drops
   `Authorization` on a cross-origin redirect, so those clients need no hook.

Desktop and web steps:

6. `shared/desktop-runtime.ts` and `vault.ts`: a connection key change may
   carry `origin` only together with a `value`; main validates it, stores it
   in the vault entry, and delivers `<NAME>_ORIGIN` beside the key at startup
   and on every live change. Entries without an origin are delivered without
   one, so the backend does not use them. Tests in the desktop vault and IPC
   suites.
7. `ModelConnectionDialog.tsx`: on desktop, save the key with the origin of
   the saved base URL; when the address's origin changes on a connection with
   a saved key, require a new key (or removal) before saving and say why. On
   self-hosted web, under the variable field, show the `_ORIGIN` line to add
   for a connection key. Strings in English and the four translations; web
   tests for both forms.
8. Documentation: `docs/backend/operations/local-models.md` (keys on
   self-hosted web, with the origin line), ADR 0011's credential paragraph,
   the desktop runtime vault description
   (`docs/backend/operations/desktop-runtime.md`) and the model configuration
   API docs where they describe credential references. No OpenAPI schema
   change is planned; if one becomes necessary, regenerate the client offline
   with `pnpm openapi-ts`.

Checks: the touched pytest files; `uv run ruff check` and format check;
`pnpm desktop:test`; the touched web Vitest files; `pnpm check`;
`pnpm i18n:check`.

Recovery: keys live only in the vault and process environment, so a wrong
binding refuses a key rather than leaking it; re-entering the key repairs a
desktop connection.

Completion: every R4 acceptance item is covered by a passing test; commit
`fix(models)[p3]: send stored keys only to their own address`.

Check record (2026-11-03, working tree `f0bb6062f` before this record; base
`b763aac67`):

- Root: `uv run --no-sync pytest -q -p no:randomly` over `tests/test_model_*.py`,
  `tests/test_*credential*.py`, `tests/test_*elevenlabs*.py`,
  `tests/test_gemini*.py`, `tests/test_anthropic*.py`,
  `tests/test_web_search*.py`, `tests/test_openrouter*.py`,
  `tests/test_key_redirects.py`, `tests/test_embeddings_role.py` and
  `tests/test_fully_local_roles.py`: 1076 passed, 6 skipped. Eight existing
  tests failed under the new rules until their fixtures saved an origin or used
  HTTPS. With the redirect hook replaced by a no-op, the ElevenLabs, Anthropic
  and Gemini redirect tests fail (3 failures).
- Root: `uv run --no-sync ruff check` and `ruff format --check` (whole
  repository), `uv run --no-sync mypy src/backend/animama tests --exclude
  web-ui --exclude deprecated --exclude templates` (899 files) and
  `scripts/repository-boundary/check-python-imports.py` (0 forbidden edges):
  passed.
- `src/frontend`: `pnpm desktop:test`: 608 passed, 14 skipped (the vault and IPC
  origin tests failed first: 10 failures); `pnpm check`, `pnpm i18n:check` and
  `pnpm prettier:check`: passed.
- `src/frontend/web`: `pnpm exec vitest run src/ui/settings src/lib/errors`: 218
  passed (the four `ModelConnectionDialog` tests fail against the previous
  dialog); `pnpm exec eslint` on the four touched files: passed.
- `python3 scripts/public-release/check_source.py` (new files staged as intent
  to add): covers every tracked file.
- Not run in this phase: the full pre-push suite and the browser journeys
  (final validation); no live provider call.

#### Code Review #1 Findings

Reviewed source: the working tree on `b763aac67` (check tree `f0bb6062f`, plus
the record edits); high-risk tier, full initial review, with an independent
rerun of the checks (all passed on tree `7bdb9ed1e`).

- **P3-R1-F1 (blocking, docs):** `docs/frontend/features/model-settings.md`
  still said a plain-HTTP key shows a warning (the form now blocks it), and did
  not describe the saved origin or the self-hosted `_ORIGIN` line; the desktop
  troubleshooting table and the `credentials.apply` contract lacked the new
  code and field.
- **P3-R1-F2 (blocking, tests):** no negative test sent an unbound key through
  model listing, chat, embeddings or Memory Manager resolution; nor covered an
  operator's key moved by update, or a keyed create over plain HTTP to this
  computer.
- **P3-R1-F3:** the Anthropic builder passed `transport=None`, so production
  clients lost the SDK's keepalive transport and proxy mounts.
- **P3-R1-F4:** uncompressed IPv6, non-ASCII hosts and some IPv4 spellings
  compare differently in the browser and the backend (fails closed).
- **P3-R1-F5:** some docs said no key ever travels over plain HTTP, but the
  built-in OpenAI connection keeps the operator's `OPENAI_BASE_URL`.
- **P3-R1-F6:** a desktop key the backend withholds reads as unsaved, so
  removing the connection, or saving it without a key, left it in the vault.
- **P3-R1-F7:** wording in `desktop-runtime.md` and the self-hosted form.
- **P3-R1-F8:** the origin-variable rule and the origin computation repeated in
  the desktop and web code; a drift test matched source text.
- Check gaps: memory manager, chat SSE, app composition, local HTTP, user-file
  and Compose boundary tests were outside the recorded selection.

#### Code Review #1 Revisions

- F1: accepted. The model settings, desktop overview and troubleshooting docs
  describe the saved origin, the blocked plain-HTTP save, the `_ORIGIN` line
  and `credential_origin_invalid`.
- F2: accepted. `test_no_model_path_sends_a_key_saved_for_another_address`
  runs model listing, the probe, chat, embeddings and Memory Manager resolution
  with a key that has no origin or another one, and asserts that no request is
  sent (it fails with the refusal rule disabled); new tests cover an operator's
  key moved by update (refused) and a keyed create over plain HTTP to this
  computer (accepted).
- F3: accepted. The builder passes a transport only when given; a test compares
  the production client's socket options with the SDK default.
- F4: accepted in part. `canonical_origin` now gives IP addresses their
  standard form and non-ASCII names their IDNA form, as `URL.origin` does;
  rarer spellings a browser rewrites (`127.1`, percent-encoding) still never
  match, which withholds the key. Tested.
- F5: accepted. ADR 0011, `key_origins.py` and `local-models.md` say the rule
  covers keys that owner connections name, and that the built-in OpenAI
  connection keeps the operator's `OPENAI_BASE_URL`, as the plan's step 2 and
  R4.1 decided (Decision Log).
- F6: accepted. Removing a desktop connection always deletes its vault
  variable (confirmation only when the key is in use), and a save that drops
  the variable deletes the key; a dialog test covers the second.
- F7: accepted. `desktop-runtime.md` reworded; a self-hosted connection key that
  the backend cannot use reads "Not usable yet …", translated. The `_ORIGIN`
  line stays visible when the key works, as the configuration to keep.
- F8: accepted. `connectionOriginVariable` and `httpOrigin` live in
  `shared/desktop-runtime.ts` for the vault and the form; the backend drift
  test checks the delivered name, which the vault tests pin too.
- Check gaps: run (below).
- Checks after the revisions: the backend selection above plus
  `test_memory_manager*.py`, `test_product_http_memory_manager.py`,
  `test_anima_chat_sse.py`, `test_local_app_composition.py`,
  `test_local_http_*.py`, `test_user_file_*.py` and
  `test_compose_network_boundaries.py`: 1859 passed, 6 skipped, 1 failed
  (`test_local_http_transport.py::test_real_partial_multipart_spools_close_when_body_receipt_fails[deadline]`,
  a deadline test that passes alone and with its file, 31 passed; Phase 3
  changes nothing under `local/`). Ruff, format check and mypy (899 files)
  passed. `pnpm desktop:test`: 608 passed; `pnpm check`, `pnpm i18n:check` and
  `pnpm prettier:check` passed; web `vitest run src/ui/settings src/lib/errors
  src/app/local-runtime`: 235 passed; ESLint on the five touched files passed.
- Repair budget: one of two rounds used; review #2 (targeted recheck) follows.

#### Code Review #2 Findings

Reviewed source: working tree `2224226d0` on `b763aac67`; targeted recheck of
F1 to F8 and of regressions from the revisions, with the four touched backend
test files, `pnpm desktop:test` and the model settings web tests rerun.

- F1 to F8 resolved; for F2 a positive control confirmed every step of the new
  negative test would send a request with a matching origin.
- **P3-R2-1 (blocking):** the delivery accepted only origins that the backend
  normalisation leaves unchanged. A browser writes some origins differently
  (`https://[::ffff:a00:5]`, `https://api..example.test`, long labels), so one
  such connection key made the whole delivery fail and the desktop app fell
  back to restarting the backend on every key change.
- Non-blocking: the IDNA wording overstated browser parity; no tests for the
  removal path or the "not usable" text; two backend docs lacked the built-in
  OpenAI qualifier.

#### Code Review #2 Revisions

- P3-R2-1: accepted. A delivery accepts any bare `scheme://host[:port]`
  origin (`is_origin`), and `key_refusal` compares the canonical forms of both
  sides, so an origin that matches no address withholds only its own key.
  Every origin a browser writes is such a bare origin, and `canonical_origin`
  keeps ASCII host names as written. Tests: browser-written origins resolve
  against their addresses,
  an unmatched origin leaves other keys working, and malformed values are
  still refused.
- Wording, the "not usable" test and the two doc qualifiers: accepted and done.
  The removal path keeps no separate test: it calls the same deletion as the
  tested save path.
- Checks after the revisions (tree `99c6fc260`): the widened backend selection,
  1866 passed, 6 skipped; ruff, format check and mypy (899 files) passed; web
  `vitest run src/ui/settings/models`: 110 passed.
- Repair budget: both rounds used; review #3 (final targeted recheck) follows.

#### Code Review #3 Findings

Reviewed source: working tree on `b763aac67` (code tree `99c6fc260`); final
targeted recheck of P3-R2-1 and its fix, with the key tests and the model
settings web tests rerun.

- P3-R2-1 resolved: every origin a browser writes (576 probed) is delivered,
  and malformed values are still refused.
- **P3-R3-1 (blocking):** the round-1 revision encoded non-ASCII hosts with
  Python's IDNA 2003 codec, which maps some characters differently from the
  IDNA 2008 encoding the model clients' HTTP library uses. A key bound to one
  name could then be accepted for a look-alike name that the client resolves
  to another domain.
- P3-R3-2 (non-blocking): the delivery accepted non-ASCII values and bracketed
  hosts that are not IPv6; no producer sends them today.

Both repair rounds were used, so the finding went to the owner, who approved
one more round that fails closed for non-ASCII hosts (Decision Log).

#### Code Review #3 Revisions

- P3-R3-1: accepted. `canonical_origin` returns `None` for a non-ASCII host
  name, so no key matches one; owners write such a name in its ASCII (`xn--`)
  form, which browsers and the HTTP library also use. Tests: look-alike
  pairs (`faß.de`, `σοφιας.gr`, `例え.jp`) are refused, the `xn--` form works,
  an operator's key moved to a look-alike name is refused at save, and a
  desktop key moved there reports `missing`.
- P3-R3-2: accepted. `is_origin` requires a host `canonical_origin` accepts:
  ASCII, and only an IPv6 address in brackets. Tests added.
- Docs: `local-models.md` and the model settings page say to write non-ASCII
  names in their ASCII form.
- Checks (tree `46a52baee`): the widened backend selection, 1876 passed, 6
  skipped; ruff, format check and mypy (899 files) passed. No web or desktop
  code changed in this round.
- Review #4, an owner-approved final recheck, follows.

#### Code Review #4 Findings

Reviewed source: working tree on `b763aac67` (code tree `46a52baee`); targeted
recheck of P3-R3-1 and P3-R3-2, with the key tests rerun, a mutation probe and
a corpus comparison of the backend's origins with the browser's and the HTTP
library's.

- P3-R3-1 resolved: the new tests fail with IDNA 2003 or UTS46 encoding put
  back, and every origin the vault can store is still delivered.
- **P3-R4-1 (blocking):** user information in the authority, even an empty
  `@`, hid the brackets of an IPv6 address from the round-3 check, so two
  addresses that the HTTP library treats as different hosts could compare
  equal. It needs an operator-written origin containing `@`; the vault never
  stores one.
- Non-blocking: P3-R4-2, the Kelvin sign lowercases to ASCII `k` before the
  ASCII test (no security effect); P3-R4-3, IPv6 zone IDs were case-folded
  (operator-written origins only); P3-R4-4, a doc phrase about the address
  bar; P3-R4-5, a keyed connection whose base URL has a non-ASCII host cannot
  be made to work from the app, and only the docs say why.

The owner approved fixing P3-R4-1 with one more independent recheck (Decision
Log).

#### Code Review #4 Revisions

- P3-R4-1, P3-R4-2 and P3-R4-3: accepted. `canonical_origin` returns `None`
  when the authority contains any user information, any character outside
  ASCII (tested before lowercasing) or a `%`; `is_origin` inherits it. Tests:
  the collision pair, empty user parts, the Kelvin sign, a zone ID and
  percent-encoding are refused as addresses and as deliveries; 12 of these
  cases fail with the round-3 function put back.
- P3-R4-4: accepted; `local-models.md` points at the origin line the form shows.
- P3-R4-5: deferred to a follow-up: the rule fails closed as the owner chose;
  telling the owner in the form, or saving the ASCII form of the address, is UI
  work outside this round.
- Checks (tree `109a2ba5d`), from the repository root: `uv run --no-sync pytest -q
  -p no:randomly` over the widened backend selection (the Phase 3 selection
  plus the memory manager, chat SSE, app composition, local HTTP, user-file and
  Compose boundary files): 1888 passed, 6 skipped; `uv run --no-sync ruff
  check`, `ruff format --check` and `mypy src/backend/animama tests --exclude
  web-ui --exclude deprecated --exclude templates` (899 files) passed. No web or
  desktop code changed in this round.
- Review #5, the owner-approved final recheck, follows.

#### Code Review #5 Findings

Reviewed source: working tree on `b763aac67` (code tree `109a2ba5d`); final
targeted recheck of P3-R4-1 to P3-R4-4, with the key tests rerun, a mutation
control (12 failures with the round-4 function) and corpus, end-to-end and
redirect probes.

- P3-R4-1 to P3-R4-4 resolved: across about 50,000 spellings no two compare
  equal while the HTTP library connects to different hosts; every origin the
  vault can store is still delivered and releases its own key at its own
  address; the redirect hook still refuses cross-origin targets.
- No blocking findings. Optional: P3-R5-1, the redirect hook treats two URLs
  without an origin as the same origin (no effect today: the hooked clients
  start only at fixed provider origins); P3-R5-2, a base URL with an empty `@`
  or a `%` in its host now withholds its key, which belongs with the P3-R4-5
  follow-up, and a doc phrase should say the `%` rule covers the address part
  only; P3-R5-3, no delivery test for a percent-encoded host; P3-R5-4,
  `is_origin` accepts trailing non-ASCII whitespace (same host, no producer).

Phase 3 passes. Commit: `dd46a3353` (`fix(models)[p3]: send stored keys only
to their own address`).

Follow-up commit (`fix(models): refuse key redirects from an address without
an origin`), for the final integration review to check: the redirect hook
refuses a redirect when either URL has no plain origin (P3-R5-1), `is_origin`
refuses surrounding and non-ASCII whitespace (P3-R5-4), a percent-encoded host
is a tested delivery refusal (P3-R5-3) and `local-models.md` says the `%` and
user-information rule covers the `scheme://host[:port]` part (P3-R5-2 wording).
Checks: `tests/test_key_redirects.py`, `test_model_key_destinations.py`,
`test_desktop_credentials_route.py`, `test_runtime_credential_store.py`,
`test_gemini_sdk_isolation.py`, `test_anthropic_model_probe.py` and
`test_elevenlabs_service.py`: 267 passed; ruff, format check and mypy on the
touched files passed. P3-R5-2's behaviour joins the P3-R4-5 follow-up.

### Phase 4: Electron fuses, debugging guard, DevTools and the smoke copy

Review tier: high risk (packaging, release tooling and the desktop security
boundary).

Requirements: R3.1 to R3.6.

Steps:

1. `electron-builder.yml`: add `electronFuses` with the R3.1 values and
   `resetAdHocDarwinSignature: true` (unsigned development packs need a valid
   ad-hoc signature after the flip; signed builds are re-signed afterwards
   anyway).
2. Add `@electron/fuses` 1.8.0 (the version electron-builder already uses) as
   a desktop devDependency, and a module
   `scripts/runtime/fuses.mjs` that reads a packed app's wire and compares it
   with the expected one, including the ninth fuse at Electron's default.
   Call it from `package-development.mjs`, `release-macos.mjs`,
   `release-windows.mjs` and the smoke's install step. Unit tests use a small
   fixture file that contains a fuse wire.
3. Debugging guard: a dependency-free module imported first by `main.ts`
   checks, in packaged builds, for `--remote-debugging-port`,
   `--remote-debugging-pipe`, `--inspect`, `--inspect-brk`, `--inspect-wait`
   and `--inspect-port` (through Chromium's switch parser and `process.argv`),
   and exits before any other startup code unless `inspector.url()` reports a
   running inspector. Unit tests cover each switch, packaged and unpackaged,
   with and without an inspector.
4. `paths.ts`: a packaged app accepts `ANIMAMA_DESKTOP_DEV_USER_DATA` only while
   its inspector runs; every other packaged override stays refused. Tests.
5. DevTools: `devTools: !app.isPackaged` in the four window creators; the View
   menu template drops its DevTools item when packaged. Tests for the menu and
   window options.
6. `scripts/native/test-global-input-hook.mjs`: on Windows, run the staged
   Electron (`.desktop-runtime/win32-x64/electron/electron.exe`) as Node and
   load the addon from the packaged `app.asar.unpacked`.
7. Smoke: in `smoke-journey.mjs` and the platform modules,
   - after the existing install and signature steps, read the exact
     artifact's fuse wire, check its sealed `runtime/update-policy.json`
     against the release policy (the publisher requirement is already checked
     by `verifySignedApp` on macOS and the Authenticode check on Windows), and
     launch it with each debugging switch, expecting a prompt nonzero exit, no
     runtime state or process record and no runtime child;
   - make the copy in a new private temporary directory outside the checkout:
     `ditto` on macOS or a recursive copy on Windows, flip
     `EnableNodeCliInspectArguments` on, re-sign it ad-hoc on macOS
     (`codesign --force --deep --sign -`), and check its wire differs only in
     that fuse;
   - run the existing journey on the copy with a throwaway user-data directory
     through `ANIMAMA_DESKTOP_DEV_USER_DATA`; the update step now expects
     `unavailable`; children must run from the copy's runtime;
   - delete the copy and the throwaway directory in `finally`, and on macOS
     remove the copy's `Animama Safe Storage` Keychain item when the smoke
     created it (verified absent at the start).
   Report fields keep their sanitized shape; new checks are named, for example
   `exact_fuse_wire`, `debugging_switches_refused`, `copy_fuse_wire` and
   `copy_updates_unavailable`. Unit tests cover the pure helpers.
8. Documentation: the installed-artifact smoke and VM sections of
   `docs/frontend/desktop/releases.md`, and a short packaged-hardening note
   (fuses, debugging switches, DevTools) in the desktop platform docs.

Checks: `pnpm desktop:test`; `pnpm --filter animama-desktop check`; a
development stage, audit and pack (`pnpm desktop:runtime:stage -- --platform
darwin --arch arm64`, `pnpm desktop:runtime:audit -- …`, `pnpm desktop:mac`)
through the heavy-job slot after checking that no other pack is running, whose
fuse assertion passes; packed behavior is checked in final validation, not on
the owner's account.

Recovery: fuses are build configuration; reverting the `electronFuses` block
and the guard restores the previous behavior. A failed smoke leaves the exact
installed app in place for inspection, as before.

Completion: tests pass, the pack's fuse assertion passes; commit
`fix(desktop)[p4]: turn on Electron fuses and refuse debugging switches`.

Check record: _to be filled._

## Final integration review

An independent `sdlc-reviewer` covers combined acceptance (R1 to R4), Phase 1's
folded light review, public-safety of all records, and integration across the
phases (for example, the smoke copy with the guard, the vault origin with the
backend rule). It reuses phase evidence and runs no checks. At most two repair
rounds; findings and revisions are recorded here.

## Validation and acceptance

On the final candidate, in this order:

1. Full pre-push suite through the heavy-job slots:
   `python3 scripts/heavy-slot.py -- make check-test` from the root, and from
   `src/frontend`: `python3 ../../scripts/heavy-slot.py -- pnpm verify`,
   `pnpm web:test:browser`, `pnpm desktop:test` and `pnpm prettier:check`.
2. Browser journeys: `pnpm e2e:test:fast` against a disposable built stack
   (`ANIMAMA_LLM_SKIP=1 ANIMAMA_WEB_BUILD_MODE=production ./reset.sh --name
   pph-e2e --base-port 8600` or a free base port), through the heavy-job slot,
   with the new CSP check active.
3. Packed app: a fresh development stage, audit and pack of the final
   candidate, then, in a disposable clone of the golden VM, with an
   uncommitted variant of the VM helper that accepts a development pack:
   - the fuse assertion on the copied app;
   - each debugging switch refused before a window or the runtime starts;
   - the smoke copy journey with the throwaway profile (G1: the smoke key,
     two short starter chats per run, at most three runs);
   - a CSP sweep in the packed copy: chat, Avatar render, a Gesture with
     effects, Pocket TTS speech, a voice-sample preview, PiP, Quick Chat and
     the Safety dialog, recording violations across every window.
   The clone is deleted afterwards.
4. Owner gates that remain after the PR, recorded in it: the installed-artifact
   smoke on a signed, notarized candidate in the VM; Windows packaged
   acceptance; real-Mac checks of GPU, audio and microphone; turning on
   private vulnerability reporting on publication day.

Gates:

- **G0:** the owner approves this plan.
- **G1:** the owner's go-ahead for paid provider calls: in the built-stack
  sweep, at most 20 short chat turns with the development OpenAI key and,
  optionally, three ElevenLabs realtime replies to exercise the realtime
  socket under the policy; in the VM, at most three smoke-journey runs.
  Without it, the paid steps are skipped and recorded as not run.

Before any push or `gh pr create`, run `gh workflow list --all`; if
`Portable product validation` is enabled, stop and ask the owner.

## Idempotence and recovery

- Stacks are named and disposable; tear each down after its last use
  (`docker compose -p animama-<name> down`) and say which are kept.
- VM clones are deleted by the helper on exit; a leftover clone is listed by
  `tart list` and removed with `tart delete`.
- The stage, audit and pack can be rerun; never run them while another
  `desktop:mac` pack or VM smoke is running.
- Vault and key changes are local and reversible by entering the key again.
- If the open-source readiness work moves `SECURITY.md` first, rebase and edit
  `.github/SECURITY.md`.

## Outcomes & Retrospective

Follow-ups found so far (not in this plan's scope):

- The hosted entry policy (`contracts/hosted-web.md` and the hosted boundary
  fixture) allows only `'self' blob:` connections, while the shared Pose and
  Action previews fetch inline `data:` clips; align the contract and fixture.

_The rest is written at completion._
