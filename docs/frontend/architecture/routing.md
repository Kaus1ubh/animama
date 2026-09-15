# Routing Guide

The web app uses TanStack Router with file routes in
`src/frontend/web/src/routes`.

Typed creators use stable product routes such as `/a/particle-effects/new`,
`/a/avatar-effects/new`, `/a/scene-effects/new`, `/a/sound-effects/new`,
`/a/gestures/new`, and `/a/reactions/new`.

## Route Tree

- `__root.tsx`: root route, document head, scroll restoration, scripts, and
  not-found view.
- `index.tsx`: local entry route. It sends an incomplete installation to
  `/setup` and a completed installation to `/a`.
- `setup.tsx`: required private display-name setup with Continue and no Skip. It
  is reachable only while the backend reports first run incomplete.
- `a.tsx`: accountless app area. It redirects to `/setup` only when first run
  is incomplete. Its sidebar Create control links to the
  creator hub and exposes direct Anima, Gesture, and Reaction shortcuts on
  hover or focus. Its nested Effects submenu groups Particle VFX, Avatar VFX,
  Scene VFX, and Sounds without lengthening the primary menu.
- `a/index.tsx`: waits for saved settings and owned Animas, then replaces `/a`
  with `/a/$animaId` for the last visited owned Anima, or the first in creation
  order (Annie on a fresh installation). A stale ID falls back; no owned Animas
  opens `/a/animas/new`. Query failures offer Retry without replacing selection.
  Explicit chat and management URLs are unaffected.
- `a/create.tsx`: creator hub for Anima, Action, and Effects authoring,
  including direct Particle, Avatar, Scene, and Sound Effect entry points.
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
  Idle Style authoring. Creators upload and name multiple VRMA files, assign
  default and emotion pools, preview the current exact catalog revision, and
  save one editable Local entry without standalone Animation product rows.
- `a/music-tracks.new.tsx` and `a/music-tracks.$musicTrackId.edit.tsx`: direct
  Music Track authoring. Creators upload one long-form audio file, configure
  loop/gain/autoplay defaults, preview the exact registered audio, and save it
  directly without creating a generic Audio product row.
- `a/gestures.new.tsx` and `a/gestures.$gestureId.edit.tsx`: typed Gesture
  creation and stable-item editing. Timeline Gestures use an immersive
  full-body Pose/Clip workspace with keyframe bone/expression authoring and
  client-side timeline playback of the current in-memory draft;
  imported VRMA Gestures use the same preview shell without timeline tools.
  The header loads only ready owned Gestures, while Pose mode loads local
  browser poses; both operations retain the dedicated route identity. On
  desktop the route uses the shared adaptive Canvas layout: an expanded
  sidebar docks beside and resizes the workspace, while compact sidebar
  controls float over the full-width scene. The header and collapsible
  authoring panels remain clear of either sidebar state.
- `a/reactions.new.tsx` and `a/reactions.$reactionId.edit.tsx`: typed Reaction
  creation and stable-item editing in a portrait-framed expression/effect/sound
  workspace. Reaction routes never expose humanoid bone or pose controls and
  their header loads only ready owned Reactions. Timeline Play prepares the
  current exact dependency closure before dispatching local events. Neither
  creator has a document-toolbar Preview action; only explicit Save operations
  persist the draft. They use the same adaptive Canvas/sidebar layout as
  Gesture creators.
- `a/particle-effects.new.tsx` and
  `a/particle-effects.$particleEffectId.edit.tsx`: typed Particle Effect
  authoring in a scene-first `three.quarks` workspace. One route-owned Canvas
  docks beside the expanded application sidebar and returns to full viewport
  width beneath the compact controls. The document toolbar, emitter/effect setup browser, five-category
  Inspector, preview settings, and local Preview Timeline remain control-safe
  floating surfaces above it; narrow layouts return those surfaces to normal
  flow without mounting another Canvas.
- `a/avatar-effects.new.tsx` and
  `a/avatar-effects.$avatarEffectId.edit.tsx`: typed Avatar Effect authoring
  for Hover, Face decal, and Texture variants. One portrait Canvas uses the
  shared adaptive expanded-dock/compact-overlay sidebar layout, with mock-aligned
  translucent Effect Setup and Inspector panels plus a compact Preview bar.
  Exact image bytes, Blob URLs, optional Sound dependency pins, recovery, and
  catalog revisions remain outside route state. The edit route hydrates the
  current Local entry and Save replaces it under the stable catalog item ID.
  Once a ready owned item exists, the toolbar can hand only that stable item ID
  and the `avatar_effect` type token to a new Gesture or Reaction route.
  The bare `/a/avatar-effects` family URL redirects to the new creator.
- `a/scene-effects.new.tsx` and
  `a/scene-effects.$sceneEffectId.edit.tsx`: typed Scene Effect authoring for
  Background Layers and Focus Lines. The creator uses the shared Effect
  workspace chrome around an isolated full-scene preview, so local drafts can
  exercise underlay/overlay placement and Avatar-face targets without writing
  to the live Anima scene store. Private marquee image bytes, Blob URLs, exact
  Sound pins, recovery, and catalog revisions stay outside route state; Save
  creates or replaces one editable Local entry under the stable item ID. The bare
  `/a/scene-effects` family URL redirects to the new creator rather than being
  interpreted as an Anima ID. Ready owned Scene Effects expose the same
  stable-ID-only Gesture/Reaction handoff as the other component creators.
- `a/animas/index.tsx`: compatibility resolver. It replaces `/a/animas` with
  the first owned Anima's canonical management URL or redirects an empty
  installation to `/a/animas/new`. The latter notice must not redirect back here,
  because that would create an empty-roster loop.
- `a/animas/$animaId.tsx`: Anima details and management with URL-backed
  Identity, Emotions, Loadout, and Settings tabs. The Loadout view records
  `tab=loadout`. A bare management URL resolves to Identity; invalid tab values
  do the same. Its management Canvas docks beside the expanded desktop sidebar
  so the stage and carousel center in the remaining workspace, then returns to
  full viewport width beneath the collapsed controls. Tab changes and Anima
  carousel navigation create normal history entries while retaining the selected tab.
- `a/animas/$animaId/identity.tsx`: modal route for editing the anima-scoped
  `identity.md` memory entry.
- `a/avatar-portrait-debug.tsx`: development-only local VRM portrait-capture
  harness; its route guard returns not found outside Vite development mode.
- `a/$animaId.tsx`: live anima runtime shell.
  Valid owned visits asynchronously update the user's last-active-Anima
  preference for cross-route authoring defaults without delaying the shell.
  Its `MainShell` follows the same adaptive expanded-dock/compact-overlay
  Canvas behavior as management and creator routes.
- `a/$animaId/c/$chatId.tsx`: chat-id child route; intentionally renders
  nothing because the parent owns the runtime effects.

## Router Context

`src/frontend/web/src/app/router.tsx` receives local runtime state and a stable
TanStack Query client. It waits through loading, presents a bounded Retry state
for recoverable runtime failures, and mounts routes only when runtime context is
ready. Shared routes consume the neutral runtime owner rather than importing
the local provider.

The Personalization editor is route-independent local UI. Its sidebar action
opens `LocalPersonalizationModal` without changing the active anima, chat, or
URL. Audio, model, interface, and provider preferences remain in the separate
Application settings modal.

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
- Render Library navigation as actual tab/tab-panel relationships. The All,
  Avatars, Gestures & Reactions, FX, and Chat Uploads sections use URL state as
  their controlled value, while the sticky category strip remains inside
  Library's existing page scroll container.
- Preserve Library search state on hard reload. Legacy `/a/creator` URLs
  resolve to the `/a/create` hub.
- Use route `beforeLoad` for navigation decisions that must happen before a
  route renders.
- Normalize optional search values in the route's search helper and pass plain
  values and callbacks into feature components.
- Keep creator route identity stable and content-free. Gesture, Reaction,
  Particle Effect, Avatar Effect, Scene Effect, and Sound Effect edit routes
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
