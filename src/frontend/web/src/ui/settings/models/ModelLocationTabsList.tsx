import { useTranslation } from "react-i18next";

import {
  TabsList,
  TabsTrigger,
  underlineTabClassName,
} from "@/ui/components/tabs";
import { cn } from "@/lib/utils";

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
    <TabsList
      variant="underline"
      aria-label={t("locations.tabsLabel")}
      className="gap-0"
    >
      {MODEL_LOCATION_TABS.map((id) => (
        <TabsTrigger
          key={id}
          value={id}
          variant="underline"
          className={cn(underlineTabClassName(active === id), "flex-1")}
        >
          {id === recommended ? (
            <span className="inline-flex items-center gap-2">
              {modelLocationLabel(id)}
              <span className="bg-primary/10 text-primary text-2xs rounded-sm px-1.5 py-0.5 font-medium">
                {t("providers.recommended")}
              </span>
            </span>
          ) : (
            modelLocationLabel(id)
          )}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}
