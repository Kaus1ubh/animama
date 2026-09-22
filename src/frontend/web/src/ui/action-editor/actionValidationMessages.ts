import type { PoseCreatorClipPreviewDiagnostics } from "@/ui/pose-creator/poseCreatorClipAuthoring";

/** Show authoring validation only after the user asks to save. */
export function actionValidationMessages(
  attempted: boolean,
  issues: readonly { message: string }[],
  timelineIssues: readonly { message: string }[],
  diagnostics: PoseCreatorClipPreviewDiagnostics | null,
  saveError: string | null = null,
): string[] {
  if (!attempted) return saveError ? [saveError] : [];
  const summary = diagnostics
    ? getClipPreviewDiagnosticSummary(diagnostics)
    : null;
  return [
    ...new Set([
      ...issues.map((issue) => issue.message),
      ...timelineIssues.map((issue) => issue.message),
      ...(summary ? [summary] : []),
      ...(saveError ? [saveError] : []),
    ]),
  ];
}

function getClipPreviewDiagnosticSummary(
  diagnostics: PoseCreatorClipPreviewDiagnostics,
): string | null {
  const parts: string[] = [];
  if (diagnostics.missingPoseRefs.length > 0) {
    parts.push(`Missing poses: ${diagnostics.missingPoseRefs.join(", ")}`);
  }
  if (diagnostics.missingAvatarVFXIds.length > 0) {
    parts.push(
      `Missing avatar VFX: ${diagnostics.missingAvatarVFXIds.join(", ")}`,
    );
  }
  if (diagnostics.missingSceneVFXPresetIds.length > 0) {
    parts.push(
      `Missing scene VFX: ${diagnostics.missingSceneVFXPresetIds.join(", ")}`,
    );
  }
  if (diagnostics.missingParticleVFXIds.length > 0) {
    parts.push(
      `Missing particle VFX: ${diagnostics.missingParticleVFXIds.join(", ")}`,
    );
  }
  if (diagnostics.missingSFXCueIds.length > 0) {
    parts.push(`Missing SFX: ${diagnostics.missingSFXCueIds.join(", ")}`);
  }
  parts.push(...diagnostics.eventAdapterWarnings);
  return parts.length > 0 ? parts.join(" / ") : null;
}
