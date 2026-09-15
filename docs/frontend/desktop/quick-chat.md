# Desktop Quick Chat

Desktop Quick Chat is a transparent native Electron window that renders the
chat-only conversation UI for the current anima. It is opened from the main
renderer through the global `Ctrl + Slash` shortcut.

## Goals

Quick Chat should:

- open without browser URL/title chrome
- use a transparent window background
- pass clicks through transparent outer regions
- keep the chat column scrollable
- center and focus the chat input when shown
- stack messages upward from directly above the centered chat input
- grow the native window upward as messages need more space, until the window
  reaches the work-area top
- reuse the normal chat-only message/input UI
- keep the main renderer as the owner of chat request, Voice Mode, TTS, and
  desktop shortcut registration
- avoid starting a second microphone, TTS, avatar, or shortcut runtime

## High-Level Flow

```text
Main web renderer
  -> useDesktopQuickChatOwner()
  -> window.animamaDesktop.quickChat.prepare(...)
  -> ipcMain
  -> QuickChatWindowManager
  -> hidden frameless BrowserWindow
  -> /desktop/quick-chat/$animaId
  -> Quick Chat renderer requests a mirrored snapshot
  -> main process replays the latest mirrored snapshot or forwards the request
  -> Quick Chat renderer mounts snapshot-backed UI and sends ready
  -> main process waits for native ready-to-show
  -> useDesktopVoiceShortcuts()
  -> quick_chat/down
  -> window.animamaDesktop.quickChat.toggle(...)
  -> main process shows/focuses/reveals the window
```

The main renderer remains the runtime owner. The Quick Chat renderer is a
mirrored control surface: it displays snapshots from the main renderer and sends
commands back to it.

## Shortcut

Quick Chat is stored in `speech.desktop_shortcuts.quick_chat` and defaults to:

```ts
{ code: "Slash", key: "/", ctrlKey: true }
```

It is a one-shot Electron `globalShortcut`, so it uses the same 100 ms
main-process cooldown as Voice Mode toggle, mute toggle, and Skip TTS. The
shortcut is only enabled while the main renderer has an active anima route.
PiP and Quick Chat windows cannot configure or receive shortcut events.

## Main-Process Window

The window is managed by:

```text
desktop/src/main-process/quick-chat/quick-chat-window-manager.ts
```

It is created as a hidden, frameless, transparent BrowserWindow with the
`quick-chat` role:

```ts
new BrowserWindow({
  width,
  height,
  minWidth: 420,
  minHeight: 420,
  frame: false,
  transparent: true,
  backgroundColor: "#00000000",
  hasShadow: false,
  paintWhenInitiallyHidden: true,
  resizable: true,
  alwaysOnTop: true,
  skipTaskbar: true,
  fullscreenable: false,
  show: false,
  type: "toolbar",
  title: "Anima Quick Chat",
  webPreferences: {
    preload,
    additionalArguments: ["--animama-window-role=quick-chat"],
    backgroundThrottling: false,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
  },
});
```

The default bounds are centered on the owner window's display work area. The
manager recenters the existing hidden window before each visible show to avoid
window-manager placement drift across repeated hide/show cycles. This drift is a
native remapping behavior: Linux window managers/compositors can re-apply
floating-window placement when a hidden `toolbar` window is shown again, so the
manager reapplies the intended bounds before and immediately after mapping the
window. Bounds are not persisted in the initial implementation.

## Loading And Visibility

The main process constructs the route from the trusted configured web origin:

```text
/desktop/quick-chat/$animaId?desktopQuickChat=1
```

If the current main route has a chat id, `chatId` is appended as a query
parameter. Renderers do not provide arbitrary Quick Chat URLs.

The main renderer prewarms the Quick Chat window with `prepare(...)` while a
anima route is active. Prewarm creates or retargets the hidden BrowserWindow,
loads the Quick Chat route, and lets it receive mirrored runtime state before
the user presses `Ctrl + Slash`.

The window starts hidden and becomes visible only after both readiness gates are
satisfied:

- the Quick Chat renderer has received the first mirrored snapshot, mounted the
  snapshot-backed chat UI, and sent a `ready` runtime message
- Electron has emitted `ready-to-show` for the hidden BrowserWindow, with a
  conservative timeout fallback in case a Linux window manager/compositor does
  not emit it reliably

Until the first snapshot arrives, the route renders an empty transparent surface
instead of fallback chat content. When shown, the main process maps the window at
opacity `0`, focuses the BrowserWindow, reveals it after a short compositor
handoff delay, and sends a `focus-input` runtime message so the visible Quick
Chat textarea receives focus.

If `Ctrl + Slash` is pressed while Quick Chat is already visible for the same
anima/chat, the window hides but the BrowserWindow and renderer stay alive for
the next open. The window is destroyed when the owner main renderer is destroyed.
If the main renderer has moved to another anima, the existing hidden Quick
Chat window reloads for the new anima. Chat-id changes update state without
forcing a reload because the route is anima-scoped and the mirrored snapshot
contains the current chat state.

## Window Roles

The desktop preload exposes:

```ts
window.animamaDesktop.windowRole = "main" | "pip" | "quick-chat";
```

Quick Chat receives:

```text
--animama-window-role=quick-chat
```

The web runtime platform exposes `capabilities.nativeQuickChat` when the preload
bridge provides the Quick Chat API. Main-window hooks use the role check to
ensure only the main renderer owns desktop shortcuts and runtime side effects.

## IPC Surface

The preload bridge is defined in:

```text
desktop/src/main-process/quick-chat/quick-chat-preload.cts
```

The main-process IPC handlers are defined in:

```text
desktop/src/main-process/quick-chat/quick-chat-ipc.ts
```

The renderer bridge is:

```ts
window.animamaDesktop.quickChat = {
  open(options): Promise<DesktopQuickChatState>;
  prepare(options): Promise<DesktopQuickChatState>;
  close(): Promise<DesktopQuickChatState>;
  toggle(options): Promise<DesktopQuickChatState>;
  getState(): Promise<DesktopQuickChatState>;
  publishRuntimeMessage(message): Promise<void>;
  onRuntimeMessage(callback): () => void;
  onStateChange(callback): () => void;
  setInteractiveRegions(regions): Promise<void>;
  setLayoutMetrics(metrics): Promise<void>;
};
```

`DesktopQuickChatState` includes:

```ts
type DesktopQuickChatState = {
  isOpen: boolean;
  animaId: string | null;
  chatId: string | null;
};
```

`isOpen` means the native window is currently visible. `animaId` and `chatId`
may remain populated while the window is hidden so the prewarmed renderer can be
reused.

Runtime messages are validated, cloneable envelopes with a `type`, `sequence`,
`sentAtMs`, `animaId`, and `payload`.

The main process buffers the latest owner `snapshot` message. When a prewarmed
Quick Chat renderer requests a snapshot, the manager can replay that buffered
snapshot immediately and avoid a request/response round trip through the owner
renderer.

## Dedicated Route

The Quick Chat route lives at:

```text
web/src/routes/desktop/quick-chat/$animaId.tsx
```

Route path:

```text
/desktop/quick-chat/$animaId
```

This route stays outside `/a` so it avoids `AppShell`, sidebar, header,
`MainShell`, avatar canvas, and main-window shortcut ownership. It renders the
shared `ChatInterfaceView` in `layout="chat-only"` mode inside a
`SettingsProvider`.

Quick Chat passes `quickChatSurface` to the shared chat view. That mode keeps
the same message bubbles and `ChatInput`, but changes the vertical layout so the
input is centered in the native window and the conversation viewport sits above
it. Short message lists are bottom-aligned in that viewport, so messages appear
directly above the input and grow upward toward the top. Once the message stack
needs more room than the current conversation viewport provides, the Quick Chat
renderer reports layout metrics to the main process. The main process then grows
the transparent BrowserWindow upward, preserving its bottom anchor, until it
reaches the display work-area top. Once the native window cannot grow farther,
the conversation viewport scrolls. The bottom spacer is fixed from the initial
centered-input geometry, so growing the native window adds space above the input
without moving the input upward on every new bubble. Quick Chat intentionally
hides the first-chat prompt suggestions even when the main renderer includes
them in the mirrored snapshot.

The route requires the Electron `quick-chat` window role and Quick Chat preload
bridge. Other windows and browsers redirect to `/`. The main renderer owns chat
and voice work; the auxiliary renderer exchanges bounded snapshots and commands.

## Runtime Mirror

The mirror protocol lives in:

```text
web/src/hooks/useDesktopQuickChatRuntime.ts
```

The main renderer publishes snapshots with:

- current anima and chat ids
- input value and placeholder
- chat availability
- streaming state
- display messages
- prompt suggestions
- coarse voice state: active mode, preparing state, capture state, and mute
  state
- user-speaking state from the main renderer's avatar interaction phase

The Quick Chat renderer sends commands back to the main renderer:

- set input
- submit text
- stop streaming
- start dictation
- start Voice Mode
- stop the mic session
- toggle Voice Mode mute
- refresh model/anima state after model selector changes

Quick Chat renders a synthetic waveform from the mirrored voice state. It uses
the main renderer's user-speaking phase to animate larger bars and falls back to
short idle bars while the mic is listening or muted. It does not receive the
main renderer's `MediaStream`, audio amplitude, or a second microphone stream.

## Transparent Hit Testing

Transparent document styling is activated with:

```text
data-animama-quick-chat="true"
```

The Quick Chat route periodically reports interactive rectangles to the main
process through `setInteractiveRegions`. Interactive regions include:

- the chat scroll column
- the chat input area
- visible model selector dialogs
- visible popovers

The same route also reports layout metrics through `setLayoutMetrics`, based on
the measured chat input height and message stack height. Those metrics drive the
native upward resize behavior.

The main process polls the cursor and calls
`setIgnoreMouseEvents(true, { forward: true })` when the cursor is inside the
window bounds but outside those regions. This lets transparent outer regions
pass through to the desktop while preserving normal chat scrolling and input
interaction.

On Linux, click-through degrades gracefully when unsupported, matching the PiP
window behavior.

## Manual Test Checklist

- `Ctrl + Slash` opens Quick Chat on a anima route.
- The textarea is focused immediately after the window appears, without
  selecting the hidden measurement textarea used by the shared chat input.
- The chat input appears centered vertically in the native window.
- Short message lists start directly above the chat input and grow upward.
- The native Quick Chat window grows upward as more bubbles are added and stops
  growing at the work-area top before normal message scrolling begins.
- Repeatedly hiding and showing Quick Chat does not move the native window down.
- Typing and Enter submit through the main renderer.
- New conversation creation updates the main route and the mirrored Quick Chat
  state.
- `Esc` hides Quick Chat and keeps the renderer warm.
- Pressing `Ctrl + Slash` again hides Quick Chat when it targets the same
  anima/chat.
- Reopening Quick Chat for the same anima reuses the warm renderer and appears
  without repeating initial route loading.
- Pressing `Ctrl + Slash` after navigating the main window to another
  anima/chat retargets Quick Chat.
- The chat column scrolls older messages.
- Transparent outer regions pass clicks through to the desktop.
- Voice, mute, dictation, and stop icons mirror the main renderer's coarse
  state without starting a second mic capture.
- The synthetic waveform idles while listening or muted and animates when the
  main renderer enters the user-speaking phase.
- Existing PiP, Press to talk, Voice Mode toggle, mute toggle, and Skip TTS
  shortcuts still work.
