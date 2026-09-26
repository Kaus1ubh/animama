import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

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

const AUTOMATIC_REGION = "__automatic__";
const OPERATOR_INTERVAL = "__operator__";

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
  const locale = typeof navigator === "undefined" ? "" : navigator.language;
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
      <section className="border-border/60 bg-muted/10 flex flex-col gap-3 rounded-xl border p-5">
        <h3 className="text-foreground text-base font-semibold">Safety</h3>
        <p className="text-muted-foreground text-sm">
          The operator of this installation has turned off the AI notice and
          crisis support.
        </p>
        <SafetyProtocolDialog className="self-start text-sm underline underline-offset-2" />
      </section>
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
    <section className="border-border/60 bg-muted/10 flex flex-col gap-4 rounded-xl border p-5">
      <div>
        <h3 className="text-foreground text-base font-semibold">Safety</h3>
        <p className="text-muted-foreground text-sm">
          Animas are AI, not people. These settings choose which crisis lines
          you see and how often you are reminded.
        </p>
      </div>

      <div className="grid gap-2">
        <p className="text-foreground text-sm font-medium">
          Crisis resources region
        </p>
        <Select
          value={region ?? AUTOMATIC_REGION}
          onValueChange={(value) =>
            save({
              crisis_resource_region: value === AUTOMATIC_REGION ? null : value,
            })
          }
          disabled={busy}
        >
          <SelectTrigger
            className="w-full"
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
      </div>

      {safetyCapability?.ai_notice_enabled !== false ? (
        <div className="grid gap-2">
          <p className="text-foreground text-sm font-medium">
            AI reminder during long conversations
          </p>
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
            <SelectTrigger className="w-full" aria-label="AI reminder interval">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {reminderHourOptions(operatorHours).map((hours) => (
                <SelectItem
                  key={hours}
                  value={
                    hours === operatorHours ? OPERATOR_INTERVAL : String(hours)
                  }
                >
                  Every {formatHours(hours)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <SafetyProtocolDialog className="self-start text-sm underline underline-offset-2" />
    </section>
  );
}
