import { toast } from "sonner";

import { copyText } from "@/lib/diagnostics/copy-text";
import { buildDiagnosticsSummary } from "@/lib/diagnostics/summary";
import { env } from "@/platform/env";
import { useRuntimePlatform } from "@/platform/RuntimePlatformProvider";
import { useDesktopFeaturePacks } from "@/hooks/useDesktopFeaturePacks";
import { Button } from "@/ui/components/button";
import { SettingsRow } from "@/ui/settings/SettingsLayout";

const OS_LABELS: Record<string, string> = {
  darwin: "macOS",
  win32: "Windows",
  linux: "Linux",
};

/** Human-readable platform: desktop OS, or the browser app. */
function usePlatformLabel(): string {
  const platform = useRuntimePlatform();
  if (!platform.isDesktop) return "Web browser";
  const os = platform.os ? (OS_LABELS[platform.os] ?? platform.os) : null;
  return os ? `Desktop (${os})` : "Desktop";
}

/** App version and platform, shown in both the browser and desktop app. */
export function AboutVersionSetting() {
  const platformLabel = usePlatformLabel();
  return (
    <SettingsRow
      label="Version"
      description={platformLabel}
      control={
        <span className="text-foreground font-mono text-sm">
          {env.appVersion}
        </span>
      }
    />
  );
}

/** Desktop only: reveal the redacted main-process log folder. */
export function OpenLogsSetting() {
  const platform = useRuntimePlatform();
  const runtime = platform.isDesktop
    ? platform.desktopBridge.runtime
    : undefined;
  return (
    <SettingsRow
      label="Logs"
      description="Open the folder with Animama's logs for troubleshooting."
      control={
        <Button
          type="button"
          variant="outline"
          disabled={!runtime}
          onClick={() => {
            void runtime
              ?.openLogs()
              .catch(() => toast.error("The logs folder could not be opened."));
          }}
        >
          Open logs folder
        </Button>
      }
    />
  );
}

/**
 * Copy a bug-report summary. Collects only status facts; see
 * `lib/diagnostics/summary.ts` for what is and is not included.
 */
export function CopyDiagnosticsSetting() {
  const platform = useRuntimePlatform();
  const { packs } = useDesktopFeaturePacks();

  const copy = async () => {
    const bridge = platform.isDesktop ? platform.desktopBridge : null;
    // Each desktop fact is optional; a failed read simply leaves it out.
    const [runtime, providers] = await Promise.all([
      bridge?.runtime?.status().catch(() => null) ?? null,
      bridge?.credentials?.list().catch(() => null) ?? null,
    ]);
    const summary = buildDiagnosticsSummary({
      appVersion: env.appVersion,
      platform: platform.isDesktop
        ? `desktop-${platform.os ?? "unknown"}`
        : "web",
      runtime:
        runtime && "code" in runtime
          ? { state: runtime.state, code: runtime.code }
          : runtime
            ? { state: runtime.state }
            : null,
      featurePacks: packs.map((pack) => ({
        id: pack.id,
        state: pack.state,
        // Only the installed version; `version` may be the one on offer.
        version: pack.activeVersion,
      })),
      providers: providers?.map((status) => ({
        provider: status.provider,
        configured: status.configured,
      })),
    });
    if (await copyText(summary)) toast.success("Diagnostics copied.");
    else toast.error("Diagnostics could not be copied to the clipboard.");
  };

  return (
    <SettingsRow
      label="Diagnostics"
      description="Copy version, platform and component status for a bug report. Keys, chats and memories are never included."
      control={
        <Button type="button" variant="outline" onClick={() => void copy()}>
          Copy summary
        </Button>
      }
    />
  );
}
