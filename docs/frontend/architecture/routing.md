# Routing Guide

The web app uses TanStack Router with file routes in
`src/frontend/web/src/routes`.

Typed creators use stable product routes such as `/a/particle-effects/new`,
`/a/avatar-effects/new`, `/a/scene-effects/new`,
`/a/gestures/new`, and `/a/reactions/new`.

## Route Tree

- `__root.tsx`: root route, document head, scroll restoration, scripts, and
  not-found view.
- `index.tsx`: local entry route. It sends an incomplete installation to
  `/setup` and a completed installation to `/a`.
- `setup.tsx`: required private display-name setup with Continue and no Skip. It
  is reachable only while the backend reports first run incomplete.
- `a.tsx`: app shell; redirects to `/setup` while first run is incomplete.
- `a/index.tsx`: waits for saved settings and owned Animas, then replaces `/a`
  with `/a/$animaId` for the last visited owned Anima, or the first in creation
  order (Annie on a fresh installation). A stale ID falls back; no owned Animas
  opens `/a/animas/new`. Query failures offer Retry without replacing selection.
  Explicit chat and management URLs are unaffected.
- `a/create.tsx`: creator hub for Anima, Action, and Effects authoring,
  including direct Particle, Avatar and Scene Effect entry points.
- Legacy Sound Effect new/edit routes redirect to `/a/library?section=fx&fx=sound`;
  sounds are uploaded in action/effect pickers and managed in Library.
- `a/animas.new.tsx`: the four-step `ui/create-anima/CreateAnimaPage` in the
  app shell. It accepts only the optional bounded logical `avatar` ID and
  resolves its admitted revision. Saved owner-scoped drafts take precedence
  over a new hint. Invalid/unavailable sources do not create an Anima or
  redirect away. Cancel exits through `/a/create`, avoiding the empty-roster
  `/a/animas` loop. Success prepares one runtime and opens `/a/$animaId`.
- `a/memories.tsx`: installation-wide markdown memory workspace. Legacy
  `tab=uploads` URLs redirect to Library's Chat Uploads section.
- `a/library.tsx`: installation-owned typed product Library with URL-backed All,
  Avatars, Gestures & Reactions, FX, and Chat Uploads sections. Search,
  Starter visibility, sort, family filters, upload status, and the Gesture
  update/status/motion/order filters survive navigation and reload. Chat
  Uploads also owns upload management and retrieval-debug
  tools.
- `a/idle-styles.new.tsx` and `a/idle-styles.$idleStyleId.edit.tsx`: direct
  Idle Style authoring. Select existing finite Gestures for Default and separate
  emotion/intensity cells, with inherit and No idle choices. Preview uses the
  current saved revision; Save edits Local content or creates an Included copy.
- `a/music-tracks.new.tsx` and `a/music-tracks.$musicTrackId.edit.tsx`: direct
  Music Track authoring. Creators upload one long-form audio file, configure
  loop/gain/autoplay defaults, preview the exact registered audio, and save it
  directly without creating a generic Audio product row.
- `a/gestures.new.tsx` and `a/gestures.$gestureId.edit.tsx`: Gesture creation
  and stable-item editing with VRMA or Pose Clip motion.
- `a/reactions.new.tsx` and `a/reactions.$reactionId.edit.tsx`: Reaction
  creation and stable-item editing with expression/effect/sound timelines.
- `a/particle-effects.new.tsx` and `a/particle-effects.$particleEffectId.edit.tsx`:
  [Particle Effect authoring](../runtime/avatar-particle-vfx.md).
- `a/avatar-effects.new.tsx` and `a/avatar-effects.$avatarEffectId.edit.tsx`:
  [Avatar Effect authoring](../runtime/avatar-vfx.md).
- `a/scene-effects.new.tsx` and `a/scene-effects.$sceneEffectId.edit.tsx`:
  [Scene Effect authoring](../runtime/scene-vfx.md).
  Bare `/a/avatar-effects` and `/a/scene-effects` URLs redirect to their creators.
- `a/animas/index.tsx`: compatibility resolver. It replaces `/a/animas` with
  the first owned Anima's canonical management URL or redirects an empty
  installation to `/a/animas/new`. The latter notice must not redirect back here,
  because that would create an empty-roster loop.
- `a/animas/$animaId.tsx`: Anima details and management with URL-backed
  Identity, Emotions, Loadout, and Settings tabs. The Loadout view records
  `tab=loadout`. A bare management URL resolves to Identity; invalid tab values
  do the same. Tab changes and Anima carousel navigation create history entries
  while retaining the selected tab.
- `a/animas/$animaId/identity.tsx`: modal route for editing the anima-scoped
  `IDENTITY.md` memory entry.
- `a/avatar-portrait-debug.tsx`: development-only local VRM portrait-capture
  harness; its route guard returns not found outside Vite development mode.
- `a/$animaId.tsx`: live anima runtime shell.
  Valid owned visits asynchronously update the user's last-active-Anima
  preference for cross-route authoring defaults without delaying the shell.
- `a/$animaId/c/$chatId.tsx`: chat-id child route; intentionally renders
  nothing because the parent owns the runtime effects.

## Router Context

`src/frontend/web/src/app/router.tsx` receives local runtime state and a stable
TanStack Query client. It waits through loading, presents a bounded Retry state
for recoverable runtime failures, and mounts routes only when runtime context is
ready. Shared routes consume the neutral runtime owner rather than importing
the local provider.

App Settings opens a route-independent modal without changing the active Anima,
chat or URL.

## Route Patterns

- Use TanStack Router `Link`, `useNavigate`, `Route.useParams`, and
  `Route.useSearch`.
- Keep URL params in route files and pass plain ids/callbacks to feature
  components.
- Use sparse, section-specific Library search state. Omit default values and
  remove filters owned by hidden sections, so the default route is
  `/a/library` and Scene FX is `/a/library?section=fx&fx=scene`. Use normal
  history entries for sections, discrete filters, and Upload status changes.
  Replace the current entry for either debounced text-query change so typing
  does not fill browser history.
- Keep subtype disclosure and locally revealed Starter page counts out of the
  URL. Changing Library category, query, or Starter inclusion remounts the
  inventory scope and opens its first non-empty subtype.
- Preserve Library search state on hard reload. Legacy `/a/creator` URLs
  resolve to the `/a/create` hub.
- Use route `beforeLoad` for navigation decisions that must happen before a
  route renders.
- Normalize optional search values in the route's search helper and pass plain
  values and callbacks into feature components.
- Keep creator route identity stable and content-free. Gesture, Reaction,
  Particle Effect, Avatar Effect and Scene Effect edit routes
  carry only the logical typed content ID. Exact revisions, JSON,
  uploaded bytes, Blob URLs, and recovery state remain outside browser history.
  Dirty documents and active uploads block route and browser exit until the
  user stays or explicitly discards or pauses. Preview camera, Avatar
  visibility, shape outline, selected Avatar, and selected emitter remain
  route-independent preview state.
- Gesture and Reaction creators claim exclusive preview ownership before
  mounting their route Canvas. They preserve one typed draft identity and one
  `ActionDocument`; exact dependency IDs and local timeline preview state do not
  enter route search state. The public JSON interchange is the authored
  `animaPoseClip/1.0`; an optional versioned typed-project envelope retains exact
  dependency pins without placing draft IDs or save state in the URL.
- Effect handoffs use only `component=<stable item id>` and
  `componentType=particle_effect|avatar_effect|scene_effect|sound_effect`.
  The destination resolves the item's current exact source through its typed
  endpoint; definitions, files, Blob URLs, and signed capabilities never enter
  route history.
- Do not introduce compatibility wrappers for older router concepts.

## Runtime Route Ownership

`/a/:animaId` owns `AnimaRouteProviders`, `MainShell`, and
`ChatInterface`. The `/c/:chatId` child route exists only to put the active
chat in the URL. This prevents the chat, avatar, SSE, TTS, and canvas runtime
from remounting when a new chat route is created.
