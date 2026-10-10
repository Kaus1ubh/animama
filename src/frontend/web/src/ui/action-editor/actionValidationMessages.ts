import { getI18n } from "react-i18next";

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
  const t = getI18n().getFixedT(null, "actionEditor");
  const parts: string[] = [];
  if (diagnostics.missingPoseRefs.length > 0) {
    parts.push(
      t("validation.missing.poses", { ids: diagnostics.missingPoseRefs }),
    );
  }
  if (diagnostics.missingAvatarVFXIds.length > 0) {
    parts.push(
      t("validation.missing.avatarEffects", {
        ids: diagnostics.missingAvatarVFXIds,
      }),
    );
  }
  if (diagnostics.missingSceneVFXPresetIds.length > 0) {
    parts.push(
      t("validation.missing.sceneEffects", {
        ids: diagnostics.missingSceneVFXPresetIds,
      }),
    );
  }
  if (diagnostics.missingParticleVFXIds.length > 0) {
    parts.push(
      t("validation.missing.particleEffects", {
        ids: diagnostics.missingParticleVFXIds,
      }),
    );
  }
  if (diagnostics.missingSFXCueIds.length > 0) {
    parts.push(
      t("validation.missing.sounds", { ids: diagnostics.missingSFXCueIds }),
    );
  }
  parts.push(...diagnostics.eventAdapterWarnings);
  return parts.length > 0 ? parts.join(" / ") : null;
}
