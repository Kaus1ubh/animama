import type {
  PyAnimaListItem,
  PyAnimaResponse,
} from "@animama/runtime-contracts/api-types";
import { compareDisplayText } from "../i18n/format";

type AnimaProfileLike = PyAnimaResponse | PyAnimaListItem;

function parseDate(value: string | null | undefined): number {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

/** A live name belongs to the Anima, never to its replaceable Avatar. */
export function getAnimaDisplayName(anima?: AnimaProfileLike | null): string {
  const displayName = anima?.display_name?.trim();
  if (displayName) return displayName;
  if ("presentation" in (anima ?? {})) {
    const presentationName = (
      anima as PyAnimaListItem
    ).presentation.display_name.trim();
    if (presentationName) return presentationName;
  }
  return anima?.id ?? "Anima";
}

export function getAnimaInitials(label: string): string {
  const normalized = label.trim();
  if (!normalized) return "P";
  return normalized.slice(0, 2).toUpperCase();
}

export function sortAnimasByRecent(
  animas: PyAnimaListItem[],
): PyAnimaListItem[] {
  return [...animas].sort((left, right) => {
    const leftUpdated = parseDate(left.updated_at);
    const rightUpdated = parseDate(right.updated_at);
    if (leftUpdated !== rightUpdated) return rightUpdated - leftUpdated;

    const leftCreated = parseDate(left.created_at);
    const rightCreated = parseDate(right.created_at);
    if (leftCreated !== rightCreated) return rightCreated - leftCreated;

    return compareDisplayText(
      getAnimaDisplayName(left),
      getAnimaDisplayName(right),
    );
  });
}
