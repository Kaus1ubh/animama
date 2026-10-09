/** Admitted self-hosted runtime capabilities for browser fixtures that answer `/v1/runtime-capabilities`. */
export function selfHostedRuntimeCapabilities(overrides = {}) {
  return {
    schema_version: 2,
    runtime_kind: "desktop",
    chat: true,
    provider_credentials: true,
    local_filesystem_administration: true,
    native_features: true,
    model_selection: true,
    model_role_selection: true,
    offline_speech_enabled: false,
    offline_speech_asset_version: null,
    model_configuration: true,
    chat_file_uploads: true,
    anima_creation: true,
    companion_safety: {
      ai_notice_enabled: true,
      crisis_detection_enabled: true,
      enabled: true,
      operator_reminder_hours: 3,
    },
    user_file_processing: {
      enabled: false,
      last_heartbeat_at: null,
      pack_id: null,
      supported_extensions: [],
      worker_state: "disabled",
    },
    web_search: { configuration: false },
    ...overrides,
  };
}
