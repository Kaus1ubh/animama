import { safeNavigationUrl } from "../lib/safe-url";

/** Safe presentation for a failed turn; never render raw provider payloads. */
export type ChatFailure = {
  title: string;
  guidance: string;
  code: string;
  originalText: string;
  partialText: string;
  retryAfterSeconds?: number;
  /** A next step outside the chat, such as downloading the desktop app. */
  link?: ChatFailureLink;
};

/** A link whose `href` is an `https:` URL without credentials (`safeNavigationUrl`). */
export type ChatFailureLink = { label: string; href: string };

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
const baseDescriptions: Record<string, Description> = {
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
  // A Claude model's refusal (stop_reason "refusal"); no other model is tried.
  model_refused: () => [
    "The model declined to respond to this message.",
    "Try rephrasing it.",
  ],
};

/** A more specific reading of some failures, from the server's neutral category. */
const categoryDescriptions: Record<string, Description> = {
  context_exceeded: ({ name }) => [
    `The conversation is too long for ${name}'s model.`,
    `Choose a model with a larger context window, raise this model's window in ${MODEL_SETTINGS} if the server allows more, or send a shorter message.`,
  ],
};

/** Anthropic codes read like their OpenAI equivalents, naming the Anthropic connection. */
const ANTHROPIC_EQUIVALENTS: Record<string, string> = {
  anthropic_authentication_error: "openai_authentication_error",
  anthropic_permission_denied: "openai_permission_denied",
  anthropic_not_found: "openai_not_found",
  anthropic_quota_exceeded: "openai_quota_exceeded",
  anthropic_rate_limit: "openai_rate_limit",
  anthropic_overloaded: "openai_overloaded",
  anthropic_server_error: "openai_server_error",
  anthropic_timeout: "openai_timeout",
  anthropic_connection_error: "openai_connection_error",
  anthropic_bad_request: "openai_bad_request",
};

const descriptions: Record<string, Description> = {
  ...baseDescriptions,
  ...Object.fromEntries(
    Object.entries(ANTHROPIC_EQUIVALENTS).map(([code, equivalent]) => [
      code,
      baseDescriptions[equivalent],
    ]),
  ),
  anthropic_context_exceeded: categoryDescriptions.context_exceeded,
  anthropic_stream_incomplete: ({ name }) => [
    "The reply was interrupted.",
    `${name} ended the reply before it finished. Try sending your message again.`,
  ],
};

/** Codes whose details may carry the provider's recommended wait. */
const RETRY_AFTER_CODES = new Set([
  "openai_rate_limit",
  "anthropic_rate_limit",
]);

/**
 * Hosted account and service limits ("Hosted denials" in
 * contracts/hosted-web.md). Their copy names the limit and the wait (for a
 * completed trial, the desktop download), and never refers the user to an
 * installation owner or its service.
 */
const HOSTED_DENIAL_CODES = new Set([
  "quota_exceeded",
  "capacity_busy",
  "budget_paused",
  "message_too_long",
  "chat_limit_reached",
  "trial_complete",
]);

type HostedDenial = {
  code: string;
  /** A sibling field, read beside the code first and then outwards. */
  field: (name: string) => unknown;
};

/**
 * Find a hosted denial code wherever the contract may place it (`code`,
 * `error` or `detail.code`, in a thrown body or a stream error frame).
 */
function hostedDenial(
  outer: Record<string, unknown>,
  detail: Record<string, unknown>,
  body: Record<string, unknown>,
  details: Record<string, unknown>,
): HostedDenial | null {
  const candidates = [
    [outer.code, outer],
    [outer.error, outer],
    [detail.code, detail],
    [body.code, body],
    [body.error, body],
  ] as const;
  for (const [code, container] of candidates) {
    if (typeof code !== "string" || !HOSTED_DENIAL_CODES.has(code)) continue;
    const sources = [container, outer, body, details];
    return {
      code,
      field: (name) =>
        sources
          .map((source) => source[name])
          .find((value) => value !== undefined && value !== null),
    };
  }
  return null;
}

/** Whole seconds to wait, or null when the value is missing or unusable. */
function waitSeconds(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.ceil(value)
    : null;
}

/** A positive whole count from a number or a decimal string. */
function positiveCount(value: unknown): number | null {
  const count =
    typeof value === "string" && /^\d+$/.test(value.trim())
      ? Number(value)
      : value;
  return typeof count === "number" && Number.isSafeInteger(count) && count > 0
    ? count
    : null;
}

/** "about 30 seconds", "about 2 hours": the wait in its largest whole unit. */
function approximateWait(seconds: number): string {
  const amount = (count: number, unit: string) =>
    `about ${count} ${unit}${count === 1 ? "" : "s"}`;
  if (seconds < 60) return amount(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return amount(minutes, "minute");
  const hours = Math.round(seconds / 3600);
  if (hours < 24) return amount(hours, "hour");
  return amount(Math.round(seconds / 86_400), "day");
}

function describeHostedDenial(denial: HostedDenial): readonly [string, string] {
  const wait = waitSeconds(denial.field("retry_after_seconds"));
  switch (denial.code) {
    case "quota_exceeded":
      return denial.field("limit") === "model_input_tokens"
        ? [
            "This conversation is too long for one hosted turn.",
            "Start a new chat or shorten your message.",
          ]
        : [
            "You've reached this account's hosted usage limit.",
            wait
              ? `It resets in ${approximateWait(wait)}.`
              : "Try again after it resets.",
          ];
    case "message_too_long": {
      const maximum = positiveCount(denial.field("max_characters"));
      return [
        "This message is too long.",
        maximum
          ? `Messages can be up to ${maximum.toLocaleString("en-US")} characters.`
          : "Shorten your message, then send it again.",
      ];
    }
    case "chat_limit_reached": {
      const limit = positiveCount(denial.field("limit"));
      return [
        limit
          ? `This account has reached its chat limit (${limit.toLocaleString("en-US")} chats).`
          : "This account has reached its chat limit.",
        "Continue one of your existing chats.",
      ];
    }
    case "trial_complete":
      return [
        "Your Animama trial is complete.",
        "Download Animama to keep chatting with your Animas.",
      ];
    default:
      // capacity_busy and budget_paused: temporary hosted capacity.
      return [
        "Animama is busy right now.",
        wait
          ? `Try again in ${approximateWait(wait)}.`
          : "Try again in a moment.",
      ];
  }
}

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
  const knownCode =
    typeof candidate === "string" && Object.hasOwn(descriptions, candidate)
      ? candidate
      : null;
  const denial = knownCode ? null : hostedDenial(outer, detail, body, details);
  const code =
    knownCode ??
    denial?.code ??
    (partialText ? "chat_stream_interrupted" : "chat_request_failed");
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
  let description = denial
    ? describeHostedDenial(denial)
    : describe?.(failedConnection(details));
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
  // A completed trial links to the desktop download only when its URL is safe.
  const downloadUrl =
    denial?.code === "trial_complete"
      ? safeNavigationUrl(denial.field("download_url"))
      : null;
  return {
    title,
    guidance,
    code,
    originalText,
    partialText,
    ...(RETRY_AFTER_CODES.has(code) &&
    typeof delay === "number" &&
    Number.isFinite(delay) &&
    delay > 0
      ? { retryAfterSeconds: Math.min(Math.ceil(delay), 86400) }
      : {}),
    ...(downloadUrl
      ? { link: { label: "Download Animama", href: downloadUrl } }
      : {}),
  };
}
