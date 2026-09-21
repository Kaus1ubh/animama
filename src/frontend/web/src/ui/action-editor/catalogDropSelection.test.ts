import { beforeEach, describe, expect, it } from "vitest";
import { usePoseCreatorStore } from "@/stores/pose-creator-store";
import { selectHydratedCatalogEvent } from "./catalogDropSelection";

beforeEach(() => usePoseCreatorStore.getState().resetClipDraft());

describe("catalog drop selection after hydration", () => {
  const pending = { id: "new-effect", session: 3 };
  const hydrateEvent = () => {
    const state = usePoseCreatorStore.getState();
    usePoseCreatorStore.setState({
      clipPlaybackPlaying: true,
      clipDraft: {
        ...state.clipDraft,
        selectedKeyframeId: "previous-pose",
        events: [
          { id: pending.id, kind: "sfx", time: 0.6, cueId: "bell", volume: 1 },
        ],
      },
    });
  };
  it("waits for the inserted ID then selects it and seeks without editing the document", () => {
    const before = usePoseCreatorStore.getState();
    expect(selectHydratedCatalogEvent(pending, 3, true)).toBe(false);
    expect(usePoseCreatorStore.getState()).toBe(before);
    hydrateEvent();
    const events = usePoseCreatorStore.getState().clipDraft.events;
    expect(selectHydratedCatalogEvent(pending, 3, true)).toBe(true);
    const after = usePoseCreatorStore.getState();
    expect(after.clipDraft.selectedKeyframeId).toBeNull();
    expect(after.clipDraft.selectedEventId).toBe(pending.id);
    expect(after.clipDraft.currentTimeSec).toBe(0.6);
    expect(after.clipPlaybackAbsoluteTimeSec).toBe(0.6);
    expect(after.clipPlaybackPlaying).toBe(false);
    expect(after.clipDraft.events).toBe(events);
  });
  it("ignores events arriving after a document or mode switch", () => {
    hydrateEvent();
    const before = usePoseCreatorStore.getState();
    expect(selectHydratedCatalogEvent(pending, 4, true)).toBe(false);
    expect(selectHydratedCatalogEvent(pending, 3, false)).toBe(false);
    expect(selectHydratedCatalogEvent(null, 3, true)).toBe(false);
    expect(usePoseCreatorStore.getState()).toBe(before);
  });
});
