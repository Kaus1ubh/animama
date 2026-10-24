import { useTranslation } from "react-i18next";

import { ChoiceTabsList } from "@/ui/settings/choice-tabs/ChoiceTabsList";

import {
  MODEL_LOCATION_TABS,
  modelLocationLabel,
} from "./model-configuration-state";

/**
 * The Cloud | Local tab strip shared by setup's AI step and App Settings →
 * Models: two centered tabs, each half the width. `recommended` marks one
 * location with a tag (setup recommends Cloud).
 */
export function ModelLocationTabsList({
  active,
  recommended,
}: {
  active: string;
  recommended?: string;
}) {
  const { t } = useTranslation("models");
  return (
    <ChoiceTabsList
      tabs={MODEL_LOCATION_TABS.map((id) => ({
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
