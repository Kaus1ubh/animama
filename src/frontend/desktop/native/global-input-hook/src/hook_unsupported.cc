#include "platform_hook.h"

bool PlatformHookSupported() { return false; }
bool PlatformPermissionGranted() { return false; }
bool PlatformRequestPermission() { return false; }

bool PlatformStartHook(const HookConfig &, HookEventCallback,
                       std::string *error) {
  *error = "Global hold shortcuts are supported only on macOS and Windows.";
  return false;
}

void PlatformStopHook() {}
