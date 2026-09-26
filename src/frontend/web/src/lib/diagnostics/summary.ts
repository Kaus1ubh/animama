/**
 * Plain-text diagnostics for bug reports, copied from App Settings → About.
 *
 * Only the allow-listed facts below are emitted: versions, platform, runtime
 * state/code, feature-pack IDs/states/versions and which providers have a key
 * configured (yes/no). Never add key values, file paths, error messages that
 * may embed paths, chat or memory content, or personal identifiers.
 */
export type DiagnosticsInput = {
  appVersion: string;
  platform: string;
  runtime?: { state: string; code?: string } | null;
  featurePacks?: ReadonlyArray<{
    id: string;
    state: string;
    version?: string;
  }> | null;
  providers?: ReadonlyArray<{ provider: string; configured: boolean }> | null;
};

/** Keep identifiers to a conservative character set so nothing free-form leaks. */
function safeToken(value: string): string {
  return value.replace(/[^\w.:+-]/g, "").slice(0, 80) || "unknown";
}

export function buildDiagnosticsSummary(input: DiagnosticsInput): string {
  const lines = [
    "Animama diagnostics",
    `App version: ${safeToken(input.appVersion)}`,
    `Platform: ${safeToken(input.platform)}`,
  ];
  if (input.runtime) {
    const code = input.runtime.code
      ? ` (${safeToken(input.runtime.code)})`
      : "";
    lines.push(`Runtime: ${safeToken(input.runtime.state)}${code}`);
  }
  if (input.featurePacks?.length) {
    lines.push("Feature packs:");
    for (const pack of input.featurePacks) {
      const version = pack.version ? ` ${safeToken(pack.version)}` : "";
      lines.push(`- ${safeToken(pack.id)}: ${safeToken(pack.state)}${version}`);
    }
  }
  if (input.providers?.length) {
    lines.push("Provider keys configured:");
    for (const provider of input.providers) {
      lines.push(
        `- ${safeToken(provider.provider)}: ${provider.configured ? "yes" : "no"}`,
      );
    }
  }
  return lines.join("\n");
}
