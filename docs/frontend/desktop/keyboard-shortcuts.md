# Desktop Keyboard Shortcuts

Animama Desktop supports global voice shortcuts through the Electron main
process. The browser web app can store and display these application preferences,
but shortcut capture only runs inside the desktop app.

For the auxiliary chat window, see [Quick Chat](quick-chat.md).

## Defaults

| Action                   | Default                    | Type     | Availability                         |
| ------------------------ | -------------------------- | -------- | ------------------------------------ |
| Press to talk            | `Ctrl + Backquote`         | hold     | active Voice Mode                    |
| Quick Chat               | `Ctrl + Slash`             | one-shot | active anima chat route              |
| Dictation on/off         | `Ctrl + Alt + D`           | one-shot | chat-capable surface, Voice Mode off |
| Toggle Voice Mode on/off | `Ctrl + Alt + Backquote`   | one-shot | chat-capable chat surface            |
| Toggle mute              | `Ctrl + Shift + Backquote` | one-shot | active Voice Mode                    |
| Skip TTS                 | `Ctrl + ArrowRight`        | one-shot | active TTS playback                  |

`Backquote` is the physical key usually labeled `` ` `` or `~` on US
keyboards. It is stored by DOM `code`, so it follows the physical key rather
than the character produced by a specific keyboard layout.

## User Behavior

Voice Mode uses a single microphone behavior: the microphone session stays open
until Voice Mode is stopped or muted. Press to talk is only a hold shortcut for
that same Voice Mode session: while Voice Mode is active and muted, holding the
shortcut temporarily unmutes the microphone and releasing it mutes the
microphone again. It does not start Voice Mode.

Detailed rules:

- Press to talk does nothing while Voice Mode is off.
- If the mic is already unmuted before Press to talk is held, releasing Press to
  talk does not mute it.
- If Press to talk unmutes the mic, releasing it mutes the mic again as long as
  Voice Mode is still active.
- Press to talk release flushes any active speech window before muting so the
  release acts as the utterance boundary for STT. The flushed speech window
  still runs through Smart Turn, but uses a lower `0.05` end-turn threshold.
- If Voice Mode stops or shortcut capture is paused while Press to talk is held,
  the main process emits a synthetic release event and clears the held state.
- Press to talk events are observed only; they are not suppressed from other
  applications.
- Quick Chat shows or hides a prewarmed transparent desktop chat window for the
  current anima. The main chat renderer remains the owner of dispatch, Voice
  Mode, TTS, and shortcut state; the Quick Chat window mirrors state and sends
  commands back to the main renderer.
- Dictation on/off starts dictation into the composer, or stops it when it is
  running. It does nothing during Voice Mode, which owns the microphone.
- Skip TTS stops the active spoken response without changing Voice Mode state.
- On the desktop, the composer's tooltips name the shortcut for what the button
  does now: Dictate or Stop dictation (Dictation on/off), Voice Mode or Stop
  Voice Mode (Toggle Voice Mode on/off) and Mute or Unmute (Toggle mute). The
  reply bubble's Skip speech button names Skip TTS.

## Settings UI

Shortcut preferences live under:

```text
Application settings -> Voice -> Desktop -> Shortcuts
```

The shortcut recorder accepts keyboard shortcuts for every row. Press to talk
also accepts mouse button input, including extra mouse buttons. Mouse shortcuts
are intentionally rejected for the one-shot rows because Electron
`globalShortcut` only supports keyboard accelerators.

The settings modal sets `shortcutCaptureActive` while a shortcut is being
recorded. The main process pauses shortcut handling during that window so the
recording control can receive the input first.

## Persisted Shape

The settings are stored under `user_settings.preferences.speech.desktop_shortcuts`,
with entries for `press_to_talk`, `quick_chat`, `toggle_dictation`,
`toggle_voice_mode`, `toggle_voice_mute` and `skip_tts`. A missing or invalid
entry, such as `toggle_dictation` in preferences saved before it existed, uses
the default. Keyboard entries contain a physical `code`,
optional display `key`, optional `type: "keyboard"` and modifier flags
`ctrlKey`, `altKey`, `shiftKey`, `metaKey`. Mouse entries use `type: "mouse"`,
`button` and the same modifier flags.

Existing keyboard records without a `type` field remain valid for backward
compatibility. The optional `key` field is display metadata only; matching uses
the physical `code`.

Mouse buttons use the browser recorder's button number plus one: left is 1,
middle is 2, right is 3, and extra buttons begin at 4. They are displayed
generically, for example `Mouse Button 4`.

## Validation Rules

Persisted invalid shortcuts fall back to defaults during preference resolution.

Keyboard shortcut rules:

- must include at least one modifier
- must use a non-modifier key
- must use a supported accelerator key
- may omit `type` or set `type: "keyboard"`

Mouse shortcut rules:

- only valid for `press_to_talk`
- must use `type: "mouse"`
- must use a positive integer `button` value
- may include modifier flags

Conflicts are checked in the settings UI by comparing shortcut signatures. A
keyboard shortcut can conflict only with another keyboard shortcut. A mouse
shortcut can conflict only with another mouse shortcut, though today only Press
to talk accepts mouse bindings.

## Runtime Behavior

The renderer sends the effective shortcut config and current chat context to
`window.animamaDesktop.shortcuts`. The main process owns global keyboard
capture for one-shot shortcuts through Electron `globalShortcut`. Press to talk
uses Animama's focused first-party native addon so the main process can observe
both down and up events for the one configured keyboard or mouse binding. The
addon matches the shortcut natively and reports only a Boolean down/up
transition; general input never crosses into JavaScript.

Electron `globalShortcut` does not expose release events and may invoke the
registered callback repeatedly while the user holds an accelerator. One-shot
actions therefore use a 100 ms leading-edge cooldown in the main process: the
first callback emits the action, and repeated callbacks for the same action
extend the cooldown without emitting another action.

The main process sends `{action, phase: "down" | "up"}` events to the main
renderer. Actions use the persisted names above.

PiP and Quick Chat windows cannot configure or receive shortcut events.

## Renderer Flow

The chat runtime owns the actual voice behavior:

```text
ChatInterface
  -> resolveDesktopShortcuts(...)
  -> useDesktopVoiceShortcuts(...)
  -> window.animamaDesktop.shortcuts.configure(...)
  -> window.animamaDesktop.shortcuts.setContext(...)
```

`useDesktopVoiceShortcuts` applies the behavior described above. Electron knows
whether an action is available; the chat runtime owns microphone and playback.

## Main-Process Flow

The desktop IPC handler lives at:

```text
desktop/src/main-process/shortcuts/shortcuts-ipc.ts
```

The preload bridge lives at:

```text
desktop/src/main-process/shortcuts/shortcuts-preload.cts
```

Main-process responsibilities:

- validate shortcut config from the renderer
- reject shortcut configuration from PiP and Quick Chat windows
- register one-shot keyboard accelerators with `globalShortcut`
- debounce repeated one-shot callbacks caused by OS key repeat
- start the first-party platform hook for Press to talk
- pass one validated binding into native code and receive only its down/up events
- synthesize a Press to talk release when the context disables while held
- report registration or hook failures through shortcut status
- unregister shortcuts and stop hooks when the owning renderer is destroyed or
  the app quits

The shortcut status object returned by `configure`, `setContext`, and
`getStatus` includes:

```ts
type DesktopShortcutsStatus = {
  platform: NodeJS.Platform;
  supported: boolean;
  enabled: boolean;
  requiresPermission: boolean;
  reason: string | null;
  error: string | null;
};
```

The renderer shows a toast when `error` is set. If the first-party addon fails
to load or start, one-shot shortcuts can still work because they remain
registered through Electron `globalShortcut`. On macOS, `requiresPermission`
is true until Animama has Input Monitoring permission; the permission request
uses the operating-system API and never opens an arbitrary settings URL.

## Packaging

Press to talk depends on a first-party N-API addon whose source lives at:

```text
desktop/native/global-input-hook
```

`pnpm desktop:build` invokes pinned `node-gyp` for the current target, reusing
installed Node headers when they are available, and writes the resulting binary
to:

```text
desktop/dist/native/animama_input_hook.node
```

Electron Builder unpacks that `.node` file from ASAR. The runtime audit requires
exactly this first-party native file, loads it with the staged Electron binary,
and verifies its five-function interface before packaging:

```yaml
asarUnpack:
  - dist/native/*.node
```

Use `pnpm desktop:pack` as the packaging smoke test when changing shortcut
runtime dependencies.

## Platform Notes

The addon has focused macOS and Windows implementations:

- macOS uses a listen-only CoreGraphics session event tap on its own run loop.
  It matches physical key codes, exact modifiers, and mouse buttons without
  modifying or suppressing the event.
- Windows uses `WH_KEYBOARD_LL` and `WH_MOUSE_LL` on a dedicated message-loop
  thread. It handles ordinary versus numpad Enter and mouse buttons 1 through 5.

Linux retains Electron one-shot shortcuts, including the Wayland portal feature
switch where available, but global hold-to-talk is unsupported.

Platform-specific caveats:

- macOS requires Input Monitoring permission for the global hold listener. A
  denied request leaves one-shot shortcuts operational and reports recovery in
  shortcut status.
- Linux global keyboard shortcuts may depend on the desktop environment,
  Wayland portal support, and compositor policy.
- Windows supports the five standard/X mouse buttons for Press to talk.
- Packaged builds must include the first-party addon compiled for the target OS
  and CPU architecture.

## Troubleshooting

Useful checks from `src/frontend`:

```sh
pnpm desktop:check
pnpm desktop:build
pnpm desktop:pack
```

If shortcuts do not fire:

- Confirm the app is running in Animama Desktop, not browser web.
- Confirm a chat-capable chat surface is focused or active.
- Confirm Voice Mode is active for Press to talk and Toggle mute.
- Confirm TTS is currently playing for Skip TTS.
- Check whether the settings modal is recording a shortcut.
- Check the renderer toast for shortcut registration or hook errors.
- Use **Open Logs** from the desktop recovery window, or inspect the macOS
  runtime logs:

```text
~/Library/Application Support/Animama/runtime/logs
```

See [Troubleshooting](troubleshooting.md) before sharing logs or changing permissions.

If packaged Press to talk fails but development works, inspect the unpacked app
for the first-party addon:

```text
resources/app.asar.unpacked/dist/native/animama_input_hook.node
```

If a keyboard shortcut fails to register, it may already be reserved by the OS
or another app. Rebind it in Application settings and try again.

## Compiled Native Checks

Run from `src/frontend` on macOS 15+ on Apple silicon with Xcode Command Line
Tools installed (on Windows, see
[the unsigned Windows package](platforms.md#unsigned-windows-package)):

```sh
pnpm desktop:test -- tests/global-input-hook.test.ts
pnpm desktop:test:native-input
```

The first command tests the JavaScript/N-API wrapper contract. The second compiles
the actual macOS hook implementation into a temporary C++ test executable and
executes its matcher and event callback. It checks all 16 configured modifier
combinations against all 16 input combinations, with and without Caps Lock/Fn,
plus wrong keys, repeat/release handling and disabled-tap recovery. Including the
production source in the test translation unit makes its private matcher directly
testable without exporting an extra native API or duplicating the algorithm.

The executable creates unposted CoreGraphics events only. It never starts an
event tap, requests permission or observes real input, and its temporary build
directory is removed after success or failure. Unsupported hosts fail this explicit
command rather than recording a skipped native check as passing. A compiler
failure also fails the check. This proves compiled matching/callback behavior;
it does not verify N-API loading, OS permission, event-tap delivery, actual keyboard
layout behavior or the packaged application.

## Native macOS Acceptance Journey

This remains a manual acceptance check on the exact candidate. A passing compiled
test or wrapper test does not complete it. Use macOS 15+ on Apple silicon, including
the minimum supported OS before release, and follow the separate-account and
isolated-data requirements in [Releases](releases.md). Do not reset privacy grants
or use an existing personal profile to create a clean test state.

Record the source revision, application/addon hashes, signing status, OS build,
hardware, keyboard layout, offline speech model version, initial Input Monitoring
grant and test-account isolation. Launch the `.app` normally through Finder or
LaunchServices so permission belongs to that application. Voice Mode requires the
installed offline speech CPU model and microphone permission; if unavailable, record the
affected steps as blocked instead of substituting mocked voice state.

1. Begin in a separate test account without Input Monitoring permission for this
   application. Open an Anima chat and enable desktop shortcuts. Decline the
   normal OS permission request. Verify global hold capture is unavailable and
   shortcut status reports permission/recovery. Verify a one-shot shortcut such
   as Quick Chat still works. Record the actual prompt/status; do not inject
   events or bypass the permission check.
2. Grant Input Monitoring to the exact application in System Settings when ready
   to continue, then quit and reopen normally if macOS requests it. Confirm the
   permission status recovers and no duplicate shortcut registrations appear.
3. With Voice Mode active and muted, physically hold `Ctrl + Backquote`. Confirm
   one unmute transition, including a long hold/key repeat, then one mute on
   release. Repeat with left and right Control. Release Control before Backquote
   and confirm the final key release still clears the hold.
4. Check missing and extra modifiers and a different physical key. None should
   activate the hold. The default extra-modifier combinations are separate
   one-shot actions: temporarily rebind those actions to non-conflicting keys in
   the isolated profile before testing this case, and restore them afterward.
   Repeat with Caps Lock and Fn when the keyboard/OS exposes them; record hardware
   limitations explicitly.
5. Keep the Anima chat selected but focus a harmless text editor. Verify the same
   hold/release still works globally and the editor receives its normal key
   events. Check that arbitrary typing neither activates the hold nor appears
   as raw key data in application logs. Do not type personal content during this
   check. Test another keyboard layout if supported and record the physical key.
6. During a hold, stop Voice Mode or begin shortcut recording in settings. Verify
   the microphone is not left unmuted by the old hold. Resume Voice Mode, restore
   muted state and confirm a new hold/release works. Quit and reopen, then repeat
   a normal hold to check listener cleanup/re-registration.
7. Revoke only this test application's Input Monitoring grant through System
   Settings, quit/reopen and verify unavailable capture is reported safely.
   Grant again and repeat the recovery check. Record whether macOS required a
   relaunch. Finish the existing checklist below, including the supported mouse
   binding, initially unmuted state and Voice Mode off behavior.

Keep a row for each step with **pass / fail / blocked / not run**, observed
behavior and any screenshot/log reference. A failure needs a reproduction and
remediation; a blocked step remains an acceptance obligation with an owner.
Do not label the entire journey passed while a required step is missing. Record
Raymond's review separately from the operator's execution and from signed release
approval.

## Manual Test Checklist

- With Voice Mode off, Press to talk does nothing.
- With Voice Mode on and muted, holding `Ctrl + Backquote` unmutes; releasing
  it mutes again.
- With Voice Mode on and unmuted, holding and releasing Press to talk does not
  change the mute state.
- Rebind Press to talk to an extra mouse button; holding that button unmutes and
  releasing it mutes again.
- `Ctrl + Alt + Backquote` toggles Voice Mode.
- `Ctrl + Shift + Backquote` toggles Voice Mode mute.
- `Ctrl + ArrowRight` skips active TTS.
- `Ctrl + Alt + D` starts dictation, and pressing it again stops it; it does
  nothing during Voice Mode.
- Hovering Dictate, Voice Mode and the Voice Mode mute button shows the matching
  shortcut, and the shown shortcut follows a rebinding.
- `Ctrl + Slash` shows or hides Quick Chat on an Anima chat route, focuses the
  chat input, and lets transparent outer window regions pass clicks through.
- Recording a shortcut in settings pauses shortcut handling and persists the new
  binding.
