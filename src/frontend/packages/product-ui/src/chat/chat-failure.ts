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

/**
 * Which model connection failed. Names come from the owner's own settings,
 * never from the model server's response.
 */
type FailedConnection = {
  name: string;
  /** Local server presets get "is it running?" guidance. */
  localServer: string | null;
  baseUrl: string | null;
};

const LOCAL_SERVER_PRESETS: Record<string, string> = {
  ollama: "Ollama",
  lmstudio: "LM Studio",
  llamacpp: "llama.cpp",
  vllm: "vLLM",
};

function text(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : null;
}

function failedConnection(details: Record<string, unknown>): FailedConnection {
  const preset = text(details.connection_preset, 40);
  return {
    name: text(details.connection_name, 80) ?? "The model server",
    localServer: preset ? (LOCAL_SERVER_PRESETS[preset] ?? null) : null,
    baseUrl: text(details.connection_base_url, 200),
  };
}

type Description = (connection: FailedConnection) => readonly [string, string];

const MODEL_SETTINGS = "App Settings → Models";

/** Copy for backend codes; each names the connection that failed. */
const descriptions: Record<string, Description> = {
  missing_api_key: ({ name }) => [
    `${name} has no API key configured.`,
    `Ask the installation owner to add its key in ${MODEL_SETTINGS} or API Keys, then send your message again.`,
  ],
  openai_authentication_error: ({ name }) => [
    `${name} rejected the API key.`,
    `Ask the installation owner to check the key configured for ${name} before trying again.`,
  ],
  openai_permission_denied: ({ name }) => [
    `${name} denied access to this model.`,
    "Check the account's model access or select another available model.",
  ],
  openai_not_found: ({ name }) => [
    `${name} couldn't find the selected model.`,
    `Check the model ID in ${MODEL_SETTINGS} or select another model.`,
  ],
  openai_quota_exceeded: ({ name }) => [
    `${name}'s account has reached its usage limit.`,
    "Check the account's billing and usage limits before trying again.",
  ],
  openai_rate_limit: ({ name }) => [
    `${name} is receiving too many requests.`,
    "Wait a little before sending your message again.",
  ],
  openai_overloaded: ({ name }) => [
    `${name} is temporarily unavailable.`,
    "Wait a little before sending your message again.",
  ],
  openai_server_error: ({ name, localServer }) => [
    `${name} couldn't complete this request.`,
    localServer
      ? `Check that ${localServer} has the model loaded, then try again.`
      : "Wait a little before sending your message again.",
  ],
  openai_timeout: ({ name, localServer }) => [
    `${name} took too long to respond.`,
    localServer
      ? `The model may still be loading. Try again, or raise the connection's timeout in ${MODEL_SETTINGS}.`
      : "Check your connection and try again when you're ready.",
  ],
  openai_connection_error: ({ name, localServer, baseUrl }) => [
    `Animama couldn't reach ${name}.`,
    localServer
      ? `Is ${localServer} running${baseUrl ? ` at ${baseUrl}` : ""}? Start it, then try again.`
      : "Check your internet connection and try again when you're ready.",
  ],
  openai_bad_request: ({ name }) => [
    `${name} rejected this request.`,
    `Check the selected model and its settings in ${MODEL_SETTINGS} before trying again.`,
  ],
  connection_unavailable: () => [
    "The selected model's connection was removed.",
    "Select another model, then send your message again.",
  ],
  connection_base_url_missing: ({ name }) => [
    `${name} has no server address.`,
    `Set its base URL in ${MODEL_SETTINGS}, then send your message again.`,
  ],
  gateway_request_rejected: () => [
    "This installation refused the request.",
    "Open Animama at its configured application address, or reopen the desktop app. Ask the installation owner to check access settings if this continues.",
  ],
  chat_stream_interrupted: () => [
    "The reply was interrupted.",
    "The connection ended before Animama confirmed completion. Check your connection before sending again.",
  ],
};

/** A more specific reading of some failures, from the server's neutral category. */
const categoryDescriptions: Record<string, Description> = {
  context_exceeded: ({ name }) => [
    `The conversation is too long for ${name}'s model.`,
    `Start a new chat, or raise the model's context window in ${MODEL_SETTINGS} if the server allows more.`,
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
  const details = record(outer.details ?? detail.details);
  const candidate =
    outer.code ?? detail.code ?? body.code ?? body.error ?? outer.error;
  const code =
    typeof candidate === "string" && Object.hasOwn(descriptions, candidate)
      ? candidate
      : partialText
        ? "chat_stream_interrupted"
        : "chat_request_failed";
  const category =
    typeof details.category === "string" &&
    Object.hasOwn(categoryDescriptions, details.category)
      ? details.category
      : null;
  const status = typeof outer.status === "number" ? outer.status : null;
  const describe =
    (category && code !== "chat_stream_interrupted"
      ? categoryDescriptions[category]
      : undefined) ?? descriptions[code];
  let description = describe?.(failedConnection(details));
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
