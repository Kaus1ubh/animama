/**
 * Browser telemetry sanitization. Export carries operational shape only: no
 * URLs beyond a path, user agents, identifiers, emails, tokens or content.
 * A receiving forwarder may sanitize again; the exporter never relies on it.
 */

export const MAX_ATTRIBUTES = 16;
export const MAX_ATTRIBUTE_LENGTH = 128;
export const MAX_MESSAGE_LENGTH = 512;
export const MAX_STACK_LINES = 32;
export const MAX_STACK_LINE_LENGTH = 1024;
export const MAX_STACK_LENGTH = 4096;

export type TelemetryAttributes = Record<string, string | number | boolean>;

// Every pattern starts only at a token boundary (a lookbehind, or a literal
// prefix with bounded groups), and a token's body never contains another
// boundary, so each costs linear time even on long unbroken input.
const USER_AGENT =
  /Mozilla\/\d[\w.]*\s*\([^()]{0,256}\)(?:\s*[\w.-]+\/[\w.-]+|\s*\([^()]{0,256}\))*/g;
/** Absolute and protocol-relative URLs, including nested schemes such as `blob:`. */
const ABSOLUTE_URL =
  /(?<![a-z0-9+.:/-])(?:[a-z][a-z0-9+.-]*:)*\/\/[^\s"'<>()]+/gi;
const URL_PARTS = /^(?:[a-z][a-z0-9+.-]*:)*\/\/[^/?#]*([^?#]*)(.*)$/is;
/** A stack frame's `:line:column`, kept when the query before it is removed. */
const POSITION = /(?::\d+){1,2}$/;
/** A query on any token, such as `chats?token=…`, keeping a stack position. */
const QUERY =
  /(?<![^\s"'<>(])([^\s?"'<>()]*)\?[^\s"'<>()]*?((?::\d+){1,2})?(?=[\s"'<>()]|$)/g;
/** A fragment on a token; it is removed only from a path, so `Error #42` stays. */
const FRAGMENT =
  /(?<![^\s"'<>(])([^\s#"'<>()]*)#[^\s"'<>()]*?((?::\d+){1,2})?(?=[\s"'<>()]|$)/g;
const EMAIL =
  /(?<![\p{L}\p{N}.!#$%&'*+=?^_`{|}~-])[\p{L}\p{N}.!#$%&'*+=?^_`{|}~-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
const UUID =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
/** Long hex runs (digests, keys), except a hashed script chunk's name. */
const LONG_HEX = /\b[0-9a-f]{16,}\b(?!\.m?js\b)/gi;
/** Token-shaped runs mix letters and digits; long function and chunk names do not leak. */
const TOKEN =
  /(?<![A-Za-z0-9_-])(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}(?![A-Za-z0-9_-])(?!\.m?js\b)/g;
/** The partial word an input cut leaves at its end. */
const PARTIAL_WORD = /(?<!\S)\S*$/;

const ATTRIBUTE_KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
/** Keys that name identifiers, addresses, agents, credentials or content. */
const FORBIDDEN_KEY =
  /(?:^|[._-])ids?$|uuid|guid|^url(?:[._]|$)|^http[._](?:url|target|user_agent)$|user[._-]?agent|user[._-]?name|e-?mail|host|address|query|session|token|password|secret|cookie|auth|prompt|content|message|text/i;
/** camelCase identifiers such as `chatId`; case-sensitive so `valid` is kept. */
const CAMEL_ID_KEY = /[a-z0-9]I[dD]s?$/;

/** Reduce an absolute URL to its path (and any stack position). */
function urlPath(token: string): string {
  const [, path = "", rest = ""] = URL_PARTS.exec(token) ?? [];
  const position = rest ? (POSITION.exec(rest)?.[0] ?? "") : "";
  return `${path || "/"}${position}`;
}

function scrub(text: string): string {
  return text
    .replace(USER_AGENT, "<user-agent>")
    .replace(ABSOLUTE_URL, urlPath)
    .replace(QUERY, "$1$2")
    .replace(FRAGMENT, (fragment, path: string, position?: string) =>
      path.includes("/") ? `${path}${position ?? ""}` : fragment,
    )
    .replace(EMAIL, "<email>")
    .replace(UUID, "<id>")
    .replace(LONG_HEX, "<id>")
    .replace(TOKEN, "<id>");
}

/**
 * Sanitize, then truncate, so a cut can never expose part of a value that the
 * whole would have replaced. Oversized input is bounded first, dropping the
 * partial word at its cut, to keep the regular expressions cheap.
 */
export function sanitizeText(value: string, limit: number): string {
  const bound = Math.max(limit * 4, 1_024);
  const input =
    value.length > bound
      ? value.slice(0, bound).replace(PARTIAL_WORD, "")
      : value;
  const text = scrub(input).trimEnd();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/** Keep the leading frames of a stack, each line bounded and sanitized like a message. */
export function sanitizeStack(stack: string): string {
  const text = stack
    .slice(0, MAX_STACK_LENGTH * 4)
    .split("\n", MAX_STACK_LINES)
    .map((line) => sanitizeText(line, MAX_STACK_LINE_LENGTH))
    .join("\n");
  return text.length > MAX_STACK_LENGTH
    ? `${text.slice(0, MAX_STACK_LENGTH - 1)}…`
    : text;
}

/** Bounded scalar attributes without identifier, address, agent or content keys. */
export function sanitizeAttributes(
  attributes: Readonly<Record<string, unknown>> | undefined,
): TelemetryAttributes {
  const result: TelemetryAttributes = {};
  let count = 0;
  for (const [key, value] of Object.entries(attributes ?? {})) {
    if (count >= MAX_ATTRIBUTES) break;
    if (
      !ATTRIBUTE_KEY.test(key) ||
      FORBIDDEN_KEY.test(key) ||
      CAMEL_ID_KEY.test(key)
    )
      continue;
    if (typeof value === "string")
      result[key] = sanitizeText(value, MAX_ATTRIBUTE_LENGTH);
    else if (typeof value === "boolean") result[key] = value;
    else if (typeof value === "number" && Number.isFinite(value))
      result[key] = value;
    else continue;
    count += 1;
  }
  return result;
}
