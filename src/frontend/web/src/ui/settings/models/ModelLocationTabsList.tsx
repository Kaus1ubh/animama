import { useTranslation } from "react-i18next";

import { ChoiceTabsList } from "@/ui/settings/choice-tabs/ChoiceTabsList";

import {
  modelLocationLabel,
  type ModelLocation,
} from "./model-configuration-state";

/**
 * The Cloud | Local tab strip shared by setup's AI step and App Settings →
 * Models: centered tabs of equal width, from `visibleModelLocations`. A single
 * location needs no strip, so it renders nothing. `recommended` marks one
 * location with a tag (setup recommends Cloud).
 */
export function ModelLocationTabsList({
  locations,
  active,
  recommended,
}: {
  locations: readonly ModelLocation[];
  active: string;
  recommended?: string;
}) {
  const { t } = useTranslation("models");
  if (locations.length < 2) return null;
  return (
    <ChoiceTabsList
      tabs={locations.map((id) => ({
        id,
        label: modelLocationLabel(id),
        recommended: id === recommended,
      }))}
      active={active}
      label={t("locations.tabsLabel")}
      recommendedLabel={t("providers.recommended")}
    />
  );
}
