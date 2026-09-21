import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseAnimaPoseClip } from "@/lib/avatar";
import { usePoseCreatorStore } from "@/stores/pose-creator-store";
import { createActionDocument } from "./actionDocument";
import { ActionTimelineDocumentSync } from "./ActionTimelineEditor";

const effects = vi.hoisted(() => [] as Array<() => void | (() => void)>);

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useEffect: (effect: () => void | (() => void)) => effects.push(effect),
}));

// Read the live client store while collecting the component's actual effect
// closures with SSR; no DOM or WebGL is needed to exercise the replay boundary.
vi.mock("@/stores/pose-creator-store", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/stores/pose-creator-store")>();
  return {
    ...actual,
    usePoseCreatorStore: Object.assign(
      (
        selector: (
          state: ReturnType<typeof actual.usePoseCreatorStore.getState>,
        ) => unknown,
      ) => selector(actual.usePoseCreatorStore.getState()),
      actual.usePoseCreatorStore,
    ),
  };
});

beforeEach(() => {
  effects.length = 0;
  usePoseCreatorStore.getState().resetWorkspace();
});

describe("ActionTimelineDocumentSync route handoff", () => {
  it.each(["gesture", "reaction"] as const)(
    "does not emit the previous creator's expression into a new %s on StrictMode effect replay",
    (intent) => {
      usePoseCreatorStore.getState().hydrateClipDocument(
        parseAnimaPoseClip({
          schema: "animaPoseClip/1.0",
          id: "previous-reaction",
          name: "Previous Reaction",
          duration: 1,
          poses: { expression: { expressions: { happy: 1 } } },
          poseKeyframes: [{ time: 0, pose: "expression" }],
        }),
      );
      const onChange = vi.fn();
      renderToString(
        <ActionTimelineDocumentSync
          sequence={createActionDocument(intent).sequence}
          session={0}
          reaction={intent === "reaction"}
          onChange={onChange}
        />,
      );

      // StrictMode replays setup with the same render closures, even though the
      // first hydration has already replaced the retained Zustand timeline.
      const cleanups = effects.map((setup) => setup());
      cleanups.forEach((cleanup) => cleanup?.());
      effects.forEach((setup) => setup());

      expect(usePoseCreatorStore.getState().clipDraft.keyframes).toEqual([]);
      expect(onChange).not.toHaveBeenCalled();
    },
  );
});
