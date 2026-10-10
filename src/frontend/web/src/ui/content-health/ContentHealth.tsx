"use client";

import { AlertTriangle, LoaderCircle, WifiOff } from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { PyContentDiagnostic } from "@animama/runtime-contracts/api-types";
import { SOURCE_LOCALE } from "@animama/runtime-contracts/locale";

import { uncodedErrorText, type ApiErrorText } from "@/lib/errors/apiError";
import { cn } from "@/lib/utils";
import { useRuntimeCapabilities } from "@/query/hooks/useRuntimeCapabilities";
import {
  useContentCatalog,
  useRescanContent,
} from "@/query/hooks/useContentCatalog";
import { Button } from "@/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/ui/components/popover";

/** File formats whose signature checks report `invalid_<format>_header`. */
const HEADER_FORMATS: Record<string, string> = {
  invalid_png_header: "PNG",
  invalid_jpeg_header: "JPEG",
  invalid_webp_header: "WebP",
  invalid_wav_header: "WAV",
  invalid_ogg_header: "Ogg",
  invalid_flac_header: "FLAC",
  invalid_mp3_header: "MP3",
};

/** Catalog wording for a scan diagnostic code, or `null` when the code is not worded. */
function diagnosticWording(
  t: TFunction<"contentHealth">,
  code: string,
): string | null {
  const format = HEADER_FORMATS[code];
  if (format) return t("diagnostics.invalidHeader", { format });
  switch (code) {
    case "case_collision":
      return t("diagnostics.case_collision");
    case "empty_file":
      return t("diagnostics.empty_file");
    case "entry_too_large":
      return t("diagnostics.entry_too_large");
    case "file_too_large":
      return t("diagnostics.file_too_large");
    case "hard_link_rejected":
      return t("diagnostics.hard_link_rejected");
    case "incomplete_operation":
      return t("diagnostics.incomplete_operation");
    case "invalid_gltf_asset":
      return t("diagnostics.invalid_gltf_asset");
    case "invalid_gltf_container":
      return t("diagnostics.invalid_gltf_container");
    case "invalid_json_shape":
      return t("diagnostics.invalid_json_shape");
    case "json_too_large":
      return t("diagnostics.json_too_large");
    case "malformed_json":
      return t("diagnostics.malformed_json");
    case "missing_descriptor_file":
      return t("diagnostics.missing_descriptor_file");
    case "missing_vrm_extension":
      return t("diagnostics.missing_vrm_extension");
    case "nested_descriptor":
      return t("diagnostics.nested_descriptor");
    case "pocket_clone_file_size":
      return t("diagnostics.pocket_clone_file_size");
    case "provenance_missing":
      return t("diagnostics.provenance_missing");
    case "special_file_rejected":
      return t("diagnostics.special_file_rejected");
    case "svg_size_limit":
      return t("diagnostics.svg_size_limit");
    case "symlink_rejected":
      return t("diagnostics.symlink_rejected");
    case "too_many_files":
      return t("diagnostics.too_many_files");
    case "unreadable_file":
      return t("diagnostics.unreadable_file");
    case "unreadable_path":
      return t("diagnostics.unreadable_path");
    case "unsafe_descriptor_path":
      return t("diagnostics.unsafe_descriptor_path");
    case "unsupported_extension":
      return t("diagnostics.unsupported_extension");
    default:
      return null;
  }
}

/**
 * Text for one scan diagnostic. Known codes are worded from the catalog; an
 * unworded code follows `uncodedErrorText`: the backend's English in English,
 * otherwise a translated generic message with the English as `detail`.
 */
export function contentDiagnosticText(
  t: TFunction<"contentHealth">,
  diagnostic: Pick<PyContentDiagnostic, "code" | "message">,
): ApiErrorText {
  const worded = diagnosticWording(t, diagnostic.code);
  if (worded) return { message: worded, detail: null };
  return uncodedErrorText(
    diagnostic.message.trim() || null,
    t("itemStatus.invalid"),
  );
}

/** Stay quiet during normal scans; expose recoverable catalog problems on demand. */
export function ContentHealth({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const { t } = useTranslation("contentHealth");
  const catalog = useContentCatalog();
  const rescan = useRescanContent();
  const { data: capabilities } = useRuntimeCapabilities();
  const canScan = capabilities?.local_filesystem_administration === true;
  const affected = (catalog.data?.items ?? []).filter(
    (item) => item.status !== "valid",
  );
  const needsAttention =
    catalog.isError || affected.length > 0 || catalog.data?.scan_required;

  // Background polling is not an error or a reason to show a permanent control.
  if (!needsAttention) return null;

  const label = catalog.isError
    ? t("status.unavailable")
    : t("status.attention");
  const Icon = catalog.isError ? WifiOff : AlertTriangle;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={label}
          title={label}
          className={cn("text-warning", compact && "size-6", className)}
        >
          <Icon className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        className="w-80 space-y-3 text-sm"
      >
        <p className="font-medium">{label}</p>
        {catalog.isError ? <p>{t("loadFailed")}</p> : null}
        {affected.length ? (
          <ul className="max-h-64 space-y-3 overflow-y-auto">
            {affected.map((item) => (
              <li key={item.item_id} className="space-y-1">
                <p className="font-medium">{item.display_name}</p>
                {item.diagnostics.length ? (
                  item.diagnostics.map((diagnostic, index) => {
                    const text = contentDiagnosticText(t, diagnostic);
                    return (
                      <div
                        key={`${diagnostic.code}:${index}`}
                        className="text-muted-foreground text-xs"
                      >
                        <p>{text.message}</p>
                        {text.detail ? (
                          <p lang={SOURCE_LOCALE}>{text.detail}</p>
                        ) : null}
                        <p className="font-mono break-all">
                          {diagnostic.code}
                          {diagnostic.relative_path
                            ? ` · ${diagnostic.relative_path}`
                            : ""}
                        </p>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-muted-foreground text-xs">
                    {item.status === "missing"
                      ? t("itemStatus.missing")
                      : item.status === "scan_required"
                        ? t("itemStatus.scanRequired")
                        : t("itemStatus.invalid")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : catalog.data?.scan_required ? (
          <p>
            {canScan ? t("scanRequired.local") : t("scanRequired.operator")}
          </p>
        ) : null}
        {rescan.isError ? (
          <p role="alert" className="text-destructive">
            {t("scanFailed")}
          </p>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={canScan ? rescan.isPending : catalog.isFetching}
          onClick={() => {
            if (canScan) rescan.mutate();
            else void catalog.refetch();
          }}
        >
          {canScan && rescan.isPending ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : null}
          {canScan
            ? rescan.isPending
              ? t("actions.scanning")
              : t("actions.retryScan")
            : t("actions.retryLibrary")}
        </Button>
        {!canScan ? (
          <p className="text-muted-foreground text-xs">
            {t("operatorManaged")}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
