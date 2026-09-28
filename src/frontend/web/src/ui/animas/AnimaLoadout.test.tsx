import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AnimaLoadout } from "./AnimaLoadout";

const fixtures = vi.hoisted(() => ({
  loadout: {
    anima_id: "anima-1",
    revision: 1,
    starter_version: 1,
    disabled_starter_gestures: [],
    starter_gesture_implementation_kinds: {},
    warnings: [],
    gestures: [],
    reactions: [],
    idle_style: { state: "empty" as const },
  },
}));

vi.mock("@/query/hooks/useAnimaLoadout", () => ({
  useAnimaLoadout: () => ({
    data: fixtures.loadout,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/query/hooks/useAnimaRuntimeCatalog", () => ({
  useAnimaRuntimeCatalog: () => ({
    data: undefined,
    isPending: false,
    isError: false,
  }),
}));

vi.mock("@/query/hooks/useActions", () => ({
  useGestures: () => ({
    data: { pages: [{ items: [] }] },
    isPending: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  }),
  useReactions: () => ({
    data: { pages: [{ items: [] }] },
    isPending: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  }),
}));

vi.mock("@/query/hooks/useIdleStyles", () => ({
  useIdleStyles: () => ({
    data: { pages: [{ items: [] }] },
    isPending: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  }),
}));

vi.mock("@/query/mutations/useAnimaLoadoutMutations", () => ({
  useAnimaLoadoutMutations: () => ({
    planGesture: { mutateAsync: vi.fn() },
    commitGesture: { mutateAsync: vi.fn(), isPending: false },
    planReaction: { mutateAsync: vi.fn() },
    commitReaction: { mutateAsync: vi.fn(), isPending: false },
    planIdleStyle: { mutateAsync: vi.fn() },
    commitIdleStyle: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

describe("Anima Loadout", () => {
  it("places Voices before the three content sections behind accessible disclosures", () => {
    const html = renderToString(
      <AnimaLoadout animaId="anima-1" onStagePreview={() => undefined} />,
    );

    expect(html).toContain(">Voices<");
    expect(html.indexOf(">Voices<")).toBeLessThan(html.indexOf(">Gestures<"));
    expect(html).toContain(">Gestures<");
    expect(html).toContain(">Reactions<");
    expect(html).toContain(">Idle Style<");
    expect(html).not.toContain(">Music<");
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(4);
    expect(html).toContain('aria-controls="voice-loadout-content"');
    expect(html).toContain('aria-controls="gesture-loadout-content"');
    expect(html).toContain('aria-controls="reaction-loadout-content"');
    expect(html).toContain('aria-controls="idle-style-content"');
    expect(html).not.toContain('aria-controls="music-content"');

    expect(html).not.toContain("Avatar Release");
    expect(html).not.toContain("Pose Clip");
    expect(html).not.toContain(">VFX<");
    expect(html).not.toContain(">SFX<");
  });
});
