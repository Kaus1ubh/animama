/** Safe presentation for a failed turn; never render raw provider payloads. */
export type ChatFailure = {
  title: string;
  guidance: string;
  code: string;
  originalText: string;
  partialText: string;
  retryAfterSeconds?: number;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const descriptions: Record<string, readonly [string, string]> = {
  missing_api_key: [
    "The selected provider isn't configured.",
    "Ask the installation owner to configure its API key, then send your message again.",
  ],
  openai_authentication_error: [
    "OpenAI rejected the API key.",
    "Ask the installation owner to check the configured OpenAI key before trying again.",
  ],
  openai_permission_denied: [
    "OpenAI denied access to this model.",
    "Check the provider account's model access or select another available model.",
  ],
  openai_not_found: [
    "OpenAI couldn't find the requested model or resource.",
    "Check the selected model's configuration before trying again.",
  ],
  openai_quota_exceeded: [
    "The OpenAI account has reached its usage limit.",
    "Check the provider account's billing and usage limits before trying again.",
  ],
  openai_rate_limit: [
    "OpenAI is receiving too many requests.",
    "Wait a little before sending your message again.",
  ],
  openai_overloaded: [
    "OpenAI is temporarily unavailable.",
    "Wait a little before sending your message again.",
  ],
  openai_server_error: [
    "OpenAI couldn't complete this request.",
    "Wait a little before sending your message again.",
  ],
  openai_timeout: [
    "OpenAI took too long to respond.",
    "Check your connection and try again when you're ready.",
  ],
  openai_connection_error: [
    "Animama couldn't reach OpenAI.",
    "Check your internet connection and try again when you're ready.",
  ],
  openai_bad_request: [
    "OpenAI rejected this request.",
    "Check the selected model and its settings before trying again.",
  ],
  gateway_request_rejected: [
    "This installation refused the request.",
    "Open Animama at its configured application address, or reopen the desktop app. Ask the installation owner to check access settings if this continues.",
  ],
  chat_stream_interrupted: [
    "The reply was interrupted.",
    "The connection ended before Animama confirmed completion. Check your connection before sending again.",
  ],
};

/** Normalize HTTP and in-stream errors without assuming a 403 is a provider error. */
export function describeChatFailure(
  error: unknown,
  originalText: string,
  partialText = "",
): ChatFailure {
  const outer = record(error);
  const body = record(outer.body);
  const detail = record(outer.detail ?? body.detail);
  const candidate =
    outer.code ?? detail.code ?? body.code ?? body.error ?? outer.error;
  const code =
    typeof candidate === "string" && Object.hasOwn(descriptions, candidate)
      ? candidate
      : partialText
        ? "chat_stream_interrupted"
        : "chat_request_failed";
  const status = typeof outer.status === "number" ? outer.status : null;
  let description = descriptions[code];
  if (!description && error instanceof TypeError) {
    description = [
      "Animama couldn't connect to its service.",
      "Check your connection and whether the installation is running, then try again.",
    ];
  } else if (!description && status && status >= 500 && status <= 599) {
    description = [
      "Animama's service is unavailable.",
      "Wait a little, then try again. If this continues, check or restart the installation's service.",
    ];
  }
  const [title, guidance] = description ?? [
    "The message couldn't be completed.",
    "Restore your message to try again. If this continues, share the error code with the installation owner.",
  ];
  const details = record(outer.details ?? detail.details);
  const delay = details.retry_after_seconds;
  return {
    title,
    guidance,
    code,
    originalText,
    partialText,
    ...(code === "openai_rate_limit" &&
    typeof delay === "number" &&
    Number.isFinite(delay) &&
    delay > 0
      ? { retryAfterSeconds: Math.min(Math.ceil(delay), 86400) }
      : {}),
  };
}
