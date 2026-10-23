import { renderToString } from "@/test/runtime-markup";
import { describe, expect, it, vi } from "vitest";

import { AnimaLoadout } from "./AnimaLoadout";

const fixtures = vi.hoisted(() => ({
  loadout: {
    anima_id: "anima-1",
    revision: 1,
    starter_version: 1,
    warnings: [],
    gestures: [],
    reactions: [],
    idle: { default_pool: [], cells: [] },
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

vi.mock("@/query/mutations/useAnimaLoadoutMutations", () => ({
  useAnimaLoadoutMutations: () => ({
    planGesture: { mutateAsync: vi.fn() },
    commitGesture: { mutateAsync: vi.fn(), isPending: false },
    changeIdle: { mutateAsync: vi.fn(), isPending: false },
    changeReaction: { mutateAsync: vi.fn(), isPending: false },
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
    expect(html).toContain(">Idle<");
    expect(html).not.toContain("Idle Style");
    expect(html).not.toContain(">Music<");
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(4);
    expect(html).toContain('aria-controls="voice-loadout-content"');
    expect(html).toContain('aria-controls="gesture-loadout-content"');
    expect(html).toContain('aria-controls="reaction-loadout-content"');
    expect(html).toContain('aria-controls="idle-loadout-content"');
    expect(html).not.toContain('aria-controls="music-content"');

    expect(html).not.toContain("Avatar Release");
    expect(html).not.toContain("Pose Clip");
    expect(html).not.toContain(">VFX<");
    expect(html).not.toContain(">SFX<");
  });
});
