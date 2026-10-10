import type { RuntimeCapabilities } from "@animama/runtime-contracts";

/** Public contract fixture; it contains no account or provider credentials. */
export const hostedCapabilitiesFixture: RuntimeCapabilities = {
  schema_version: 2,
  runtime_kind: "hosted",
  chat: true,
  anima_creation: false,
  chat_file_uploads: false,
  provider_credentials: false,
  model_configuration: false,
  model_selection: true,
  model_role_selection: true,
  local_filesystem_administration: false,
  native_features: false,
  offline_speech_enabled: true,
  offline_speech_asset_version: "fixture",
  offline_speech_gpu_asset_version: null,
  companion_safety: {
    enabled: true,
    ai_notice_enabled: true,
    crisis_detection_enabled: true,
    operator_reminder_hours: 1,
  },
  user_file_processing: {
    enabled: false,
    last_heartbeat_at: null,
    pack_id: null,
    supported_extensions: [],
    worker_state: "disabled",
  },
  web_search: {
    configuration: false,
    configured: true,
    backend: "searxng",
    credential_state: "not_required",
  },
};
