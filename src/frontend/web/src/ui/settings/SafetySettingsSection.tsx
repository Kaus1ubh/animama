import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { preferredClientLocale } from "@animama/product-ui/chat";
import { getCrisisResourcesV1SafetyCrisisResourcesGet } from "@animama/runtime-contracts/sdk";
import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
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

function formatHours(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} minutes`;
  return hours === 1 ? "1 hour" : `${hours} hours`;
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
  const ownerId = useRuntimeOwnerId();
  const capabilities = useRuntimeCapabilities();
  const locale = preferredClientLocale() ?? "";
  const resources = useQuery({
    queryKey: queryKeys.crisisResources(ownerId ?? "__anon__", locale),
    enabled: Boolean(ownerId),
    queryFn: async ({ signal }) =>
      (
        await getCrisisResourcesV1SafetyCrisisResourcesGet({
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
      .catch(() => toast.error("Safety settings could not be saved."))
      .finally(() => setIsSaving(false));
  };

  if (safetyCapability && !safetyCapability.enabled) {
    return (
      <SettingsGroup title="Safety">
        <SettingsRow
          label="Safety features"
          description="The operator of this installation has turned off the AI notice and crisis support."
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
  const automaticLabel =
    resources.data && !resources.data.preferred_region
      ? `Automatic (${resources.data.resolved.label})`
      : "Automatic";

  return (
    <SettingsGroup title="Safety">
      <SettingsRow
        label="Crisis resources region"
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
              aria-label="Crisis resources region"
            >
              <SelectValue placeholder="Automatic" />
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
          label="AI reminder during long conversations"
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
                aria-label="AI reminder interval"
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
                    Every {formatHours(hours)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
      ) : null}

      <SettingsRow
        label="Safety and crisis protocol"
        control={
          <SafetyProtocolDialog className="text-sm underline underline-offset-2" />
        }
      />
    </SettingsGroup>
  );
}
