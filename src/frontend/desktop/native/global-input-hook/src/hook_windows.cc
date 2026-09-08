#include "platform_hook.h"

#include <windows.h>

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
DWORD hook_thread_id = 0;
HHOOK keyboard_hook = nullptr;
HHOOK mouse_hook = nullptr;
bool startup_complete = false;
bool startup_ok = false;
std::string startup_error;
HookConfig active_config;
HookEventCallback emit_event;
bool input_down = false;

struct KeyLocation {
  DWORD scan_code;
  bool extended;
};

std::optional<KeyLocation> KeyCode(const std::string &code) {
  // KBDLLHOOKSTRUCT.scanCode identifies the physical key like DOM `code`;
  // virtual-key matching would change punctuation/letter positions by layout.
  static const std::pair<const char *, KeyLocation> keys[] = {
      {"Escape", {0x01, false}},       {"Digit1", {0x02, false}},
      {"Digit2", {0x03, false}},       {"Digit3", {0x04, false}},
      {"Digit4", {0x05, false}},       {"Digit5", {0x06, false}},
      {"Digit6", {0x07, false}},       {"Digit7", {0x08, false}},
      {"Digit8", {0x09, false}},       {"Digit9", {0x0A, false}},
      {"Digit0", {0x0B, false}},       {"Minus", {0x0C, false}},
      {"Equal", {0x0D, false}},        {"Backspace", {0x0E, false}},
      {"Tab", {0x0F, false}},          {"KeyQ", {0x10, false}},
      {"KeyW", {0x11, false}},         {"KeyE", {0x12, false}},
      {"KeyR", {0x13, false}},         {"KeyT", {0x14, false}},
      {"KeyY", {0x15, false}},         {"KeyU", {0x16, false}},
      {"KeyI", {0x17, false}},         {"KeyO", {0x18, false}},
      {"KeyP", {0x19, false}},         {"BracketLeft", {0x1A, false}},
      {"BracketRight", {0x1B, false}}, {"Enter", {0x1C, false}},
      {"KeyA", {0x1E, false}},         {"KeyS", {0x1F, false}},
      {"KeyD", {0x20, false}},         {"KeyF", {0x21, false}},
      {"KeyG", {0x22, false}},         {"KeyH", {0x23, false}},
      {"KeyJ", {0x24, false}},         {"KeyK", {0x25, false}},
      {"KeyL", {0x26, false}},         {"Semicolon", {0x27, false}},
      {"Quote", {0x28, false}},        {"Backquote", {0x29, false}},
      {"Backslash", {0x2B, false}},    {"KeyZ", {0x2C, false}},
      {"KeyX", {0x2D, false}},         {"KeyC", {0x2E, false}},
      {"KeyV", {0x2F, false}},         {"KeyB", {0x30, false}},
      {"KeyN", {0x31, false}},         {"KeyM", {0x32, false}},
      {"Comma", {0x33, false}},        {"Period", {0x34, false}},
      {"Slash", {0x35, false}},        {"Space", {0x39, false}},
      {"F1", {0x3B, false}},           {"F2", {0x3C, false}},
      {"F3", {0x3D, false}},           {"F4", {0x3E, false}},
      {"F5", {0x3F, false}},           {"F6", {0x40, false}},
      {"F7", {0x41, false}},           {"F8", {0x42, false}},
      {"F9", {0x43, false}},           {"F10", {0x44, false}},
      {"F11", {0x57, false}},          {"F12", {0x58, false}},
      {"F13", {0x64, false}},          {"F14", {0x65, false}},
      {"F15", {0x66, false}},          {"F16", {0x67, false}},
      {"F17", {0x68, false}},          {"F18", {0x69, false}},
      {"F19", {0x6A, false}},          {"F20", {0x6B, false}},
      {"F21", {0x6C, false}},          {"F22", {0x6D, false}},
      {"F23", {0x6E, false}},          {"F24", {0x76, false}},
      {"NumpadEnter", {0x1C, true}},   {"Home", {0x47, true}},
      {"ArrowUp", {0x48, true}},       {"PageUp", {0x49, true}},
      {"ArrowLeft", {0x4B, true}},     {"ArrowRight", {0x4D, true}},
      {"End", {0x4F, true}},           {"ArrowDown", {0x50, true}},
      {"PageDown", {0x51, true}},      {"Insert", {0x52, true}},
      {"Delete", {0x53, true}},
  };
  for (const auto &[name, value] : keys)
    if (code == name)
      return value;
  return std::nullopt;
}

bool KeyPressed(int key) { return (GetAsyncKeyState(key) & 0x8000) != 0; }

bool ModifiersMatch() {
  return KeyPressed(VK_CONTROL) == active_config.ctrl &&
         KeyPressed(VK_MENU) == active_config.alt &&
         KeyPressed(VK_SHIFT) == active_config.shift &&
         (KeyPressed(VK_LWIN) || KeyPressed(VK_RWIN)) == active_config.meta;
}

void Transition(bool down) {
  if (down && !input_down && ModifiersMatch()) {
    input_down = true;
    emit_event(true);
  } else if (!down && input_down) {
    input_down = false;
    emit_event(false);
  }
}

LRESULT CALLBACK KeyboardProcedure(int code, WPARAM message, LPARAM data) {
  if (code == HC_ACTION && !active_config.mouse) {
    const auto *event = reinterpret_cast<KBDLLHOOKSTRUCT *>(data);
    const auto wanted = KeyCode(active_config.code);
    const bool extended = (event->flags & LLKHF_EXTENDED) != 0;
    if (wanted && event->scanCode == wanted->scan_code &&
        extended == wanted->extended) {
      if (message == WM_KEYDOWN || message == WM_SYSKEYDOWN)
        Transition(true);
      if (message == WM_KEYUP || message == WM_SYSKEYUP)
        Transition(false);
    }
  }
  return CallNextHookEx(nullptr, code, message, data);
}

std::optional<std::pair<int, bool>>
MouseTransition(WPARAM message, const MSLLHOOKSTRUCT *event) {
  switch (message) {
  case WM_LBUTTONDOWN:
    return {{1, true}};
  case WM_LBUTTONUP:
    return {{1, false}};
  case WM_MBUTTONDOWN:
    return {{2, true}};
  case WM_MBUTTONUP:
    return {{2, false}};
  case WM_RBUTTONDOWN:
    return {{3, true}};
  case WM_RBUTTONUP:
    return {{3, false}};
  case WM_XBUTTONDOWN:
    return {{HIWORD(event->mouseData) == XBUTTON1 ? 4 : 5, true}};
  case WM_XBUTTONUP:
    return {{HIWORD(event->mouseData) == XBUTTON1 ? 4 : 5, false}};
  default:
    return std::nullopt;
  }
}

LRESULT CALLBACK MouseProcedure(int code, WPARAM message, LPARAM data) {
  if (code == HC_ACTION && active_config.mouse) {
    const auto *event = reinterpret_cast<MSLLHOOKSTRUCT *>(data);
    const auto transition = MouseTransition(message, event);
    if (transition && transition->first == active_config.button)
      Transition(transition->second);
  }
  return CallNextHookEx(nullptr, code, message, data);
}

void RunHook() {
  // Force creation of the thread message queue before the starter can post
  // WM_QUIT during a fast shutdown.
  MSG initial_message;
  PeekMessageW(&initial_message, nullptr, WM_USER, WM_USER, PM_NOREMOVE);
  HMODULE module = nullptr;
  const bool found_module =
      GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS |
                             GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                         reinterpret_cast<LPCWSTR>(&state_mutex), &module);
  if (found_module) {
    if (active_config.mouse)
      mouse_hook = SetWindowsHookExW(WH_MOUSE_LL, MouseProcedure, module, 0);
    else
      keyboard_hook =
          SetWindowsHookExW(WH_KEYBOARD_LL, KeyboardProcedure, module, 0);
  }
  {
    std::scoped_lock lock(state_mutex);
    hook_thread_id = GetCurrentThreadId();
    startup_ok =
        found_module && (active_config.mouse ? mouse_hook != nullptr
                                             : keyboard_hook != nullptr);
    if (!startup_ok)
      startup_error = "Windows could not install the global input monitor.";
    startup_complete = true;
  }
  state_changed.notify_all();

  if (startup_ok) {
    MSG message;
    while (GetMessageW(&message, nullptr, 0, 0) > 0) {
      TranslateMessage(&message);
      DispatchMessageW(&message);
    }
  }
  if (keyboard_hook)
    UnhookWindowsHookEx(keyboard_hook);
  if (mouse_hook)
    UnhookWindowsHookEx(mouse_hook);
  keyboard_hook = nullptr;
  mouse_hook = nullptr;
  std::scoped_lock lock(state_mutex);
  hook_thread_id = 0;
}

} // namespace

bool PlatformHookSupported() { return true; }
bool PlatformPermissionGranted() { return true; }
bool PlatformRequestPermission() { return true; }

bool PlatformStartHook(const HookConfig &config, HookEventCallback callback,
                       std::string *error) {
  if (!config.mouse && !KeyCode(config.code)) {
    *error = "The selected keyboard key is not supported on Windows.";
    return false;
  }
  if (config.mouse && config.button > 5) {
    *error = "Windows supports Press to talk on mouse buttons 1 through 5.";
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
  DWORD thread_id = 0;
  {
    std::scoped_lock lock(state_mutex);
    thread_id = hook_thread_id;
  }
  if (thread_id)
    PostThreadMessageW(thread_id, WM_QUIT, 0, 0);
  if (hook_thread.joinable())
    hook_thread.join();
  std::scoped_lock lock(state_mutex);
  emit_event = nullptr;
  input_down = false;
}
