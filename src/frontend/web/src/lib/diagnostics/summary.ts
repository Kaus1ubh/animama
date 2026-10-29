/**
 * Plain-text diagnostics for bug reports, copied from App Settings → About.
 *
 * Only the allow-listed facts below are emitted: versions, platform, runtime
 * state/code, feature-pack IDs/states/versions, which providers have a key
 * configured (yes/no) and recent warnings and errors as their authored log
 * message and error type. Never add key values, file paths, raw error messages
 * that may embed paths, log data, chat or memory content, or personal
 * identifiers.
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
  recentProblems?: ReadonlyArray<{
    time: number;
    level: string;
    source: string;
    category: string;
    message: string;
    errorName?: string;
  }> | null;
};

/** Keep identifiers to a conservative character set so nothing free-form leaks. */
function safeToken(value: string): string {
  return value.replace(/[^\w.:+-]/g, "").slice(0, 80) || "unknown";
}

/**
 * Keep authored log text readable while omitting any word that looks like a
 * path, URL, email address or query, then drop remaining unusual characters.
 */
function safeText(value: string): string {
  return (
    value
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => (/[/\\@=?&]/.test(word) ? "(omitted)" : word))
      .join(" ")
      .replace(/[^\p{L}\p{N} .,:;'()_+-]/gu, "")
      .slice(0, 120) || "unknown"
  );
}

function utcSeconds(time: number): string {
  return `${new Date(time).toISOString().slice(0, 19)}Z`;
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
  if (input.recentProblems?.length) {
    lines.push("Recent warnings and errors:");
    for (const problem of input.recentProblems) {
      const errorName = problem.errorName
        ? ` (${safeToken(problem.errorName)})`
        : "";
      lines.push(
        `- ${utcSeconds(problem.time)} ${safeToken(problem.level)} ${safeText(problem.source)} / ${safeText(problem.category)}: ${safeText(problem.message)}${errorName}`,
      );
    }
  }
  return lines.join("\n");
}
