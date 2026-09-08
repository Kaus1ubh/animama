import type { Avatar } from "./Avatar";

export function clampAvatarExpressionValue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function formatAvatarExpressionValue(
  value: number | null | undefined,
): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return clampAvatarExpressionValue(value).toFixed(2);
}

export function buildAvatarExpressionDraftKey(
  scope: string,
  expressionName: string,
): string {
  return `${scope}::${expressionName}`;
}

export function readAvailableAvatarExpressions(
  avatar: Avatar | null,
): string[] {
  if (!avatar) return [];
  try {
    return avatar.getAvailableExpressions();
  } catch {
    return [];
  }
}

export function readAvatarExpressionValue(
  avatar: Avatar | null,
  name: string,
): number {
  if (!avatar) return 0;
  try {
    return clampAvatarExpressionValue(avatar.getExpressionValue(name));
  } catch {
    return 0;
  }
}

export function readAvatarExpressionOverrideValue(
  avatar: Avatar | null,
  name: string,
): number | null {
  if (!avatar) return null;
  try {
    const value = avatar.getExpressionOverrideValue(name);
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    return clampAvatarExpressionValue(value);
  } catch {
    return null;
  }
}
