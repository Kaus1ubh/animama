import { useProductApiClient } from "@animama/product-ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { preferredClientLocale } from "@animama/product-ui/chat";
import { getCrisisResourcesV1SafetyCrisisResourcesGet } from "@animama/runtime-contracts/sdk";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";
import { useRuntimeCapabilities } from "@/query/hooks/useRuntimeCapabilities";
import { reminderHourOptions } from "@/lib/safety/reminderOptions";
import type {
  SafetyPreferences,
  SettingsPreferences,
} from "@/lib/settings/preferences";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select";
import { SafetyProtocolDialog } from "@/ui/safety/SafetyProtocolDialog";
import { SettingsGroup, SettingsRow } from "@/ui/settings/SettingsLayout";

const AUTOMATIC_REGION = "__automatic__";
const OPERATOR_INTERVAL = "__operator__";
const SELECT_TRIGGER_CLASS_NAME = "w-56";

/** Reminder interval choice, e.g. "Every 30 minutes" or "Every 2 hours". */
function reminderIntervalLabel(
  t: TFunction<"settings">,
  hours: number,
): string {
  if (hours < 1)
    return t("safety.reminder.everyMinutes", {
      count: Math.round(hours * 60),
    });
  return t("safety.reminder.everyHours", { count: hours });
}

type SafetySettingsSectionProps = {
  safety: SafetyPreferences | undefined;
  updateUserPreferences: (patch: SettingsPreferences) => Promise<unknown>;
  disabled?: boolean;
};

/**
 * Owner safety choices (spec R8). Nothing here can turn a safety feature off;
 * operators use `ANIMAMA_COMPANION_SAFETY_ENABLED` for that.
 */
export function SafetySettingsSection({
  safety,
  updateUserPreferences,
  disabled = false,
}: SafetySettingsSectionProps) {
  const apiClient = useProductApiClient();
  const { t } = useTranslation(["settings", "safety"]);

  const ownerId = useRuntimeCacheKey();
  const capabilities = useRuntimeCapabilities();
  const locale = preferredClientLocale() ?? "";
  const resources = useQuery({
    queryKey: queryKeys.crisisResources(ownerId ?? "__anon__", locale),
    enabled: Boolean(ownerId),
    queryFn: async ({ signal }) =>
      (
        await getCrisisResourcesV1SafetyCrisisResourcesGet({
          client: apiClient,
          query: { locale },
          signal,
          throwOnError: true,
        })
      ).data,
  });
  const [isSaving, setIsSaving] = useState(false);
  const safetyCapability = capabilities.data?.companion_safety;
  const operatorHours = safetyCapability?.operator_reminder_hours ?? 3;

  const save = (patch: SafetyPreferences) => {
    setIsSaving(true);
    void updateUserPreferences({ safety: patch })
      .then(() => resources.refetch())
      .catch(() => toast.error(t("safety.saveFailed")))
      .finally(() => setIsSaving(false));
  };

  if (safetyCapability && !safetyCapability.enabled) {
    return (
      <SettingsGroup title={t("sections.safety")}>
        <SettingsRow
          label={t("safety.disabled.label")}
          description={t("safety.disabled.description")}
        >
          <SafetyProtocolDialog className="self-start text-sm underline underline-offset-2" />
        </SettingsRow>
      </SettingsGroup>
    );
  }

  const busy = disabled || isSaving;
  const region = safety?.crisis_resource_region ?? null;
  const reminderHours = safety?.reminder_hours ?? null;
  // With no owner preference, the server resolves the region from this locale.
  // Region names are verified backend data and stay as sent.
  const automaticLabel =
    resources.data && !resources.data.preferred_region
      ? t("safety.region.automaticResolved", {
          region: resources.data.resolved.label,
        })
      : t("safety.region.automatic");

  return (
    <SettingsGroup title={t("sections.safety")}>
      <SettingsRow
        label={t("safety.region.label")}
        control={
          <Select
            value={region ?? AUTOMATIC_REGION}
            onValueChange={(value) =>
              save({
                crisis_resource_region:
                  value === AUTOMATIC_REGION ? null : value,
              })
            }
            disabled={busy}
          >
            <SelectTrigger
              className={SELECT_TRIGGER_CLASS_NAME}
              aria-label={t("safety.region.label")}
            >
              <SelectValue placeholder={t("safety.region.automatic")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTOMATIC_REGION}>{automaticLabel}</SelectItem>
              {(resources.data?.regions ?? []).map((option) => (
                <SelectItem key={option.code} value={option.code}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      {safetyCapability?.ai_notice_enabled !== false ? (
        <SettingsRow
          label={t("safety.reminder.label")}
          control={
            <Select
              value={
                reminderHours !== null && reminderHours < operatorHours
                  ? String(reminderHours)
                  : OPERATOR_INTERVAL
              }
              onValueChange={(value) =>
                save({
                  reminder_hours:
                    value === OPERATOR_INTERVAL ? null : Number(value),
                })
              }
              disabled={busy}
            >
              <SelectTrigger
                className={SELECT_TRIGGER_CLASS_NAME}
                aria-label={t("safety.reminder.ariaLabel")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {reminderHourOptions(operatorHours).map((hours) => (
                  <SelectItem
                    key={hours}
                    value={
                      hours === operatorHours
                        ? OPERATOR_INTERVAL
                        : String(hours)
                    }
                  >
                    {reminderIntervalLabel(t, hours)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
      ) : null}

      <SettingsRow
        label={t("safety:protocol.title")}
        control={
          <SafetyProtocolDialog className="text-sm underline underline-offset-2" />
        }
      />
    </SettingsGroup>
  );
}
