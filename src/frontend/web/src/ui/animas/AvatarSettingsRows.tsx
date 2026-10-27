"use client";

import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  AVATAR_MATERIAL_MODES,
  AVATAR_SPRING_MODES,
  useAvatarFileUsesLilToon,
  type AvatarMaterialMode,
  type AvatarSpringMode,
} from "@/lib/avatar/avatarSettings";
import { cn } from "@/lib/utils";
import {
  useAvatarSettings,
  useAvatarSettingsAvailable,
} from "@/query/hooks/useAvatarSettings";
import { useSaveAvatarSettings } from "@/query/mutations/useSaveAvatarSettings";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select";
import { materialModeLabel, springModeLabel } from "./avatarSettingLabels";

type AvatarSettingRowProps<Mode extends string> = {
  label: string;
  description: string;
  value: Mode;
  modes: readonly Mode[];
  modeLabel: (mode: Mode) => string;
  disabled: boolean;
  onChange: (mode: Mode) => void;
};

/** One setting of an Avatar, chosen from its modes. */
function AvatarSettingRow<Mode extends string>({
  label,
  description,
  value,
  modes,
  modeLabel,
  disabled,
  onChange,
}: AvatarSettingRowProps<Mode>) {
  return (
    <div
      className={cn(
        "border-border/60 bg-background flex flex-col gap-3 rounded-lg border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4",
        disabled && "opacity-70",
      )}
    >
      <div className="min-w-0">
        <p className="text-foreground text-sm font-medium">{label}</p>
        <p className="text-muted-foreground text-xs">{description}</p>
      </div>
      <Select
        value={value}
        disabled={disabled}
        onValueChange={(next) => onChange(next as Mode)}
      >
        <SelectTrigger className="w-full shrink-0 sm:w-48" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {modes.map((mode) => (
            <SelectItem key={mode} value={mode}>
              {modeLabel(mode)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

type AvatarSettingsRowsProps = {
  /** The Avatar catalog item the settings are kept for. */
  itemId: string | null;
  /** The sha256 of the item's VRM file, to know whether it has lilToon materials. */
  vrmSha256: string | null;
};

/**
 * An Avatar's settings, kept per Avatar item by the local runtimes, so they
 * apply wherever the Avatar is used (the Anima settings and the Library show
 * the same rows). Materials is offered only for a file with lilToon
 * materials (known once this session has read the file), or while a stored
 * choice needs a way back to Automatic. Renders nothing where the runtime
 * keeps no settings or without an item.
 */
export function AvatarSettingsRows({
  itemId,
  vrmSha256,
}: AvatarSettingsRowsProps) {
  const { t } = useTranslation("settings");
  const { available } = useAvatarSettingsAvailable();
  const usesLilToon = useAvatarFileUsesLilToon(vrmSha256);
  const settings = useAvatarSettings(itemId);
  const save = useSaveAvatarSettings(itemId);
  if (!available || !itemId) return null;

  const busy = settings.isLoading || save.isPending;
  const springMode = settings.data?.spring_mode ?? "automatic";
  const materialMode = settings.data?.material_mode ?? "automatic";
  const showMaterials =
    usesLilToon === true || settings.data?.material_mode_source === "stored";
  const saveFailed = () => toast(t("animaSettings.updateFailed.avatar"));
  return (
    <>
      <AvatarSettingRow<AvatarSpringMode>
        label={t("animaSettings.avatar.wind.label")}
        description={t("animaSettings.avatar.wind.description")}
        value={springMode}
        modes={AVATAR_SPRING_MODES}
        modeLabel={(mode) => springModeLabel(t, mode)}
        disabled={busy}
        onChange={(mode) =>
          save.mutate(
            // Automatic is stored as no value.
            { spring_mode: mode === "automatic" ? null : mode },
            { onError: saveFailed },
          )
        }
      />
      {showMaterials ? (
        <AvatarSettingRow<AvatarMaterialMode>
          label={t("animaSettings.avatar.materials.label")}
          description={t("animaSettings.avatar.materials.description")}
          value={materialMode}
          modes={AVATAR_MATERIAL_MODES}
          modeLabel={(mode) => materialModeLabel(t, mode)}
          disabled={busy}
          onChange={(mode) =>
            save.mutate(
              { material_mode: mode === "automatic" ? null : mode },
              { onError: saveFailed },
            )
          }
        />
      ) : null}
    </>
  );
}
