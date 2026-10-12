# Release Avatar canvas memory promptly

Source agreement: [avatar-canvas-memory-spec.md](avatar-canvas-memory-spec.md),
the 2026-10-12 draft that expands issue
[#472](https://github.com/raymond-van/animama/issues/472). The draft awaits owner
review. Once approved, it is published to #472, which becomes authoritative.

Authorized scope:
- Phase 1 is delivered.
- Phases 2–4 are proposed and start after the owner approves this plan.
- Phase 5 (R5) also needs the owner to confirm the open question in the spec.
- Merge approval remains separate.

## Purpose and context

Several surfaces that mount a WebGL canvas and an Avatar leak GPU and decoded
texture memory, or rebuild their whole scene when they could reuse it. The spec
lists the measured findings, F1–F7, and the requirements, R1–R6.

The relevant code:
- **Avatar runtime:** `src/frontend/web/src/lib/avatar/Avatar.ts`.
  - `load()` calls `unload()` first.
  - `unload()` deep-disposes `vrm.scene`.
  - `dispose()` calls `unload()` and marks the Avatar disposed.
- **Surfaces that call `avatar.dispose()` while the model can still be attached through `<primitive object={scene}>`:**
  - `ui/content-creator/useContentCreatorAvatar.ts`
  - `ui/main/canvas/AvatarCanvasActor.tsx`
  - `ui/animas/AnimaAvatarStage.tsx`
  - `ui/pose-creator/PoseCreatorAvatarActor.tsx`
  - the create-Anima stages
- **App router:** `src/frontend/web/src/app/router.tsx` builds a router per QueryClient. `app/runtime/runtime-controller.ts` creates one QueryClient while loading and one per admitted session.
  - TanStack router-core 1.168 installs scroll restoration listeners when a router's stores are first created, and never removes them.
  - Its handler ignores scroll events while `router.isScrollRestoring` is false.
- **Chat:** `src/frontend/web/src/routes/_app/$animaId.tsx` keys `CompanionSafetyProvider`, and therefore all of `MainShell`, by `animaId`. `AnimaRouteProviders` already swaps the runtime catalog without remounting.
- **Desktop:**
  - `src/frontend/desktop/src/main-process/pip/pip-window-manager.ts` owns the native PiP window, which renders `/desktop/pip/$animaId`.
  - The main renderer stays the runtime owner and sends visual-state snapshots. See [Desktop PiP](../../frontend/desktop/picture-in-picture.md) and [Quick Chat](../../frontend/desktop/quick-chat.md).
- **Related:** the [creator resource lifetimes plan](../creator-resource-lifetimes/creator-resource-lifetimes-execplan.md) explicitly left React timing and bitmap disposal out of its scope. This plan covers them.

Working directory: the task worktree for branch `fix/preview-dock-scene-reuse`, from
base `95a2db39`. One branch and PR ([#474](https://github.com/raymond-van/animama/pull/474))
serve the whole plan. The branch name predates the expanded scope and is kept.

## Measurement method

Measure each browser acceptance item the same way, before and after:
- **Stack:** a disposable built task stack (`ANIMAMA_WEB_BUILD_MODE=production ./reset.sh --name <n> --base-port <p>`), plus the main stack's build as the baseline.
- **Browser:** an isolated Chrome profile with a loopback DevTools port. Use `--disable-renderer-backgrounding` when windows overlap.
- **Process memory:** renderer and GPU process footprint, read with macOS `footprint -p <pid>`.
- **Page metrics over CDP:**
  - `Runtime.getHeapUsage` (used size and ArrayBuffer backing store);
  - `Performance.getMetrics` (DOM nodes and listeners);
  - WebGL contexts created and canvases still connected;
  - ImageBitmaps created, closed and still live, via an init script that wraps the constructors;
  - Blob URLs created and revoked.
- **GC:** force it with `HeapProfiler.collectGarbage` at baselines and after each scenario.

Desktop measurements also read Electron helper processes. The development desktop
app has to expose a loopback DevTools port; Phase 4 confirms how. Record numbers in
this plan without machine paths.

## Progress

- [x] Phase 1: Library Dock reuse (R1). Delivered in `7172794f`. Review passed after two repair rounds; the evidence is below.
- [ ] Phase 2: Avatar disposal releases GPU and decoded resources (R2, R3). Awaits plan approval.
- [ ] Phase 3: One live scroll tracker per admitted session (R4). Awaits plan approval.
- [ ] Phase 4: Desktop and PiP window memory, measured and repaired (R6). Awaits plan approval.
- [ ] Phase 5: Chat keeps its renderer across Animas (R5). Awaits plan approval and the owner's R5 decision.
- [ ] Final integration review, fast browser journeys and PR update.

## Surprises & Discoveries

- 2026-10-12: The Dock's scene gate compared prepared and current target keys. A minimized Dock derives its target without the Anima suffix, so minimizing also unmounted the scene.
- 2026-10-12: A second load on the same Avatar while the first is in flight can orphan a model. `Avatar.load()` has no cancellation. So Phase 1 keys the preview actor by model revision instead of reloading in place.
- 2026-10-12: The parsed model and textures are per load. No three.js global cache is enabled, and `GLTFLoader` keeps no cross-load cache. Releasing a model's ImageBitmaps on unload therefore cannot affect another Avatar.
- 2026-10-12: The router is deliberately rebuilt per admitted session: `publish()` creates a new QueryClient for each new session. Building one router for the whole page would weaken hosted session isolation.

## Decision Log

- 2026-10-12, owner: expand #472 from the Library Dock fix to the measured canvas leaks and churn, then add PiP and desktop windows.
- 2026-10-12, agent (proposed): treat this as substantial and risky work, because it touches the shared Avatar runtime, router lifetime and chat remount semantics. Hence this ExecPlan.
- 2026-10-12, agent (proposed): fix R2 centrally in `Avatar.unload()` by detaching before disposing, rather than reordering every caller's cleanup.
- 2026-10-12, agent (proposed): for R4, build routers only for ready admissions, and stop scroll tracking on a retired router, instead of keeping one router for the whole page.
- 2026-10-12, agent (proposed): order the phases 2 → 3 → 4 → 5. R5 depends on R2, because reusing the chat renderer without detach-before-dispose would recreate F2 in the main scene. R6 measurements are more meaningful after R2 and R3.

## Phased implementation

### Phase 1: Library Preview Dock reuses its scene (R1) — delivered

Issue: #472. Starting revision: `95a2db39`. Commit: `7172794f`.

Changes:
- `ContentPreviewHost` renders the last prepared scene. Its controls stay gated on the current target.
- `PreviewActor` is keyed by model revision. It loads once per Avatar and retries only a failed load.
- A per-preparation request reports a reused Avatar ready.
- The camera resets on each replacement.
- The current behavior is documented in `docs/frontend/runtime/content-previews.md`.

Results:
- Local checks:
  - `pnpm check` and `pnpm web:lint` pass.
  - `pnpm web:test` passes in isolation: Vitest 471 files and 4198 tests, browser scripts 114/114.
  - An earlier run failed one effect-render browser test because it overlapped a stack build that was rebuilding `@animama/product-ui`.
  - The new host and scene tests fail on the baseline.
- `pnpm e2e:test:fast` passes, 38/38.
- Built stack, 15 Gesture previews:
  - WebGL contexts created: 15 → 1.
  - Model fetches: 15 → 1.
  - ArrayBuffer storage: up to 300 MB → flat 53–58 MB.
  - Renderer peak: 1145 → 673 MB.
- Minimize and restore fetch nothing. Model switches fetch only on change, on one canvas.

#### Code Review #1 Findings

Independent `sdlc-reviewer` review of the working tree against `95a2db39`.
- CR1-F1, blocking: a failed load was never retried, because the actor froze its entry.
- CR1-F2: Avatar targets did not get the ready signal.
- CR1-F3: reduced-motion autoplay after a model change. This existed before.
- CR1-F4: test gaps; the mock skipped the success path.
- CR1-F5: the doc omitted Destroy.
- CR1-F6: the stale scene keeps rendering under the error overlay.

#### Code Review #1 Revisions

- **Accepted and fixed:**
  - F1 and F2: a per-preparation request, a load-state ref and a load-attempt counter, with a retry test.
  - F4: the mock now reaches the success path, and a failure test was added.
  - F5: Destroy is documented.
- **Deferred:** F3. It existed before and is now narrower; at mount, autoplay cannot be told apart from an already-handled request.
- **Rejected:** F6. It is transient and plays nothing.

Code Review #2 passed. CR2-N1 (missing `IS_REACT_ACT_ENVIRONMENT`) was accepted. CR2-N2 (a duplicate error for an entry without a runtime file) and CR2-N3 (no host-to-scene ordering test) were deferred. Code Review #3 passed. Two repair rounds were used.

### Phase 2: Avatar disposal releases GPU and decoded resources (R2, R3)

Issue: to be created after approval. Starting revision: the plan commit on this branch.

Steps:
1. **Detach before dispose.** Write a failing `Avatar` unit test: with the model attached to a parent group, `unload()` must leave `vrm.scene.parent === null` before any geometry, material or texture is disposed. Use spies on the disposal path. Then call `this.vrm.scene.removeFromParent()` in `unload()` before `VRMUtils.deepDispose`. Keep `preloadVrm()` consistent.
2. **Close decoded textures.** Before disposing, collect the textures the model's materials reference. After disposal, call `close()` on each texture whose `source.data` is an `ImageBitmap`. Test this with stub bitmaps.
   - Confirm in three r182 that a disposed and detached texture is never uploaded again. Phase 2 must show no "image is closed" or `texImage2D` errors in any surface's console.
3. **Drop external references.** Make `dispose()`, and where they belong to the model, `unload()`, clear externally supplied sinks and callbacks: the pose and reaction clip event sinks, `_poseClipOnFinished`, and any others found while auditing. Test that a disposed Avatar no longer reaches a supplied sink.
4. **Review callers.** Audit every `avatar.dispose()` caller listed above. Keep their `setSceneObject(null)`. Add no per-caller ordering logic unless a caller attaches the model in a way that `removeFromParent()` cannot reach.
5. **Optional extra copy.** Remove the 17 MB `bytes.slice()` copy in `VerifiedByteLoader` before creating the Blob, if it type-checks without casts that hide a real shared-buffer case. Otherwise record why it stays.
6. **Checks:** focused Avatar and creator tests, `pnpm check`, `pnpm web:lint`, and `pnpm web:test` run in isolation.
7. **Built stack:**
   - Avatar Effect creator: 20 preview-model switches, comparing renderer and GPU after GC.
   - Chat: 10 Chat only ↔ Avatar + Chat toggles, comparing live ImageBitmaps after GC.
   - Per-load peak against the baseline.
   - Visual checks: the creator, chat, `/animas/<id>` and the Library Dock still render models after switching.
8. **Review and commit:** bounded review, then `fix(avatar)[p2]: …`.

Recovery: revert the phase commit. No data or contract changes.

### Phase 3: One live scroll tracker per admitted session (R4)

Issue: to be created after approval. Depends on nothing; it runs after Phase 2 to keep reviews focused.

Steps:
1. Write a failing test for `AppRouter`: rendering while admission is loading builds no router, and a router replaced by a new admission, or unmounted, stops tracking scroll positions.
2. Build the router only when admission is ready, still keyed by the session's QueryClient.
3. In an effect cleanup, retire the previous router by turning off its scroll restoration. Use a small helper that documents its reliance on router-core's `isScrollRestoring`, and covers it with a test.
4. Check hosted composition behavior through the existing hosted browser scripts in `pnpm web:test` and the hosted-composition tests.
5. **Built stack:**
   - 20 Anima selections on `/animas/<id>`: detached canvases and DOM nodes after GC return to baseline.
   - Window `pagehide` listeners from the router: 1.
   - Back/forward scroll restoration still works on a long page.
6. Bounded review, then commit `fix(router)[p3]: …`.

Recovery: revert the phase commit.

### Phase 4: Desktop and PiP window memory (R6)

Issue: to be created after approval. Runs after Phase 2, so its measurements include the shared disposal fix.

Steps:
1. **Measurement harness:**
   - Confirm how to expose a loopback DevTools port for `pnpm desktop:dev`.
   - Run against the baseline main build and against a built task stack from this branch, through `ANIMAMA_DESKTOP_WEB_URL`.
   - Identify the main window, PiP and Quick Chat renderer processes, the GPU process and the Electron main process.
2. **Scenarios, measured before and after with GC:**
   - Open and close native PiP 20 times.
   - Switch Anima 10 times while PiP is open.
   - Resize and move PiP repeatedly.
   - Leave PiP open and idle for 10 minutes, to measure snapshot traffic.
   - Open and close Quick Chat 20 times.
   - Open and close browser Document PiP 20 times in Chrome.
   - Check the main window's suspended scene while PiP is open.
3. **Record findings** F7.x in this plan, with causes traced in source and heap snapshots.
   - Fix lifetime defects within R6 test-first: listeners, IPC subscriptions, snapshot buffers, canvases, Avatars and windows not released.
   - Bring any fix that changes visible behavior to the owner before implementing it, for example releasing the main window's Avatar while PiP is shown.
4. **Checks:** `pnpm desktop:check`, desktop unit tests, focused web tests, then a re-measurement of each scenario.
5. Bounded review, then commit `fix(desktop)[p4]: …`. Use separate phase commits if the web and desktop fixes are independent.

Gates:
- Packaged macOS app behavior, Windows behavior, and a long real-session PiP check are owner checks unless they are measured here.
- Record them in the PR rather than as issues.

Recovery: revert the phase commits. No persisted window state changes, unless a finding needs them; that would be an owner decision.

### Phase 5: Chat keeps its renderer across Animas (R5)

Issue: to be created after approval. Gate: the owner confirms R5. Depends on Phase 2.

Steps:
1. **Audit what must reset per Anima** under `MainShell` and the canvas actor:
   - safety notice and crisis card;
   - chat (already keyed by `ChatInterface key={animaId}`);
   - avatar transform, scene camera and background;
   - emotion and playback state;
   - lip-sync and voice registration;
   - PiP snapshot identity;
   - desktop runtime messages.
   Record each item and how it resets.
2. **Write failing tests:**
   - `CompanionSafetyProvider` resets its state when its `animaId` changes, without remounting its children.
   - Each audited item that currently relies on the remount resets on an Anima change.
3. Replace `CompanionSafetyProvider key={animaId}` with an `animaId` prop. Move per-Anima resets into the owning components. Keep the `ChatInterface` key.
4. **Built stack:**
   - 20 Annie ↔ Caitlyn switches create one WebGL context, and the renderer after GC stays within 10% of the first switch.
   - Visual checks of each Anima's model, transform and background, a fresh chat, and the safety UI.
   - With desktop PiP open, the PiP window follows the switch.
5. Bounded review, then commit `fix(chat)[p5]: …`.

Recovery: revert the phase commit to restore the remount.

## Final integration review

Run once all authorized phases are complete:
- `code-review` in final integration mode across all phases;
- `pnpm e2e:test:fast` on a built task stack from the final candidate;
- `pnpm desktop:check`.

Then update PR #474's title, body and closing references for the expanded scope.

## Validation and acceptance

Use the spec's acceptance criteria. Each phase records its exact commands, results,
before/after measurements and unperformed checks here. Hosted validation is
currently disabled, so the PR records local evidence only.

## Idempotence and recovery

Every phase is source-only and revertible by commit. Task stacks are disposable
and are taken down after their last use; their volumes are kept. Measurement
profiles and scripts live outside the repository. Main-stack measurements stay
read-only. They save no content, and they restore any changed preference, such as
the last active Anima.

## Outcomes & Retrospective

Not yet complete.
