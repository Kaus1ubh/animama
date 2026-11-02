import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import {
  TabsList,
  TabsTrigger,
  underlineTabClassName,
} from "@/ui/components/tabs";

import {
  modelProviderLabel,
  providerConnected,
  type ModelProviderGroup,
  type ProviderConnectionState,
} from "./model-configuration-state";

/**
 * The provider tabs under Cloud | Local, shared by setup's AI step and App
 * Settings → Models: left-aligned underline tabs in the location's provider
 * order, with a dot (and screen-reader text) on connected providers. Render
 * inside a `Tabs` whose values are the provider entry ids. Tabs are padded
 * more tightly than Library tabs so every Cloud provider fits the settings
 * dialog at desktop widths; narrower windows scroll the strip.
 * `showRecommended` tags the recommended providers (setup shows it; the
 * settings dialog marks them on their cards instead).
 */
export function ModelProviderTabsList({
  groups,
  active,
  label,
  showRecommended = false,
}: {
  groups: readonly ModelProviderGroup<ProviderConnectionState>[];
  active: string;
  /** Accessible name of the strip, e.g. "Cloud providers". */
  label: string;
  showRecommended?: boolean;
}) {
  const { t } = useTranslation("models");
  return (
    <TabsList
      variant="underline"
      aria-label={label}
      className="w-fit max-w-full"
    >
      {groups.map((group) => {
        const { id } = group.entry;
        return (
          <TabsTrigger
            key={id}
            value={id}
            variant="underline"
            className={cn(underlineTabClassName(active === id), "px-2")}
          >
            <span className="inline-flex items-center gap-1.5">
              {modelProviderLabel(group.entry)}
              {showRecommended && group.entry.recommended ? (
                <span className="bg-primary/10 text-primary text-2xs rounded-sm px-1.5 py-0.5 font-medium">
                  {t("providers.recommended")}
                </span>
              ) : null}
              {providerConnected(group) ? (
                <>
                  <span
                    aria-hidden
                    className="bg-primary size-1.5 rounded-full"
                  />
                  <span className="sr-only">{t("providers.connected")}</span>
                </>
              ) : null}
            </span>
          </TabsTrigger>
        );
      })}
    </TabsList>
  );
}
