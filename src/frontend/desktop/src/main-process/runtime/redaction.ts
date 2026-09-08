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
      text = text.replaceAll(secret, "[REDACTED]");
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
