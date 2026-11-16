import { useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useFormatters, type LocaleFormatters } from "@animama/product-ui/i18n";

import {
  type FeaturePackId,
  type FeaturePackStatus,
} from "../../../../shared/desktop-runtime";
import { useDesktopFeaturePacks } from "@/hooks/useDesktopFeaturePacks";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/components/button";

/** Display name and description of a pack; pack IDs stay fixed identifiers. */
function packText(
  t: TFunction<"settings">,
  id: FeaturePackId,
): { name: string; description: string } {
  switch (id) {
    case "expanded-included-content":
      return {
        name: t("featurePacks.packs.expandedIncludedContent.name"),
        description: t(
          "featurePacks.packs.expandedIncludedContent.description",
        ),
      };
  }
}

/** Display text for a pack's state. */
function packStateLabel(
  t: TFunction<"settings">,
  state: FeaturePackStatus["state"],
): string {
  switch (state) {
    case "not_installed":
      return t("featurePacks.states.not_installed");
    case "downloading":
      return t("featurePacks.states.downloading");
    case "verifying":
      return t("featurePacks.states.verifying");
    case "installing":
      return t("featurePacks.states.installing");
    case "installed":
      return t("featurePacks.states.installed");
    case "failed":
      return t("featurePacks.states.failed");
    case "update_available":
      return t("featurePacks.states.update_available");
  }
}

/** Exact byte counts come from the embedded release catalog, not estimates in UI code. */
export function packSizeSummary(
  t: TFunction<"settings">,
  format: LocaleFormatters,
  pack: FeaturePackStatus,
): string {
  if (
    pack.downloadBytes === undefined ||
    pack.installedBytes === undefined ||
    pack.minimumFreeBytes === undefined
  )
    return t("featurePacks.noCompatiblePack");
  return t("featurePacks.sizes", {
    download: format.number(pack.downloadBytes),
    installed: format.number(pack.installedBytes),
    free: format.number(pack.minimumFreeBytes),
  });
}

/** Settings controls to install, update and remove the desktop's optional feature packs. */
export function DesktopFeaturePacksPanel({
  className,
}: {
  className?: string;
}) {
  const { t } = useTranslation("settings");
  const format = useFormatters();
  const { available, packs, pending, error, run } = useDesktopFeaturePacks();
  const [confirmRemove, setConfirmRemove] = useState<FeaturePackId | null>(
    null,
  );
  if (!available) return null;
  // Settings follows the embedded catalog. Preserve retained files for
  // removal/recovery even if a later release no longer offers their pack.
  const visiblePacks = packs.filter(
    (pack) => pack.hasInstalledFiles || pack.available,
  );
  if (!visiblePacks.length && !error) return null;
  const changing = packs.some((pack) =>
    ["downloading", "verifying", "installing"].includes(pack.state),
  );
  return (
    <section
      className={cn(
        "border-border/60 bg-muted/10 space-y-4 rounded-xl border p-5",
        className,
      )}
      aria-label={t("featurePacks.title")}
    >
      <h3 className="text-base font-semibold">{t("featurePacks.title")}</h3>
      <p className="text-muted-foreground text-sm">
        {t("featurePacks.reloadWarning")}
      </p>
      {visiblePacks.map((pack) => {
        const { id } = pack;
        const { name, description } = packText(t, id);
        const busy = ["downloading", "verifying", "installing"].includes(
          pack.state,
        );
        return (
          <div key={id} className="space-y-2">
            <h4 className="text-sm font-medium">{name}</h4>
            <p className="text-muted-foreground text-sm">{description}</p>
            <p className="text-muted-foreground text-xs">
              {packSizeSummary(t, format, pack)}
            </p>
            <p className="text-sm" role="status">
              {/* The version and error code are identifiers shown as sent. */}
              {[packStateLabel(t, pack.state), pack.version, pack.error]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {busy ? (
              <progress
                className="w-full"
                max={1}
                value={pack.progress ?? 0}
                aria-label={t("featurePacks.progress", { name })}
              />
            ) : null}
            <div className="flex flex-wrap gap-2">
              {pack.state !== "installed" &&
              // A refused removal reports `failed` while this version stays active.
              !(pack.activeVersion && pack.activeVersion === pack.version) ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!pack.available || changing || pending !== null}
                  onClick={() => void run("install", id)}
                >
                  {pack.state === "update_available"
                    ? t("featurePacks.actions.installCompatible")
                    : t("featurePacks.actions.install")}
                </Button>
              ) : null}
              {busy ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => void run("cancel", id)}
                >
                  {t("actions.cancel")}
                </Button>
              ) : null}
              {pack.hasInstalledFiles && !busy ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={changing || pending !== null}
                  onClick={() => {
                    if (confirmRemove !== id) setConfirmRemove(id);
                    else {
                      setConfirmRemove(null);
                      void run("remove", id);
                    }
                  }}
                >
                  {confirmRemove === id
                    ? t("featurePacks.actions.confirmRemove")
                    : t("featurePacks.actions.remove")}
                </Button>
              ) : null}
            </div>
            {pack.error === "pack_in_use" ? (
              <p className="text-muted-foreground text-sm">
                {t("featurePacks.inUse")}
              </p>
            ) : null}
            {pack.error === "pack_cleanup_pending" ? (
              <p className="text-muted-foreground text-sm">
                {t("featurePacks.cleanupPending")}
              </p>
            ) : null}
            {pack.blockers?.length ? (
              <ul className="text-muted-foreground list-inside list-disc text-sm">
                {/* Blocker names come from the runtime and stay as sent. */}
                {pack.blockers.map((blocker) => (
                  <li key={`${blocker.kind}:${blocker.id}`}>{blocker.label}</li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
