/**
 * Real provider keys and runtime tokens are 32+ characters. A registered value
 * under 16 characters cannot be a real secret, and substring-replacing it would
 * garble ordinary log words, so it is redacted only as a whole token.
 */
const SUBSTRING_REDACTION_MIN_LENGTH = 16;
const TOKEN_CHARACTER = String.raw`[\p{L}\p{N}_-]`;

function wholeTokenPattern(value: string): RegExp {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(
    `(?<!${TOKEN_CHARACTER})${escaped}(?!${TOKEN_CHARACTER})`,
    "gu",
  );
}

/** Redact both known values and common credential-bearing log fields. */
export class SecretRedactor {
  private secrets = new Set<string>();
  add(...values: string[]): void {
    for (const value of values)
      if (value) {
        this.secrets.add(value);
        this.secrets.add(encodeURIComponent(value));
      }
  }
  redact(message: string): string {
    let text = message;
    for (const secret of [...this.secrets].sort((a, b) => b.length - a.length))
      text =
        secret.length >= SUBSTRING_REDACTION_MIN_LENGTH
          ? text.replaceAll(secret, "[REDACTED]")
          : text.replace(wholeTokenPattern(secret), "[REDACTED]");
    return text
      .replace(/postgres(?:ql)?(?:\+\w+)?:\/\/[^\s"']+/giu, "[DATABASE_URL]")
      .replace(/\bBearer\s+[^\s"']+/giu, "Bearer [REDACTED]")
      .replace(
        /((?:authorization|cookie|x-animama-(?:principal-id|internal-token|desktop-control)|[A-Z_]*(?:API_KEY|TOKEN|PASSWORD))["'\s:=]+)[^\r\n]+/giu,
        "$1[REDACTED]",
      );
  }
}
export const runtimeRedactor = new SecretRedactor();
