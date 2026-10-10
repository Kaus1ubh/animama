import type { TFunction } from "i18next";
import { safeNavigationUrl } from "../lib/safe-url";
import { productEnglishT } from "../i18n/product-translation";

/**
 * A catalog key in the product namespace with its parameters, resolved in the
 * active locale when rendered. `name: null` stands for the default connection
 * name and `waitSeconds` for a localized "about N minutes".
 */
export type ChatFailureCopyRef = {
  key: string;
  params?: Record<string, unknown>;
};

/** Safe presentation for a failed turn; never render raw provider payloads. */
export type ChatFailure = {
  /** English text for hosts and logs; rendering uses `copy` when present. */
  title: string;
  guidance: string;
  /** Catalog references for the title, guidance and link label. */
  copy?: {
    title: ChatFailureCopyRef;
    guidance: ChatFailureCopyRef;
    linkLabel?: ChatFailureCopyRef;
  };
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
  /** `null` reads as the default connection name. */
  name: string | null;
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
    name: text(details.connection_name, 80),
    localServer: preset ? (LOCAL_SERVER_PRESETS[preset] ?? null) : null,
    baseUrl: text(details.connection_base_url, 200),
  };
}

type CopyPair = readonly [ChatFailureCopyRef, ChatFailureCopyRef];
type Description = (connection: FailedConnection) => CopyPair;

/** Title and guidance from `chatFailure.<group>.<code>`, with the connection's values. */
function pair(group: string, guidanceVariant = "guidance"): Description {
  return ({ name, localServer, baseUrl }) => {
    const params = { name, localServer, baseUrl };
    return [
      { key: `chatFailure.${group}.title`, params },
      { key: `chatFailure.${group}.${guidanceVariant}`, params },
    ];
  };
}

/** Local server presets get "is it running?" guidance instead of cloud guidance. */
function localAware(group: string, withAddress = false): Description {
  return (connection) =>
    pair(
      group,
      connection.localServer
        ? withAddress && connection.baseUrl
          ? "guidanceLocalAt"
          : "guidanceLocal"
        : "guidance",
    )(connection);
}

/** Copy for backend codes; each names the connection that failed. */
const descriptions: Record<string, Description> = {
  missing_api_key: pair("codes.missing_api_key"),
  openai_authentication_error: pair("codes.openai_authentication_error"),
  openai_permission_denied: pair("codes.openai_permission_denied"),
  openai_not_found: pair("codes.openai_not_found"),
  openai_quota_exceeded: pair("codes.openai_quota_exceeded"),
  openai_rate_limit: pair("codes.openai_rate_limit"),
  openai_overloaded: pair("codes.openai_overloaded"),
  openai_server_error: localAware("codes.openai_server_error"),
  openai_timeout: localAware("codes.openai_timeout"),
  openai_connection_error: localAware("codes.openai_connection_error", true),
  openai_bad_request: pair("codes.openai_bad_request"),
  connection_unavailable: pair("codes.connection_unavailable"),
  connection_base_url_missing: pair("codes.connection_base_url_missing"),
  gateway_request_rejected: pair("codes.gateway_request_rejected"),
  chat_stream_interrupted: pair("codes.chat_stream_interrupted"),
};

/** A more specific reading of some failures, from the server's neutral category. */
const categoryDescriptions: Record<string, Description> = {
  context_exceeded: pair("categories.context_exceeded"),
};

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

function hostedPair(
  group: string,
  title = "title",
  guidance = "guidance",
  params: Record<string, unknown> = {},
): CopyPair {
  return [
    { key: `chatFailure.hosted.${group}.${title}`, params },
    { key: `chatFailure.hosted.${group}.${guidance}`, params },
  ];
}

function describeHostedDenial(denial: HostedDenial): CopyPair {
  const wait = waitSeconds(denial.field("retry_after_seconds"));
  switch (denial.code) {
    case "quota_exceeded":
      return denial.field("limit") === "model_input_tokens"
        ? hostedPair("quotaInputTokens")
        : hostedPair(
            "quotaExceeded",
            "title",
            wait ? "guidanceWait" : "guidance",
            { waitSeconds: wait },
          );
    case "message_too_long": {
      const maximum = positiveCount(denial.field("max_characters"));
      return hostedPair(
        "messageTooLong",
        "title",
        maximum ? "guidanceMaximum" : "guidance",
        { maximum },
      );
    }
    case "chat_limit_reached": {
      const limit = positiveCount(denial.field("limit"));
      return hostedPair(
        "chatLimitReached",
        limit ? "titleLimit" : "title",
        "guidance",
        {
          limit,
        },
      );
    }
    case "trial_complete":
      return hostedPair("trialComplete");
    default:
      // capacity_busy and budget_paused: temporary hosted capacity.
      return hostedPair("busy", "title", wait ? "guidanceWait" : "guidance", {
        waitSeconds: wait,
      });
  }
}

/** "about 30 seconds", "about 2 hours": the wait in its largest whole unit. */
function approximateWait(t: TFunction<"product">, seconds: number): string {
  const amount = (count: number, unit: "second" | "minute" | "hour" | "day") =>
    t(`chatFailure.wait.${unit}`, { count });
  if (seconds < 60) return amount(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return amount(minutes, "minute");
  const hours = Math.round(seconds / 3600);
  if (hours < 24) return amount(hours, "hour");
  return amount(Math.round(seconds / 86_400), "day");
}

/** Resolve a copy reference in the locale of `t`. */
export function chatFailureCopy(
  t: TFunction<"product">,
  ref: ChatFailureCopyRef,
): string {
  const params: Record<string, unknown> = { ...ref.params };
  if ("name" in params && !params.name)
    params.name = t("chatFailure.defaultConnection");
  if (typeof params.waitSeconds === "number")
    params.wait = approximateWait(t, params.waitSeconds);
  // Catalog keys come from the failure, so they are runtime values.
  return (t as unknown as (key: string, options?: object) => string)(
    ref.key,
    params,
  );
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
      { key: "chatFailure.network.title" },
      { key: "chatFailure.network.guidance" },
    ];
  } else if (!description && status && status >= 500 && status <= 599) {
    description = [
      { key: "chatFailure.service.title" },
      { key: "chatFailure.service.guidance" },
    ];
  }
  const [title, guidance] = description ?? [
    { key: "chatFailure.unknown.title" },
    { key: "chatFailure.unknown.guidance" },
  ];
  const delay = details.retry_after_seconds;
  // A completed trial links to the desktop download only when its URL is safe.
  const downloadUrl =
    denial?.code === "trial_complete"
      ? safeNavigationUrl(denial.field("download_url"))
      : null;
  const linkLabel = { key: "chatFailure.hosted.trialComplete.link" };
  const english = productEnglishT();
  return {
    title: chatFailureCopy(english, title),
    guidance: chatFailureCopy(english, guidance),
    copy: { title, guidance, ...(downloadUrl ? { linkLabel } : {}) },
    code,
    originalText,
    partialText,
    ...(code === "openai_rate_limit" &&
    typeof delay === "number" &&
    Number.isFinite(delay) &&
    delay > 0
      ? { retryAfterSeconds: Math.min(Math.ceil(delay), 86400) }
      : {}),
    ...(downloadUrl
      ? {
          link: {
            label: chatFailureCopy(english, linkLabel),
            href: downloadUrl,
          },
        }
      : {}),
  };
}
