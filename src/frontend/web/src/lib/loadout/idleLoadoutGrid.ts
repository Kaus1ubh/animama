import type {
  PyAnimaIdle,
  PyCatalogLoadoutSource,
  PyIdleIntent,
  PyIdleMember,
} from "@animama/runtime-contracts/api-types";
import type { PyGesture } from "@/lib/content/catalogTypes";

/** A Gesture a cell plays because a lower intensity of its emotion holds it. */
export type IdleInheritedMember = {
  member: PyIdleMember;
  intensity: 1 | 2;
};

/** One Idle cell: Default (no emotion) or an emotion at intensity 1–3. */
export type IdleLoadoutCell = {
  key: string;
  emotion: string | null;
  intensity: 1 | 2 | 3 | null;
  gestures: PyIdleMember[];
  /**
   * Gestures this cell also plays from lower intensities of its emotion, once
   * each and never repeating its own; Default is always mixed in as well.
   */
  inherited: IdleInheritedMember[];
};

export type IdleLoadoutRow = {
  emotion: string;
  cells: [IdleLoadoutCell, IdleLoadoutCell, IdleLoadoutCell];
  /** Gestures across the emotion's three cells, for the collapsed summary. */
  gestureCount: number;
};

export type IdleLoadoutGrid = {
  defaultCell: IdleLoadoutCell;
  rows: IdleLoadoutRow[];
};

const INTENSITIES = [1, 2, 3] as const;

/** Arrange the server's Idle pool as a Default row plus alphabetical emotion rows. */
export function buildIdleLoadoutGrid(idle: PyAnimaIdle): IdleLoadoutGrid {
  const byCell = new Map(
    (idle.cells ?? []).map((cell) => [
      `${cell.emotion}-${cell.intensity}`,
      cell.gestures ?? [],
    ]),
  );
  const emotions = [
    ...new Set((idle.cells ?? []).map((cell) => cell.emotion)),
  ].sort((left, right) => left.localeCompare(right));
  return {
    defaultCell: {
      key: "default",
      emotion: null,
      intensity: null,
      gestures: idle.default_pool ?? [],
      inherited: [],
    },
    rows: emotions.map((emotion) => {
      const lower: IdleInheritedMember[] = [];
      const cells = INTENSITIES.map((intensity) => {
        const gestures = byCell.get(`${emotion}-${intensity}`) ?? [];
        const own = new Set(gestures.map((member) => member.item_id));
        const inherited = lower.filter(
          ({ member }) => !own.has(member.item_id),
        );
        for (const member of gestures)
          if (
            intensity < 3 &&
            !lower.some((entry) => entry.member.item_id === member.item_id)
          )
            lower.push({ member, intensity: intensity as 1 | 2 });
        return {
          key: `${emotion}-${intensity}`,
          emotion,
          intensity,
          gestures,
          inherited,
        };
      }) as IdleLoadoutRow["cells"];
      return {
        emotion,
        cells,
        gestureCount: cells.reduce(
          (count, cell) => count + cell.gestures.length,
          0,
        ),
      };
    }),
  };
}

/** Ready Gestures a cell can add: not already in it or inherited, Local first. */
export function idleGestureChoices(
  available: PyGesture[],
  cell: IdleLoadoutCell,
): { local: PyGesture[]; included: PyGesture[] } {
  const members = new Set(
    [...cell.gestures, ...cell.inherited.map((entry) => entry.member)].map(
      (member) => member.item_id,
    ),
  );
  const choices = available.filter(
    (gesture) =>
      gesture.state === "ready" &&
      gesture.source &&
      !members.has(gesture.item_id),
  );
  return {
    local: choices.filter((gesture) => gesture.origin === "owned"),
    included: choices.filter((gesture) => gesture.origin === "builtin"),
  };
}

/** The intent adding a Gesture to a cell; Default carries no emotion or intensity. */
export function idleAddIntent(
  cell: IdleLoadoutCell,
  source: PyCatalogLoadoutSource,
): PyIdleIntent {
  return cell.emotion && cell.intensity
    ? {
        operation: "add",
        emotion: cell.emotion,
        intensity: cell.intensity,
        source,
      }
    : { operation: "add", source };
}
