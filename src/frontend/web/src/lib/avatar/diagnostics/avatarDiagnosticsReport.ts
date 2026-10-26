import type { AvatarFileFacts } from "./avatarFileFacts";
import type { AvatarLiveDiagnostics } from "./avatarDiagnostics";
import { mergeAvatarIssues, type AvatarIssue } from "./issues";

export const AVATAR_DIAGNOSTICS_SCHEMA = "animama/avatar-diagnostics/1";

/** Which Avatar a report describes: its content source and item id only. */
export type AvatarDiagnosticsIdentity = {
  source: "included" | "local" | null;
  itemId: string | null;
};

/**
 * How a report names an effect. A Local effect's runtime id is a slug of the
 * name its owner gave it, so reports use its source and catalog item id
 * (`local:<item id>`); an effect the Anima's runtime does not list is
 * `unlisted`.
 */
export type AvatarEffectReference = (effectId: string) => string | undefined;

/**
 * Everything Diagnostics shows, as one shareable document. It holds file
 * facts, counts, standard names and codes only: no file paths, URLs,
 * credentials, or Avatar, material, effect or custom expression names.
 */
export type AvatarDiagnosticsReport = {
  schema: typeof AVATAR_DIAGNOSTICS_SCHEMA;
  appVersion: string;
  avatar: AvatarDiagnosticsIdentity;
  status: "loaded" | "failed";
  file: AvatarFileFacts | null;
  live: Omit<AvatarLiveDiagnostics, "issues"> | null;
  /**
   * Every finding, each once: file and load, then the live Avatar's. An
   * `effectId` parameter becomes `effect`, an `AvatarEffectReference`.
   */
  issues: AvatarIssue[];
};

/** A finding as a report holds it: its effect named by reference. */
function shareableIssue(
  issue: AvatarIssue,
  effectReference: AvatarEffectReference | undefined,
): AvatarIssue {
  if (issue.params?.effectId === undefined) return issue;
  const params = Object.fromEntries(
    Object.entries(issue.params).filter(([key]) => key !== "effectId"),
  );
  params.effect =
    effectReference?.(String(issue.params.effectId)) ?? "unlisted";
  return { code: issue.code, params };
}

export function buildAvatarDiagnosticsReport(args: {
  avatar: AvatarDiagnosticsIdentity;
  file: AvatarFileFacts | null;
  live: AvatarLiveDiagnostics | null;
  /** Findings from outside the loaded Avatar: file, load, saved correction. */
  issues?: readonly AvatarIssue[];
  effectReference?: AvatarEffectReference;
}): AvatarDiagnosticsReport {
  const { issues: liveIssues = [], ...live } = args.live ?? {};
  return {
    schema: AVATAR_DIAGNOSTICS_SCHEMA,
    appVersion: __ANIMAMA_APP_VERSION__,
    avatar: args.avatar,
    status: args.live ? "loaded" : "failed",
    file: args.file,
    live: args.live ? (live as Omit<AvatarLiveDiagnostics, "issues">) : null,
    // Merged after the rewrite: two ids may share one reference.
    issues: mergeAvatarIssues(
      [...(args.issues ?? []), ...liveIssues].map((issue) =>
        shareableIssue(issue, args.effectReference),
      ),
    ),
  };
}

export function avatarDiagnosticsJson(report: AvatarDiagnosticsReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

const MEBIBYTE = 1024 * 1024;

function megabytes(bytes: number): string {
  return `${(bytes / MEBIBYTE).toFixed(1)} MB`;
}

function list(values: readonly string[]): string {
  return values.length > 0 ? values.join(", ") : "none";
}

function issueLine(issue: AvatarIssue): string {
  const params = Object.entries(issue.params ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
  return params ? `${issue.code} (${params})` : issue.code;
}

function fileLines(file: AvatarFileFacts | null): string[] {
  if (!file) return ["  Not readable"];
  const kinds = Object.entries(file.materialKinds)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${kind} ${count}`);
  const textureBytes = file.textures.reduce(
    (total, texture) => total + (texture.byteLength ?? 0),
    0,
  );
  const largest = file.textures.reduce<
    AvatarFileFacts["textures"][number] | null
  >(
    (best, texture) =>
      (texture.width ?? 0) * (texture.height ?? 0) >
      (best?.width ?? 0) * (best?.height ?? 0)
        ? texture
        : best,
    null,
  );
  return [
    `  Format: ${file.container.toUpperCase()}, VRM ${file.vrmVersion ?? "none"}, ${megabytes(file.byteLength)}`,
    `  Extensions used: ${list(file.extensionsUsed)}`,
    `  Extensions required: ${list(file.extensionsRequired)}`,
    `  Meshes ${file.meshCount}, primitives ${file.primitiveCount} (${file.morphedPrimitiveCount} with morph targets)`,
    `  Materials ${file.materialCount}: ${list(kinds)}`,
    `  Textures ${file.textures.length}, ${megabytes(textureBytes)}` +
      (largest?.width ? `, largest ${largest.width}x${largest.height}` : ""),
  ];
}

function liveLines(live: AvatarDiagnosticsReport["live"]): string[] {
  if (!live) return ["", "Live Avatar", "  Not loaded"];
  const { face, expressions, motion } = live;
  return [
    "",
    "Face",
    ...(face.detected
      ? face.parts.map(
          (part) =>
            `  ${part.role}: ${part.source}, ${part.bindingCount} primitive(s)` +
            (part.regionCount > 0 ? ` + regions in ${part.regionCount}` : "") +
            `, confidence ${part.confidence.toFixed(2)}`,
        )
      : ["  Part detection failed; effects use material names"]),
    `  Landmarks ${face.landmarks}, texture anchors ${face.textureAnchors}`,
    "",
    "Expressions",
    `  Presets: ${list(expressions.presets.map((preset) => `${preset.name} (${preset.source})`))}`,
    `  Missing presets: ${list(expressions.missingPresets)}`,
    `  ARKit shapes ${expressions.arkit.resolved}/${expressions.arkit.total}; faces play through ARKit: ${expressions.arkit.playsFaces ? "yes" : "no"}`,
    `  Requested but unavailable: ${list(expressions.unresolved.names)}` +
      (expressions.unresolved.otherCount > 0
        ? ` (+${expressions.unresolved.otherCount} custom)`
        : ""),
    "",
    "Motion",
    `  Humanoid bones ${motion.humanoidBones}; missing required: ${list(motion.missingRequiredBones)}`,
    `  Springs: ${motion.springJoints} joints, ${motion.springColliders} colliders; wind ${motion.wind}`,
    `  Rest pose: ${motion.restPose ?? "not checked"}`,
  ];
}

/** The report as plain English text with stable codes, for support. */
export function avatarDiagnosticsText(report: AvatarDiagnosticsReport): string {
  return [
    `Animama Avatar diagnostics (${report.schema})`,
    `App ${report.appVersion}`,
    `Avatar: ${report.avatar.source ?? "unknown"} ${report.avatar.itemId ?? ""}`.trimEnd(),
    `Status: ${report.status}`,
    "",
    "File",
    ...fileLines(report.file),
    ...liveLines(report.live),
    "",
    "Warnings",
    ...(report.issues.length > 0
      ? report.issues.map((issue) => `  - ${issueLine(issue)}`)
      : ["  none"]),
    "",
  ].join("\n");
}
