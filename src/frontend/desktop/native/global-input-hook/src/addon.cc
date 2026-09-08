#include <node_api.h>

#include <cstdint>
#include <mutex>
#include <string>
#include <vector>

#include "platform_hook.h"

namespace {

std::mutex callback_mutex;
napi_threadsafe_function callback = nullptr;

void Throw(napi_env env, const char *code, const std::string &message) {
  napi_throw_error(env, code, message.c_str());
}

bool ReadBoolean(napi_env env, napi_value object, const char *name,
                 bool *output) {
  napi_value value;
  bool present = false;
  if (napi_has_named_property(env, object, name, &present) != napi_ok ||
      !present || napi_get_named_property(env, object, name, &value) != napi_ok)
    return false;
  return napi_get_value_bool(env, value, output) == napi_ok;
}

bool ReadString(napi_env env, napi_value object, const char *name,
                std::string *output) {
  napi_value value;
  bool present = false;
  if (napi_has_named_property(env, object, name, &present) != napi_ok ||
      !present || napi_get_named_property(env, object, name, &value) != napi_ok)
    return false;
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &length) != napi_ok ||
      length == 0 || length > 64)
    return false;
  std::vector<char> buffer(length + 1);
  if (napi_get_value_string_utf8(env, value, buffer.data(), buffer.size(),
                                 &length) != napi_ok)
    return false;
  output->assign(buffer.data(), length);
  return true;
}

bool ReadConfig(napi_env env, napi_value value, HookConfig *config) {
  napi_valuetype type;
  if (napi_typeof(env, value, &type) != napi_ok || type != napi_object)
    return false;

  std::string kind;
  if (!ReadString(env, value, "type", &kind) ||
      !ReadBoolean(env, value, "ctrlKey", &config->ctrl) ||
      !ReadBoolean(env, value, "altKey", &config->alt) ||
      !ReadBoolean(env, value, "shiftKey", &config->shift) ||
      !ReadBoolean(env, value, "metaKey", &config->meta))
    return false;

  if (kind == "keyboard") {
    config->mouse = false;
    return ReadString(env, value, "code", &config->code);
  }
  if (kind == "mouse") {
    config->mouse = true;
    napi_value button;
    int32_t number = 0;
    if (napi_get_named_property(env, value, "button", &button) != napi_ok ||
        napi_get_value_int32(env, button, &number) != napi_ok || number < 1 ||
        number > 32)
      return false;
    config->button = number;
    return true;
  }
  return false;
}

void CallJavaScript(napi_env env, napi_value function, void *, void *data) {
  if (!env || !function)
    return;
  napi_handle_scope scope;
  if (napi_open_handle_scope(env, &scope) != napi_ok)
    return;
  napi_value global;
  napi_value phase;
  napi_get_global(env, &global);
  napi_get_boolean(env, reinterpret_cast<uintptr_t>(data) == 1, &phase);
  napi_call_function(env, global, function, 1, &phase, nullptr);
  napi_close_handle_scope(env, scope);
}

void Emit(bool down) {
  std::scoped_lock lock(callback_mutex);
  if (!callback)
    return;
  napi_call_threadsafe_function(
      callback, reinterpret_cast<void *>(down ? uintptr_t{1} : uintptr_t{2}),
      napi_tsfn_nonblocking);
}

void StopInternal() {
  PlatformStopHook();
  std::scoped_lock lock(callback_mutex);
  if (!callback)
    return;
  napi_release_threadsafe_function(callback, napi_tsfn_abort);
  callback = nullptr;
}

napi_value Start(napi_env env, napi_callback_info info) {
  size_t count = 2;
  napi_value args[2];
  if (napi_get_cb_info(env, info, &count, args, nullptr, nullptr) != napi_ok ||
      count != 2) {
    Throw(env, "ERR_ANIMAMA_INPUT_ARGUMENT",
          "start expects config and callback");
    return nullptr;
  }
  HookConfig config;
  napi_valuetype callback_type;
  if (!ReadConfig(env, args[0], &config) ||
      napi_typeof(env, args[1], &callback_type) != napi_ok ||
      callback_type != napi_function) {
    Throw(env, "ERR_ANIMAMA_INPUT_ARGUMENT",
          "Invalid input-hook configuration");
    return nullptr;
  }

  StopInternal();
  napi_value resource_name;
  napi_create_string_utf8(env, "Animama global press to talk", NAPI_AUTO_LENGTH,
                          &resource_name);
  {
    std::scoped_lock lock(callback_mutex);
    if (napi_create_threadsafe_function(env, args[1], nullptr, resource_name, 0,
                                        1, nullptr, nullptr, nullptr,
                                        CallJavaScript, &callback) != napi_ok) {
      Throw(env, "ERR_ANIMAMA_INPUT_CALLBACK",
            "Could not create input callback");
      return nullptr;
    }
  }

  std::string error;
  if (!PlatformStartHook(config, Emit, &error)) {
    StopInternal();
    Throw(env, "ERR_ANIMAMA_INPUT_START", error);
    return nullptr;
  }
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

napi_value Stop(napi_env env, napi_callback_info) {
  StopInternal();
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

napi_value Supported(napi_env env, napi_callback_info) {
  napi_value value;
  napi_get_boolean(env, PlatformHookSupported(), &value);
  return value;
}

napi_value PermissionGranted(napi_env env, napi_callback_info) {
  napi_value value;
  napi_get_boolean(env, PlatformPermissionGranted(), &value);
  return value;
}

napi_value RequestPermission(napi_env env, napi_callback_info) {
  napi_value value;
  napi_get_boolean(env, PlatformRequestPermission(), &value);
  return value;
}

void Cleanup(void *) { StopInternal(); }

napi_value Initialize(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
      {"start", nullptr, Start, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"stop", nullptr, Stop, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"isSupported", nullptr, Supported, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"permissionGranted", nullptr, PermissionGranted, nullptr, nullptr,
       nullptr, napi_default, nullptr},
      {"requestPermission", nullptr, RequestPermission, nullptr, nullptr,
       nullptr, napi_default, nullptr},
  };
  napi_define_properties(
      env, exports, sizeof(properties) / sizeof(properties[0]), properties);
  napi_add_env_cleanup_hook(env, Cleanup, nullptr);
  return exports;
}

} // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Initialize)
