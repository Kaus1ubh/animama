import type { AvatarVFXCatalogEntry } from "@/lib/avatar";

export function formatDateTime(value: number | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

export function formatBytes(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "-";
  }
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const digits = size >= 100 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(digits)} ${units[unitIndex]}`;
}

export function formatInteger(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return value.toLocaleString();
}

export function formatMaybeText(value: string | null | undefined): string {
  if (!value) return "-";
  const trimmed = value.trim();
  return trimmed || "-";
}

export function formatVector3(
  value: { x: number; y: number; z: number } | null,
): string {
  if (!value) return "-";
  return `${value.x.toFixed(4)}, ${value.y.toFixed(4)}, ${value.z.toFixed(4)}`;
}

export function formatBoxCoord(
  value: { u: number; v: number; w: number } | null,
): string {
  if (!value) return "-";
  return `${value.u.toFixed(4)}, ${value.v.toFixed(4)}, ${value.w.toFixed(4)}`;
}

export function formatSceneVFXDuration(
  value: number | null | undefined,
): string {
  if (value === null) return "Sticky";
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `${Math.max(0, Math.round(value))} ms`;
}

export function formatJsonValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function hasCustomTransformOffset(
  effect: AvatarVFXCatalogEntry,
): boolean {
  return (
    effect.transform.offset.x !== 0 ||
    effect.transform.offset.y !== 0 ||
    effect.transform.offset.z !== 0
  );
}

export function hasCustomTransformScale(
  effect: AvatarVFXCatalogEntry,
): boolean {
  return (
    effect.transform.scale.x !== 1 ||
    effect.transform.scale.y !== 1 ||
    effect.transform.scale.z !== 1
  );
}
