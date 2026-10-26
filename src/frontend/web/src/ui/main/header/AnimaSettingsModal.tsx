"use client";

import { Stethoscope } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  animaBehaviorOverride,
  appBehaviorEnabled,
  behaviorPatch,
  effectiveBehaviorEnabled,
  type BehaviorFlag,
  type BehaviorOverride,
} from "@/lib/settings/behavior-defaults";
import {
  AVATAR_MATERIAL_MODES,
  AVATAR_SPRING_MODES,
  useAvatarFileUsesLilToon,
  type AvatarMaterialMode,
  type AvatarSpringMode,
} from "@/lib/avatar/avatarSettings";
import { runtimeAvatarModelSha256 } from "@/lib/runtime-content/runtimeAvatarFaceParts";
import { adaptRuntimeSnapshot } from "@/lib/runtime-content/runtimeSnapshotAdapter";
import { cn } from "@/lib/utils";
import { useAnimaLoadout } from "@/query/hooks/useAnimaLoadout";
import { useAnimaRuntimeCatalog } from "@/query/hooks/useAnimaRuntimeCatalog";
import {
  useAvatarSettings,
  useAvatarSettingsAvailable,
} from "@/query/hooks/useAvatarSettings";
import { useSaveAvatarSettings } from "@/query/mutations/useSaveAvatarSettings";
import { AvatarDiagnosticsDialog } from "@/ui/animas/AvatarDiagnosticsDialog";
import {
  materialModeLabel,
  springModeLabel,
} from "@/ui/animas/avatarSettingLabels";
import { Button } from "@/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/ui/components/tooltip";
import { behaviorLabel } from "@/ui/settings/BehaviorDataSettings";
import { useSettings } from "@/ui/settings/SettingsProvider";

type InheritableSettingRowProps = {
  label: string;
  description: string;
  tooltip: string;
  value: BehaviorOverride;
  /** The App Settings value shown for "Use app default". */
  appEnabled: boolean;
  disabled?: boolean;
  onChange: (value: BehaviorOverride) => void;
};

/**
 * A memory/emotion behaviour that follows App Settings unless this Anima sets
 * its own value.
 */
function InheritableSettingRow({
  label,
  description,
  tooltip,
  value,
  appEnabled,
  disabled,
  onChange,
}: InheritableSettingRowProps) {
  const { t } = useTranslation("settings");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
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
            onValueChange={(next) => onChange(next as BehaviorOverride)}
          >
            <SelectTrigger
              className="w-full shrink-0 sm:w-48"
              aria-label={label}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inherit">
                {appEnabled
                  ? t("animaSettings.choices.appDefaultOn")
                  : t("animaSettings.choices.appDefaultOff")}
              </SelectItem>
              <SelectItem value="on">
                {t("animaSettings.choices.on")}
              </SelectItem>
              <SelectItem value="off">
                {t("animaSettings.choices.off")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </TooltipTrigger>
      <TooltipContent sideOffset={6}>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

type AvatarSettingRowProps<Mode extends string> = {
  label: string;
  description: string;
  value: Mode;
  modes: readonly Mode[];
  modeLabel: (mode: Mode) => string;
  disabled: boolean;
  onChange: (mode: Mode) => void;
};

/** One setting of the Anima's Avatar, chosen from its modes. */
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

/**
 * The Anima's Avatar settings, kept per Avatar item by the local runtimes, so
 * they apply wherever the Avatar is used. Materials is offered only for a
 * file with lilToon materials (known once the Avatar has loaded), or while a
 * stored choice needs a way back to Automatic.
 */
function AvatarSettingsRows({ animaId }: { animaId: string }) {
  const { t } = useTranslation("settings");
  const { available } = useAvatarSettingsAvailable();
  const loadout = useAnimaLoadout(animaId);
  const itemId = loadout.data?.avatar_source?.catalog_item_id ?? null;
  const runtime = useAnimaRuntimeCatalog(available ? animaId : null);
  const vrmSha256 = useMemo(
    () =>
      runtime.data
        ? runtimeAvatarModelSha256(
            adaptRuntimeSnapshot(runtime.data).avatar_model,
          )
        : null,
    [runtime.data],
  );
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

/** The Anima's Avatar diagnostics, opened in their own dialog. */
function AvatarDiagnosticsRow({ animaId }: { animaId: string }) {
  const { t } = useTranslation("settings");
  const [open, setOpen] = useState(false);
  return (
    <div className="border-border/60 bg-background flex flex-col gap-3 rounded-lg border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <p className="text-foreground text-sm font-medium">
          {t("animaSettings.rows.avatar_diagnostics.label")}
        </p>
        <p className="text-muted-foreground text-xs">
          {t("animaSettings.rows.avatar_diagnostics.description")}
        </p>
      </div>
      <Button
        variant="outline"
        className="w-full shrink-0 sm:w-48"
        onClick={() => setOpen(true)}
      >
        <Stethoscope /> {t("animaSettings.rows.avatar_diagnostics.open")}
      </Button>
      <AvatarDiagnosticsDialog
        animaId={animaId}
        open={open}
        onOpenChange={setOpen}
      />
    </div>
  );
}

type AnimaSettingsModalProps = {
  /** The Anima whose Avatar the Diagnostics section describes. */
  animaId?: string | null;
};

export function AnimaSettingsModal({ animaId }: AnimaSettingsModalProps = {}) {
  const { t } = useTranslation("settings");
  const {
    userPreferences,
    animaPreferences,
    updateAnimaPreferences,
    isLoading,
    isUpdating,
  } = useSettings();
  const isBusy = isLoading || isUpdating;
  const memoryEnabled = effectiveBehaviorEnabled(
    userPreferences,
    animaPreferences,
    "memory_influence",
  );

  const handleBehaviorChange = useCallback(
    (flag: BehaviorFlag, choice: BehaviorOverride) => {
      if (isBusy) return;
      void updateAnimaPreferences(behaviorPatch(flag, choice)).catch(() =>
        toast(
          flag === "emotion_updates"
            ? t("animaSettings.updateFailed.emotion")
            : t("animaSettings.updateFailed.memory"),
        ),
      );
    },
    [isBusy, t, updateAnimaPreferences],
  );

  return (
    <div className="border-border/60 bg-muted/10 flex flex-1 flex-col gap-6 rounded-xl border p-4 sm:p-6">
      <div>
        <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
          {t("animaSettings.headings.emotion")}
        </p>
        <div className="mt-3 grid gap-3">
          <InheritableSettingRow
            label={behaviorLabel(t, "emotion_updates")}
            description={t("animaSettings.rows.emotion_updates.description")}
            tooltip={t("animaSettings.rows.emotion_updates.tooltip")}
            value={animaBehaviorOverride(animaPreferences, "emotion_updates")}
            appEnabled={appBehaviorEnabled(userPreferences, "emotion_updates")}
            disabled={isBusy}
            onChange={(choice) =>
              handleBehaviorChange("emotion_updates", choice)
            }
          />
        </div>
      </div>

      <div>
        <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
          {t("animaSettings.headings.memory")}
        </p>
        <div className="mt-3 grid gap-3">
          <InheritableSettingRow
            label={behaviorLabel(t, "memory_influence")}
            description={t("animaSettings.rows.memory_influence.description")}
            tooltip={t("animaSettings.rows.memory_influence.tooltip")}
            value={animaBehaviorOverride(animaPreferences, "memory_influence")}
            appEnabled={appBehaviorEnabled(userPreferences, "memory_influence")}
            disabled={isBusy}
            onChange={(choice) =>
              handleBehaviorChange("memory_influence", choice)
            }
          />
          <InheritableSettingRow
            label={behaviorLabel(t, "memory_updates")}
            description={
              memoryEnabled
                ? t("animaSettings.rows.memory_updates.description")
                : t("animaSettings.rows.memory_updates.memoryOff")
            }
            tooltip={t("animaSettings.rows.memory_updates.tooltip")}
            value={animaBehaviorOverride(animaPreferences, "memory_updates")}
            appEnabled={appBehaviorEnabled(userPreferences, "memory_updates")}
            disabled={!memoryEnabled || isBusy}
            onChange={(choice) =>
              handleBehaviorChange("memory_updates", choice)
            }
          />
        </div>
      </div>

      {animaId ? (
        <div>
          <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
            {t("animaSettings.headings.avatar")}
          </p>
          <div className="mt-3 grid gap-3">
            <AvatarSettingsRows animaId={animaId} />
            <AvatarDiagnosticsRow animaId={animaId} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
