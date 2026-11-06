import { getI18n } from "react-i18next";

/**
 * Shown instead of model download or removal actions where the runtime's
 * operator provides speech models (see `useOperatorManagedModelAssets`).
 */
export function operatorManagedModelsNote(): string {
  const t = getI18n().getFixedT(null, "models");
  return t("operatorManaged.note");
}

/**
 * Shown instead of a download once model downloads have ended (see
 * `modelDownloadsEnded`): what still works without them.
 */
export function modelDownloadsEndedNote(): string {
  const t = getI18n().getFixedT(null, "models");
  return t("downloadsEnded.note");
}
