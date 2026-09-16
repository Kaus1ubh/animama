// Compile the production implementation into this test translation unit so the
// anonymous-namespace matcher and callback are exercised without a test-only
// exported API. Events are local values: never start a tap or post global input.
#include "../src/hook_mac.cc"

#include <cstdlib>
#include <iostream>
#include <vector>

namespace {

unsigned assertions = 0;

void Require(bool condition, const std::string &message) {
  ++assertions;
  if (!condition) {
    std::cerr << "FAIL: " << message << '\n';
    std::exit(1);
  }
}

CGEventFlags Flags(unsigned modifiers) {
  return ((modifiers & 1) ? kCGEventFlagMaskControl : 0) |
         ((modifiers & 2) ? kCGEventFlagMaskAlternate : 0) |
         ((modifiers & 4) ? kCGEventFlagMaskShift : 0) |
         ((modifiers & 8) ? kCGEventFlagMaskCommand : 0);
}

void SetBinding(unsigned modifiers) {
  active_config = HookConfig{};
  active_config.code = "Backquote";
  active_config.ctrl = (modifiers & 1) != 0;
  active_config.alt = (modifiers & 2) != 0;
  active_config.shift = (modifiers & 4) != 0;
  active_config.meta = (modifiers & 8) != 0;
}

} // namespace

int main() {
  CGEventRef event = CGEventCreate(nullptr);
  Require(event != nullptr, "create an unposted event");

  // Exhaustive exact matching catches both ignored required modifiers and
  // unexpected extra modifiers. Caps Lock/Fn are not binding modifiers.
  for (unsigned wanted = 0; wanted < 16; ++wanted) {
    SetBinding(wanted);
    for (unsigned actual = 0; actual < 16; ++actual) {
      for (CGEventFlags ignored : {CGEventFlags{0},
                                  CGEventFlags{kCGEventFlagMaskAlphaShift},
                                  CGEventFlags{kCGEventFlagMaskSecondaryFn},
                                  CGEventFlags{kCGEventFlagMaskAlphaShift |
                                               kCGEventFlagMaskSecondaryFn}}) {
        CGEventSetFlags(event, Flags(actual) | ignored);
        Require(ModifiersMatch(event) == (wanted == actual),
                "exact modifiers wanted=" + std::to_string(wanted) +
                    " actual=" + std::to_string(actual) +
                    " ignored=" + std::to_string(ignored));
      }
    }
  }

  SetBinding(1); // Ctrl + physical Backquote (macOS virtual key 50).
  std::vector<bool> transitions;
  emit_event = [&](bool down) { transitions.push_back(down); };
  input_down = false;
  auto deliver = [&](CGEventType type, int key, CGEventFlags flags) {
    CGEventSetType(event, type);
    CGEventSetIntegerValueField(event, kCGKeyboardEventKeycode, key);
    CGEventSetFlags(event, flags);
    Require(HandleEvent(nullptr, type, event, nullptr) == event,
            "callback preserves the original event");
  };

  deliver(kCGEventKeyDown, 50, 0);
  deliver(kCGEventKeyDown, 50, Flags(3));
  deliver(kCGEventKeyDown, 44, Flags(1));
  Require(transitions.empty(), "wrong modifier or physical key does not start");
  deliver(kCGEventKeyDown, 50, Flags(1));
  deliver(kCGEventKeyDown, 50, Flags(1));
  Require(transitions == std::vector<bool>{true}, "repeat does not duplicate down");
  deliver(kCGEventKeyUp, 44, Flags(1));
  Require(transitions == std::vector<bool>{true}, "unrelated release retains hold");
  deliver(kCGEventKeyUp, 50, 0);
  Require(transitions == std::vector<bool>({true, false}),
          "target release ends hold even after modifier release");
  deliver(kCGEventKeyUp, 50, 0);
  Require(transitions.size() == 2, "duplicate release does not emit again");

  deliver(kCGEventKeyDown, 50, Flags(1));
  deliver(kCGEventTapDisabledByTimeout, 50, Flags(1));
  Require(transitions == std::vector<bool>({true, false, true, false}),
          "disabled tap releases held input");
  deliver(kCGEventTapDisabledByUserInput, 50, Flags(1));
  Require(transitions.size() == 4, "disabled idle tap does not emit release");
  deliver(kCGEventKeyDown, 50, Flags(1));
  deliver(kCGEventKeyUp, 50, Flags(1));
  Require(transitions == std::vector<bool>({true, false, true, false, true, false}),
          "input can start and end again after disabled tap");

  emit_event = nullptr;
  CFRelease(event);
  std::cout << "PASS: " << assertions
            << " native matcher/callback assertions; no tap or global input used\n";
  return 0;
}
