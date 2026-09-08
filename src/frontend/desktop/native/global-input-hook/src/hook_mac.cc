#include "platform_hook.h"

#include <ApplicationServices/ApplicationServices.h>
#include <CoreFoundation/CoreFoundation.h>

#include <condition_variable>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <utility>

namespace {

std::mutex state_mutex;
std::condition_variable state_changed;
std::thread hook_thread;
CFRunLoopRef hook_run_loop = nullptr;
CFMachPortRef event_tap = nullptr;
bool startup_complete = false;
bool startup_ok = false;
std::string startup_error;
HookConfig active_config;
HookEventCallback emit_event;
bool input_down = false;

std::optional<CGKeyCode> KeyCode(const std::string &code) {
  // DOM KeyboardEvent.code is physical-key based; these are Apple's hardware
  // virtual key codes and therefore do not change with the keyboard layout.
  static const std::pair<const char *, CGKeyCode> keys[] = {
      {"KeyA", 0},        {"KeyS", 1},         {"KeyD", 2},
      {"KeyF", 3},        {"KeyH", 4},         {"KeyG", 5},
      {"KeyZ", 6},        {"KeyX", 7},         {"KeyC", 8},
      {"KeyV", 9},        {"KeyB", 11},        {"KeyQ", 12},
      {"KeyW", 13},       {"KeyE", 14},        {"KeyR", 15},
      {"KeyY", 16},       {"KeyT", 17},        {"Digit1", 18},
      {"Digit2", 19},     {"Digit3", 20},      {"Digit4", 21},
      {"Digit6", 22},     {"Digit5", 23},      {"Equal", 24},
      {"Digit9", 25},     {"Digit7", 26},      {"Minus", 27},
      {"Digit8", 28},     {"Digit0", 29},      {"BracketRight", 30},
      {"KeyO", 31},       {"KeyU", 32},        {"BracketLeft", 33},
      {"KeyI", 34},       {"KeyP", 35},        {"Enter", 36},
      {"KeyL", 37},       {"KeyJ", 38},        {"Quote", 39},
      {"KeyK", 40},       {"Semicolon", 41},   {"Backslash", 42},
      {"Comma", 43},      {"Slash", 44},       {"KeyN", 45},
      {"KeyM", 46},       {"Period", 47},      {"Tab", 48},
      {"Space", 49},      {"Backquote", 50},   {"Backspace", 51},
      {"Escape", 53},     {"NumpadEnter", 76}, {"F17", 64},
      {"F18", 79},        {"F19", 80},         {"F20", 90},
      {"F5", 96},         {"F6", 97},          {"F7", 98},
      {"F3", 99},         {"F8", 100},         {"F9", 101},
      {"F11", 103},       {"F13", 105},        {"F16", 106},
      {"F14", 107},       {"F10", 109},        {"F12", 111},
      {"F15", 113},       {"Insert", 114},     {"Home", 115},
      {"PageUp", 116},    {"Delete", 117},     {"F4", 118},
      {"End", 119},       {"F2", 120},         {"PageDown", 121},
      {"F1", 122},        {"ArrowLeft", 123},  {"ArrowRight", 124},
      {"ArrowDown", 125}, {"ArrowUp", 126},
  };
  for (const auto &[name, value] : keys)
    if (code == name)
      return value;
  return std::nullopt;
}

int AnimamaMouseButton(CGEventRef event) {
  const auto native = static_cast<int>(
      CGEventGetIntegerValueField(event, kCGMouseEventButtonNumber));
  if (native == 0)
    return 1; // DOM left
  if (native == 1)
    return 3; // DOM right
  if (native == 2)
    return 2; // DOM middle
  return native + 1;
}

bool ModifiersMatch(CGEventRef event) {
  const CGEventFlags flags = CGEventGetFlags(event);
  return ((flags & kCGEventFlagMaskControl) != 0) == active_config.ctrl &&
         ((flags & kCGEventFlagMaskAlternate) != 0) == active_config.alt &&
         ((flags & kCGEventFlagMaskShift) != 0) == active_config.shift &&
         ((flags & kCGEventFlagMaskCommand) != 0) == active_config.meta;
}

CGEventRef HandleEvent(CGEventTapProxy, CGEventType type, CGEventRef event,
                       void *) {
  if (type == kCGEventTapDisabledByTimeout ||
      type == kCGEventTapDisabledByUserInput) {
    // A disabled tap may have missed the physical release. Fail closed so the
    // renderer cannot leave a microphone hold active while the tap recovers.
    if (input_down) {
      input_down = false;
      emit_event(false);
    }
    if (event_tap)
      CGEventTapEnable(event_tap, true);
    return event;
  }

  bool down = false;
  bool up = false;
  bool target = false;
  if (!active_config.mouse &&
      (type == kCGEventKeyDown || type == kCGEventKeyUp)) {
    const auto wanted = KeyCode(active_config.code);
    target = wanted && CGEventGetIntegerValueField(
                           event, kCGKeyboardEventKeycode) == *wanted;
    down = type == kCGEventKeyDown;
    up = type == kCGEventKeyUp;
  } else if (active_config.mouse) {
    down = type == kCGEventLeftMouseDown || type == kCGEventRightMouseDown ||
           type == kCGEventOtherMouseDown;
    up = type == kCGEventLeftMouseUp || type == kCGEventRightMouseUp ||
         type == kCGEventOtherMouseUp;
    target = (down || up) && AnimamaMouseButton(event) == active_config.button;
  }

  if (!target)
    return event;
  if (down && !input_down && ModifiersMatch(event)) {
    input_down = true;
    emit_event(true);
  } else if (up && input_down) {
    input_down = false;
    emit_event(false);
  }
  return event; // Listen-only: Animama never suppresses global input.
}

void RunHook() {
  const CGEventMask mask =
      active_config.mouse
          ? CGEventMaskBit(kCGEventLeftMouseDown) |
                CGEventMaskBit(kCGEventLeftMouseUp) |
                CGEventMaskBit(kCGEventRightMouseDown) |
                CGEventMaskBit(kCGEventRightMouseUp) |
                CGEventMaskBit(kCGEventOtherMouseDown) |
                CGEventMaskBit(kCGEventOtherMouseUp)
          : CGEventMaskBit(kCGEventKeyDown) | CGEventMaskBit(kCGEventKeyUp);
  CFMachPortRef tap =
      CGEventTapCreate(kCGSessionEventTap, kCGHeadInsertEventTap,
                       kCGEventTapOptionListenOnly, mask, HandleEvent, nullptr);
  CFRunLoopSourceRef source =
      tap ? CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
          : nullptr;

  {
    std::scoped_lock lock(state_mutex);
    if (!tap || !source) {
      startup_error =
          "macOS did not create the global input monitor. Allow Animama in "
          "Privacy & Security > Input Monitoring, then retry.";
      startup_ok = false;
    } else {
      event_tap = tap;
      hook_run_loop = CFRunLoopGetCurrent();
      CFRetain(hook_run_loop);
      startup_ok = true;
    }
    startup_complete = true;
  }
  state_changed.notify_all();

  if (tap && source) {
    CFRunLoopAddSource(CFRunLoopGetCurrent(), source, kCFRunLoopCommonModes);
    CGEventTapEnable(tap, true);
    CFRunLoopRun();
    CFRunLoopRemoveSource(CFRunLoopGetCurrent(), source, kCFRunLoopCommonModes);
  }

  if (source)
    CFRelease(source);
  if (tap)
    CFRelease(tap);
  {
    std::scoped_lock lock(state_mutex);
    event_tap = nullptr;
    if (hook_run_loop) {
      CFRelease(hook_run_loop);
      hook_run_loop = nullptr;
    }
  }
}

} // namespace

bool PlatformHookSupported() { return true; }

bool PlatformPermissionGranted() { return CGPreflightListenEventAccess(); }

bool PlatformRequestPermission() { return CGRequestListenEventAccess(); }

bool PlatformStartHook(const HookConfig &config, HookEventCallback callback,
                       std::string *error) {
  if (!config.mouse && !KeyCode(config.code)) {
    *error = "The selected keyboard key is not supported on macOS.";
    return false;
  }
  if (!PlatformPermissionGranted()) {
    *error = "Global input monitoring permission is required on macOS.";
    return false;
  }
  PlatformStopHook();
  {
    std::scoped_lock lock(state_mutex);
    active_config = config;
    emit_event = std::move(callback);
    input_down = false;
    startup_complete = false;
    startup_ok = false;
    startup_error.clear();
  }
  hook_thread = std::thread(RunHook);
  std::unique_lock lock(state_mutex);
  state_changed.wait(lock, [] { return startup_complete; });
  if (!startup_ok) {
    *error = startup_error;
    lock.unlock();
    PlatformStopHook();
    return false;
  }
  return true;
}

void PlatformStopHook() {
  CFRunLoopRef loop = nullptr;
  {
    std::scoped_lock lock(state_mutex);
    if (hook_run_loop) {
      loop = hook_run_loop;
      CFRetain(loop);
    }
  }
  if (loop) {
    CFRunLoopStop(loop);
    CFRunLoopWakeUp(loop);
    CFRelease(loop);
  }
  if (hook_thread.joinable())
    hook_thread.join();
  std::scoped_lock lock(state_mutex);
  emit_event = nullptr;
  input_down = false;
}
