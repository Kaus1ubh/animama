# Desktop Picture-In-Picture

Desktop PiP is implemented as a native Electron window that renders a dedicated
scene-only web route. It is separate from browser Document PiP, which remains
the fallback for the normal web app.

## High-Level Flow

```text
Main web renderer
  -> usePictureInPicture()
  -> useDesktopPiP()
  -> window.animamaDesktop.pip.open(...)
  -> ipcMain
  -> PipWindowManager
  -> hidden frameless BrowserWindow
  -> /desktop/pip/$animaId
  -> PiP renderer sends ready
  -> main renderer sends initial visual-state snapshot
  -> main process shows PiP window
```

The main renderer remains the runtime and audio owner. The PiP renderer is a
visual consumer.

Desktop PiP is not used for Library or Anima-management content previews. Library
owns an app-shell Preview Dock, while Anima management reuses its existing
`AnimaAvatarStage`; neither surface publishes preview state into the chat/PiP
snapshot channel.

When native desktop PiP is active, the main window keeps the app shell and
runtime producer mounted but suspends its own scene render. This avoids drawing
the avatar twice while preserving the main renderer's role as the source of
visual state.

## Main-Process Window

The PiP window is managed by
`desktop/src/main-process/pip/pip-window-manager.ts`.

The window is hidden, transparent, frameless and always on top, with no shadow
or taskbar entry. It starts at 210 × 280 with a 116 × 154 minimum size and the
standard isolated, sandboxed preload. See the manager for the complete options.

PiP reopens where the owner last left it on this machine. After a move or
resize settles, and when the window closes, the manager saves its display,
top-left corner and size scale to `pip-placement.json` in the desktop profile
(`pip-placement.ts`). Screen coordinates only fit this machine's displays, so
they are not App settings. A saved position is used while its display is
connected, moved back inside that display's work area if needed. Otherwise PiP
opens flush with the bottom-right corner of the owner window's display work
area, which already excludes OS taskbars, the Dock and the menu bar. The default
size scale is `0.5`.

It uses the floating always-on-top level and remains visible across workspaces,
including fullscreen workspaces. On macOS it is a non-activating panel, which
floats over full-screen apps while Animama stays in the Dock and Command-Tab.
Electron's default for full-screen visibility hides the Dock icon instead, so
`floatOnAllWorkspaces` passes `skipTransformProcessType`.

The Linux `type: "toolbar"` hint makes the window easier to identify in window
managers. Tiling window managers may still need explicit user rules.

## Loading And Visibility

The PiP BrowserWindow is created hidden.

The main process constructs the PiP URL from the trusted configured web origin:

```text
/desktop/pip/$animaId?desktopPip=1
```

Renderers never provide arbitrary PiP URLs.

The window only becomes visible when both readiness conditions are true:

1. the PiP renderer has sent a `ready` runtime message
2. the owner renderer has sent at least one visual-state snapshot after that

If the PiP window reloads or navigates away from `/desktop/pip/...`, the main
process resets readiness and hides it again.

## Window Roles

The preload identifies the auxiliary window as `windowRole: "pip"`, selected
by `--animama-window-role=pip` at window creation.

Web hooks use the role to keep PiP controls and runtime producers active only
in the main window. The main process routes runtime messages by sender: PiP may
send `ready`, `camera-preset`, `planner-events-consumed` and `voice-command`;
only the window that opened PiP may send Avatar `snapshot`/`incremental` state
and `voice` state. Only Avatar state counts toward the readiness that shows the
window, so voice state cannot make PiP visible early.

## IPC Surface

The [preload bridge](../../../src/frontend/desktop/src/main-process/pip/pip-preload.cts)
defines `window.animamaDesktop.pip`; the
[IPC handlers](../../../src/frontend/desktop/src/main-process/pip/pip-ipc.ts)
validate window controls and runtime messages. The bridge exposes open/close,
state, background/size controls, the resize grip, visual messages and cursor
subscriptions. Subscriptions return cleanup functions.

The main process validates open options and runtime message envelopes before
acting on them. `onCursorSnapshot(...)` is optional so older desktop bridges or
non-native PiP contexts can keep using local DOM pointer events.

Cursor snapshots go directly to the PiP renderer. They contain screen and
window-local coordinates, native window bounds, an inside-window flag and a
capture timestamp.

## Dedicated Route

[`web/src/routes/desktop/pip/$animaId.tsx`](../../../src/frontend/web/src/routes/desktop/pip/$animaId.tsx)
serves `/desktop/pip/$animaId`.

This route intentionally stays outside `/`. Routes under `/` inherit the
normal protected app layout, which would pull in `AppShell`, sidebar,
`MainShell`, chat runtime, and main-window PiP producers.

The route renders:

```tsx
<SettingsProvider animaId={animaId}>
  <AvatarSceneHost mode="pip" />
</SettingsProvider>
```

The route requires the Electron `pip` window role and PiP preload bridge.
Browser and main-window navigation redirect to `/`. This role check selects the
auxiliary UI; FastAPI still authorizes its API and content requests.

## Shared Scene Host

`AvatarSceneHost` serves both `mode="main"` and `mode="pip"`. It owns the
canvas viewport, scene/camera/transform state, scene VFX and avatar bridge points.

`MainShell` remains responsible for product shell concerns: chat placement,
header/sidebar integration, canvas controls, fullscreen, and PiP triggering.

## Runtime Visual Sync

A second Electron renderer cannot share the main renderer's in-memory Zustand
stores. Desktop PiP syncs visual state through Electron IPC.

Main renderer producer:

```text
web/src/hooks/useDesktopPipRuntimeSync.ts
```

Payload builder and applier:

```text
web/src/lib/desktop-pip/visual-state.ts
```

The main renderer publishes:

- PiP background mode
- avatar transform
- PiP camera preset
- avatar runtime store snapshot, including planner events
- lip-sync bridge state, including audio timing offsets

The PiP renderer applies snapshots to its own stores and scene props. Its own
Avatar consumes the mirrored planner events, so Gestures and Reactions play in
PiP, and their Avatar, particle and scene effects apply to the PiP renderer's
own Avatar and scene VFX store. The suspended main scene consumes none, so PiP
reports each consumed event to its owner as a `planner-events-consumed` runtime
message and the owner removes it from its queue. Until that report arrives,
PiP drops the event from incoming snapshots. Otherwise each snapshot sent while
a Gesture plays queues it again, and closing PiP replays it in the main window. Scene effect state is therefore not mirrored:
the main scene is suspended during PiP, and replacing PiP's store with its
empty one cleared a Reaction's scene background about 100 ms after it began.

PiP has its own camera preset, Portrait (close) by default and saved as the
user preference `presentation.pip_camera_preset`, separately from the main
window's preset. The main canvas settings show it as PiP camera while PiP is open, and
the PiP camera button cycles it; the PiP renderer sends that request to its
owner as a `camera-preset` runtime message. The main scene is suspended during
PiP, so the PiP renderer frames its own Avatar from the preset whenever the
preset or Avatar changes. The main camera, including fine-tuning, is unchanged.

The producer sends an initial full snapshot when the PiP renderer sends
`ready`, then sends throttled incremental snapshots on relevant store changes.
It does not publish every animation frame.

Lip-sync timing is bridged with the source audio context time plus a wall-clock
capture timestamp. Do not compare `performance.now()` values across renderer
processes because renderer time origins are not a shared clock.

## Audio Ownership

The main renderer owns TTS, dictation and VFX sound cues; PiP plays no audio.

PiP renders visual lip-sync from synced timing state. Fake audio contexts are
used only to let the visual lip-sync bridge compute relative timing in the PiP
renderer.

## Background Modes And Transparency

Desktop PiP supports two background modes:

- `transparent`: desktop is visible behind the avatar
- `scene`: the configured scene background is rendered

The main canvas settings and the PiP toolbar both switch it through
`setBackgroundMode(...)`, and the main process publishes the mode to both
renderers. Reopened PiP keeps it while the app runs; each launch starts
transparent.

Transparency requires all layers to cooperate:

1. `BrowserWindow` uses `transparent: true` and `backgroundColor: "#00000000"`.
2. The PiP document marks `html`, `body`, and `#root` with
   `data-animama-pip="true"`.
3. Global CSS makes `[data-animama-pip="true"]` transparent.
4. `Scene` keeps `gl={{ alpha: true }}` and clears with alpha `0`.
5. Background media and opaque underlays are disabled in transparent mode.

On Linux, transparency also requires a compositor such as `picom`. Without a
compositor, the native window can appear black or opaque even when Electron and
the web route are configured correctly.

## Click-Through, Drag, Close, And Boundary Indicator

Desktop PiP uses Electron `BrowserWindow.setIgnoreMouseEvents(...)` to keep the
non-interactive body click-through on platforms where Electron supports it
reliably. This lets clicks on the avatar/background area pass to whatever
desktop window is underneath PiP.

Click-through is always enabled for the PiP body on macOS and Windows. There is
no user toggle.

Linux disables PiP click-through. Electron's mouse-event forwarding is not
documented for Linux, and X11 window managers such as i3 can keep sticky PiP
windows visible across workspaces while native input state remains tied to the
original window. Disabling click-through keeps close, drag, and resize reliable.

Because Electron mouse-event ignoring is window-level rather than pixel-level,
`PipWindowManager` uses the same native cursor polling loop as the boundary
indicator to classify cursor position:

- outside the PiP window
- over a pass-through body area
- over an interactive PiP zone

Two zones keep PiP mouse input enabled:

- the top 40px, where the hover toolbar sits
- a 24px square in the bottom-right corner, where the resize grip sits

On hover the route shows one toolbar along the top: a move icon, the voice
controls, then camera preset, Scene background, size and close buttons. The toolbar background uses
`anima-pip-drag` (`-webkit-app-region: drag`), so it moves the window; its
buttons and slider use `anima-pip-no-drag`. The PiP body is not draggable,
because drag-anywhere would conflict with body click-through.

The camera button cycles the PiP camera preset. The Scene background button is
a toggle between the `scene` and `transparent` modes.

The voice controls are the chat input's, acting on the main window's chat
([`useDesktopPipVoice`](../../../src/frontend/web/src/hooks/useDesktopPipVoice.ts)):
the voice-mode button while the microphone is idle and voice mode can start;
during voice mode a small synthetic waveform, the mute toggle and stop. While
the main window dictates, PiP shows only the waveform and stop, since it has no
text field. The waveform is CSS animation that runs only while the user speaks
unmuted; no audio crosses windows. The main window publishes its state only
while PiP is open for its Anima, clears PiP's controls when its chat unmounts
(Avatar-only view, another Anima), and ignores a command that no longer fits
the session. In a narrow PiP the waveform, then the camera button, then the
separator give way to the voice controls.

The size button swaps the voice, camera and background buttons for a slider; the size
button, Escape or leaving the window swaps them back. Slider changes call
`window.animamaDesktop.pip.setSizeScale(...)`, which resizes the native
`BrowserWindow` around its current center. Wheel events over the PiP window use
the same size-scale path. On macOS and Windows, click-through means wheel resize
only works where the PiP window is currently receiving input; on Linux it works
over the whole PiP rectangle because click-through is disabled.

Holding the resize grip calls `setGripResizing(true)`; releasing it calls
`setGripResizing(false)`. Only the PiP renderer may do this. Meanwhile the main
process polls the cursor every 16ms and scales the window from its top-left
corner, so the bottom-right corner follows the cursor along the window's
diagonal. Mouse input stays enabled, so the release reaches the grip wherever
the cursor is. The drag also ends when the window blurs, hides, navigates or
closes.

The scale range is `0.275` to `1.6`. `0.5` is the default; `0.275` maps to the
native minimum size. The window keeps its 210 × 280 aspect ratio when scaled.

While the PiP window is hovered, the avatar scene opacity drops to 30% and a
thin border marks the window bounds. This makes it easier to see what is
underneath a transparent click-through PiP window before interacting with the
desktop behind it.

The boundary indicator is not driven by CSS `:hover`. Full-window drag regions
can suppress or distort normal DOM hover behavior, especially over transparent
pixels. Instead, `PipWindowManager` polls the native cursor point against the
PiP `BrowserWindow` bounds while PiP is open. On supported platforms, that same
poll toggles `setIgnoreMouseEvents(true, { forward: true })` for body
click-through and resets mouse input before the window hides, reloads, or
closes.

The manager publishes `DesktopPipState.isHovered` only when the boolean changes,
and keeps it true during a grip resize. The PiP route shows the border,
toolbar and resize grip while `isHovered` is true.

## Global Cursor Look-At

The same native cursor polling loop also publishes PiP cursor snapshots to the
PiP renderer every poll while the PiP window is visible. These snapshots let the
PiP avatar's idle cursor look-at layer follow the desktop cursor even when
Anima is not focused and the cursor is outside the PiP window.

The web avatar runtime treats snapshot `local.x/y` as PiP-window client
coordinates. Values are allowed to be negative or larger than the PiP window
size; the existing cursor look-at layer then uses its calibrated canvas-relative
mapping and clamps the resulting eye/head/body target to natural limits. The
normal browser app and main Electron scene still use DOM `pointermove`.

## Linux Window Manager Notes

The PiP window keeps its shell title (`Anima PiP`, translated with the
[shell locale](../architecture/i18n.md#desktop-shell)) instead of the web
document title, so title rules break when the locale changes. Match the window
type instead:

```text
_NET_WM_WINDOW_TYPE = _NET_WM_WINDOW_TYPE_TOOLBAR
```

For i3, a rule based on window type is more reliable than title matching:

```text
for_window [class="Anima" window_type="toolbar"] floating enable, sticky enable
```

Transparent windows need a compositor. On i3, use a compositor such as `picom`
when testing transparent PiP.

## Validation

Run from `src/frontend`:

```sh
pnpm web:check
pnpm desktop:check
pnpm desktop:build
```

Manual validation:

- desktop PiP opens a frameless always-on-top window
- no loading/setup page, app shell, header, sidebar, or chat panel flashes visibly
- window remains hidden until PiP route readiness and initial visual state
- transparent mode shows the desktop behind the avatar when a compositor is
  available
- scene mode renders the configured background
- avatar animation, emotion, gestures, VFX, and lip-sync sync from the main
  window
- speech audio plays only once from the main renderer
- close button closes PiP and updates the main-window button state
- the PiP toolbar starts voice mode, mutes and unmutes, and stops it; changes
  made in the main window (composer, shortcut, Quick Chat) show in PiP, and
  switching the main window to Avatar-only clears PiP's voice controls
- PiP opens at Portrait (close) with the whole head in frame, in both
  background modes; the camera button and the PiP camera menu switch presets
- the toolbar's Scene background toggle and the main canvas settings stay in
  step
- dragging the toolbar background moves the window; dragging the corner grip
  resizes it, and clicks on the Avatar pass through to the app underneath
- border, toolbar and grip appear when the cursor is anywhere inside the PiP
  window bounds
- browser web still uses Document PiP
