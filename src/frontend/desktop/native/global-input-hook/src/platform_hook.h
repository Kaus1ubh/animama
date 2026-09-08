#pragma once

#include <functional>
#include <string>

struct HookConfig {
  bool mouse = false;
  std::string code;
  int button = 0;
  bool ctrl = false;
  bool alt = false;
  bool shift = false;
  bool meta = false;
};

using HookEventCallback = std::function<void(bool down)>;

bool PlatformHookSupported();
bool PlatformPermissionGranted();
bool PlatformRequestPermission();
bool PlatformStartHook(const HookConfig &config, HookEventCallback callback,
                       std::string *error);
void PlatformStopHook();
