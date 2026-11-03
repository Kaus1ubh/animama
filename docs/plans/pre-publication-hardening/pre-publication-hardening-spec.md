# Pre-publication security hardening

Status: Agreed
Authority: [#838](https://github.com/raymond-van/animama/issues/838). This file is
a snapshot of that issue captured 2026-11-03T21:25:41Z; change the issue, not
this file.
Owner decision: draft agreed by the owner on 2026-11-03. The same day the
security review added three refinements (R3.3's switch list, R3.6's
throwaway profile and R4.6 on redirects), which go to the owner with the
ExecPlan. Dated decisions are listed under
[Open questions and decisions](#open-questions-and-decisions).

## Problem and intended users

The Animama repository will be published with its history, and the macOS
desktop app keeps shipping. A security review before publication (#819)
recommended five hardening changes, which this spec covers together:

1. **Reporting route.** `SECURITY.md` says there is no monitored way to report
   a vulnerability privately.
2. **Content Security Policy.** FastAPI serves the built web app, which the
   desktop app also loads, without a Content Security Policy, and serves stored
   content bytes without a sandbox policy.
3. **Electron hardening.** The packaged desktop app keeps Electron's default
   fuses, accepts remote-debugging and Node inspect switches, and offers
   DevTools.
4. **Provider keys.** A model connection may name a stored provider key
   whatever its base URL is, keeps its key when its address changes, and may
   send a key over plain `http://` to another computer.
5. **Update downloads.** Before installing an update, the desktop app trusts
   the version that the feed file names, not the version inside the downloaded
   artifact, and on macOS it does not recheck the cached update archive.

The people who benefit are those who install the desktop app or self-host
Animama, whose keys and signed-app permissions stay bound to Animama itself;
security researchers, who get a private route and clear scope; and the
maintainer, who receives reports privately.

## Goals, scope and non-goals

In scope: requirements R1 to R5 below, their tests, documentation and the
release smoke changes that R3 requires.

Out of scope:

- Other findings of the review, which have their own issues or follow
  publication.
- GitHub settings, including turning on private vulnerability reporting
  (the owner does that on publication day).
- Animama Cloud. The content-bytes header (R2.3) lives in shared delivery code,
  so a hosted consumer receives it when it adopts a release containing it.
- Signing the update feed file, or adding an expiry to it.
- An "Automatically check for updates" setting.
- The desktop version number and the release policy.
- Packaged-app network capture.

## Required behavior

### R1: Security policy

- **R1.1** `SECURITY.md` (whichever path `main` uses; the open-source readiness
  work moves it to `.github/SECURITY.md`) names two private routes:
  GitHub private vulnerability reporting on this repository, and email to
  `security@animama.ai`.
- **R1.2** It asks reporters not to open public issues, pull requests or
  discussions about a vulnerability, and says what a useful report contains.
- **R1.3** Responses are best effort; the policy promises no response time.
- **R1.4** Supported versions: the latest published desktop release and the
  current `main` branch receive security fixes; older releases receive no
  backports.
- **R1.5** Scope: the desktop app, the self-hosted server and web app, the
  update and download host, and this repository's build and release tooling.
  Vulnerabilities in third-party services that Animama connects to (model,
  voice and search providers) belong with those providers. A self-hosted
  installation that its operator exposes beyond the computer without their own
  authentication and TLS is outside the supported configuration.
- **R1.6** Shared computers: a self-hosted installation's loopback API has no
  credential, so any account on that computer can use it. The policy says so,
  and says what to do instead: run it on a computer only you use, or put your
  own authentication in front of it. The desktop app's local server admits only
  the app's own windows.
- **R1.7** No other current document contradicts the policy.

### R2: Content Security Policy

- **R2.1** In built mode and in the desktop app, every file that FastAPI serves
  from the built web app (the entry document, scripts, workers, worklets,
  styles and assets) carries an enforcing `Content-Security-Policy`. It
  allows scripts only from the app's own origin plus `'wasm-unsafe-eval'`,
  with no `'unsafe-eval'` and no inline script. It sets `object-src 'none'`,
  `base-uri 'none'`, `frame-ancestors 'none'` and `form-action 'self'`, and
  `default-src 'none'`. Connection, media, image, font, style and worker
  sources are limited to what the app uses: its own origin; `blob:` where
  the app creates object URLs; `data:` images; inline styles; and, for
  connections only, the two outside services that the app's pages contact
  directly today: the public voice-sample host (Hugging Face, including its
  download CDN) and the ElevenLabs realtime socket. No wildcard origin is
  allowed beyond that CDN's subdomains.
- **R2.2** The single verified Pocket TTS worker response
  (`/tts/workers/inference-worker.js`) additionally allows `'unsafe-eval'`, as
  `contracts/hosted-web.md` specifies, until #698 removes the need. No other
  response allows it.
- **R2.3** Stored content bytes (content files, content previews, Anima runtime
  members and package export downloads) carry
  `Content-Security-Policy: sandbox; default-src 'none'`. This changes nothing
  for images, audio, models or fetches that load them.
- **R2.4** The Vite development server sends no Content Security Policy. The
  development documentation says so, and says to check policy-sensitive
  changes in a built stack or the desktop app.
- **R2.5** Current documentation that describes the app's policy matches what
  is served.

### R3: Electron hardening

- **R3.1** Every packed desktop app (development packs and signed candidates,
  macOS and Windows) has this fuse wire: RunAsNode off, cookie encryption on,
  the `NODE_OPTIONS` variable off, Node CLI inspect arguments off, embedded
  asar integrity validation on, only-load-app-from-asar on, the file
  protocol's extra privileges off. Every other fuse keeps Electron's default.
- **R3.2** The packaging checks read the fuse wire of each packed app and fail
  when it differs from R3.1.
- **R3.3** A packaged app started with a debugging switch quits before it
  opens a window, creates a session, writes logs or starts its runtime, unless
  its Node inspector is actually running. The switches are
  `--remote-debugging-port`, `--remote-debugging-pipe`, `--inspect`,
  `--inspect-brk`, `--inspect-wait` and `--inspect-port`, with or without a
  value. With the shipped fuse wire the inspector cannot run, so a shipped app
  always quits. Unpackaged development is unchanged.
- **R3.4** Packaged builds disable DevTools in every window, and their View
  menu has no DevTools item. Unpackaged development keeps both.
- **R3.5** Release tooling that ran the packaged executable as Node runs
  Electron's own staged binary instead, still loading the packaged files it
  checks.
- **R3.6** The installed-artifact smoke works with these fuses and adds no way
  to debug a shipped app:
  - the exact signed artifact is verified and installed as today; the smoke
    reads its fuse wire, checks its signature against the update publisher
    requirement and its sealed update policy, and launches it with each
    debugging switch to confirm it quits before opening a window or starting
    its runtime;
  - the setup, chat and persistence journey runs on a copy the smoke makes from
    the installed app, with only the inspect fuse turned on and an ad-hoc
    signature. Its update check must report that updates are unavailable,
    because its signature no longer matches the publisher;
  - the copy is made outside every directory the publish step reads, runs with
    a throwaway user-data directory instead of the installed app's profile,
    and is deleted with that directory after the run. A packaged app accepts
    the development user-data override only while its Node inspector is
    running, so a shipped app still rejects it.

### R4: Stored keys only for their own provider and address

- **R4.1** A provider key goes only to its provider's HTTPS origin:
  `OPENAI_API_KEY` to `https://api.openai.com`, `DEEPSEEK_API_KEY` to
  `https://api.deepseek.com`, `HF_TOKEN` to `https://router.huggingface.co`
  and `OPENROUTER_API_KEY` to `https://openrouter.ai`. Anthropic, Gemini,
  ElevenLabs and web-search keys stay reserved for their built-in uses. The
  built-in OpenAI connection keeps its operator-set `OPENAI_BASE_URL` on
  self-hosted servers, which no API request can change.
- **R4.2** A connection key goes only to the origin saved with it:
  - on the desktop app, the encrypted vault stores the origin of the
    connection's base URL when the key is entered, and a stored key's origin
    changes only when a new key value is entered with it;
  - on self-hosted servers, the operator sets
    `ANIMAMA_CONNECTION_<NAME>_ORIGIN` beside
    `ANIMAMA_CONNECTION_<NAME>_API_KEY`; a key without an origin is not used.
- **R4.3** No key travels over plain `http://` unless the host is this
  computer: a loopback name or address, or `host.docker.internal`, the same
  hosts the connection form already treats as this computer. Connections
  without a key are unaffected.
- **R4.4** Saving a connection is refused, with a stable error code and a
  translated message, when its key could never be used at its base URL: a
  provider key with another origin, a self-hosted connection key whose
  configured origin differs, or any key over plain `http://` to another
  computer. A connection whose key is not usable at its current address yet
  (a desktop key saved for another address, or a self-hosted key without an
  origin) can be saved. It reports that its key must be entered or configured
  again, and model listing, probes, chat, embeddings and Memory Manager runs
  send it no key. Changing a desktop connection's address asks for its key
  again.
- **R4.5** The API, data and operations documentation and ADR 0011 describe
  how keys are bound. If the API schema changes, the generated client is
  regenerated offline.
- **R4.6** No backend request that carries a key follows a redirect to another
  origin with that key. This covers model connections, the built-in OpenAI and
  Anthropic connections, Gemini, ElevenLabs and web search; a client whose key
  header the HTTP library does not drop on a cross-origin redirect refuses
  such redirects.

### R5: Update-download checks

- **R5.1** After an update downloads and before anything is installed, the app
  checks the artifact itself against the approved update, whose feed version
  must already be newer than the running app:
  - macOS: the app in the update archive has the approved version, and its
    runtime manifest names the approved version and runtime build ID;
  - Windows: the installer's product version is the approved version.
  A mismatch refuses the update with a stable error code. The running app,
  its services and its data are untouched, and the person can check again.
- **R5.2** On macOS, immediately before the update is handed to the system
  updater, the cached archive's size and SHA-512 are checked again against the
  approved values, as Windows already does for its installer.
- **R5.3** These checks run with real Electron and the pinned updater against a
  local feed server, as well as in unit tests.

## Constraints

- **Public records stay public-safe.** Records describe the hardening, not how
  a weakness could be used.
- **Pre-launch.** No migration is needed for earlier installations (owner,
  2026-11-03): a vault key or self-hosted key without an origin is simply not
  used. Cookie encryption is one-way, which matters to no one yet.
- **No new trust in the copy.** The smoke copy (R3.6) differs from the
  artifact only in one fuse and its signature. Its ad-hoc signature gives it a
  different code identity, so the operating system grants it none of the
  signed app's Keychain items or privacy permissions.
- **Platforms.** No Windows computer is available for this work. Windows
  changes are covered by unit tests, and Windows packaged behavior remains a
  native acceptance gate.
- **Validation.** Hosted CI stays disabled, so local checks are the evidence.
- **Schema.** Database changes, if any, edit the baseline rather than adding a
  migration revision.

## Acceptance criteria

- [ ] R1: `SECURITY.md` contains each R1 item; the open-source readiness work
  has the final wording for its issue-form links.
- [ ] R2: backend tests show the policy on the entry document, a module
  script, a worker and the Pocket worker (and only the Pocket worker allows
  `'unsafe-eval'`), and the sandbox policy on each stored-bytes route.
- [ ] R2: in a built stack and in a packed desktop app, the browser console
  reports no Content Security Policy violation while exercising chat, both
  starter Avatars and VRM loading, Avatar, Particle and Scene Effects, Pocket
  TTS speech and voice cloning, Parakeet and SenseVoice dictation, audio
  worklets, voice-sample previews, PiP, Quick Chat and the Safety dialog. The
  plan records which steps used paid providers or installed models, and any
  step that could not run.
- [ ] R2: `pnpm e2e:test:fast` passes against a disposable built stack.
- [ ] R3: the packaging check reads the R3.1 fuse wire from a packed macOS app
  and fails on a changed wire; desktop tests cover the switch guard, the
  DevTools setting and the menu.
- [ ] R3: a packed macOS app launched with each debugging switch quits without
  opening a window or starting its runtime.
- [ ] R3: the installed-artifact smoke passes on a signed candidate in the
  macOS VM, or, if no signed candidate can be built for this work, the plan
  records that gate as outstanding and the copy-based journey passes against a
  local packed app.
- [ ] R4: backend tests cover each provider key at its own and another
  origin, connection keys with matching, missing and changed origins, and
  plain `http://` to this computer and to another computer, through
  create, update, model listing, probe, chat, embeddings and Memory Manager
  resolution, and a cross-origin redirect for each key-carrying client;
  desktop tests cover origins in the vault and its delivery; web tests cover
  the address-change prompt.
- [ ] R5: adapter tests cover matching and mismatched artifacts on both
  platforms and the macOS recheck; a real-Electron run against a local feed
  server shows a matching update accepted and a changed version, build ID or
  archive refused before install.
- [ ] The full pre-push suite passes on the final candidate, and the PR records
  local evidence separately from hosted validation.

## Open questions and decisions

Owner decisions, 2026-11-03:

- These five changes land as one ExecPlan, one branch and one PR.
- **Response time (R1.3):** best effort, with no promised time.
- **OpenAI key (R4.1):** the stored OpenAI key goes only to `api.openai.com`;
  custom connections, including Azure and proxies, use their own keys.
- **Connection keys (R4.2):** each key is bound to the origin saved with it,
  in the desktop vault or by the self-hosted operator.
- **Release smoke (R3.6):** the exact artifact is checked directly and the
  journey runs on a harness-made copy with only the inspect fuse on.

- **Spec agreed** with the agent's proposals in it: the supported-versions and
  scope wording (R1.4, R1.5) and no policy in Vite development mode (R2.4).
- **Pre-launch:** earlier installations and users need no migration.

Security review refinements, 2026-11-03, presented with the ExecPlan: the
named switch list (R3.3), the smoke copy's throwaway profile and cleanup
(R3.6), and no key on cross-origin redirects (R4.6).

## Spec

[#838](https://github.com/raymond-van/animama/issues/838); this file is its snapshot.

## ExecPlan

`docs/plans/pre-publication-hardening/pre-publication-hardening-execplan.md`,
linked at its reviewed revision once written.

## Delivery links

Parent issue #838, a sub-issue of #819. Branch `fix/pre-publication-hardening`;
one PR.
