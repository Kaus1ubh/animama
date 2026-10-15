import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AnimaCreationSources } from "@/query/hooks/useAnimaCreation";
import { CreateAnimaReviewStep } from "./CreateAnimaReviewStep";
import { buildAnimaSpec, setReactionPool } from "./createAnimaDraft";
import { readyDraft, ref } from "./createAnimaTestFixtures";

vi.mock("@/query/hooks/useVoiceClones", () => ({
  useVoiceClones: () => ({ data: [] }),
}));

describe("final Anima review", () => {
  it.each([true, false])(
    "shows exact normalized identity, counts, and warnings (valid=%s)",
    (valid) => {
      const draft = readyDraft();
      const html = renderToStaticMarkup(
        <CreateAnimaReviewStep
          draft={draft}
          sources={{ avatars: { data: [] } } as unknown as AnimaCreationSources}
          spec={valid ? buildAnimaSpec(draft) : null}
          warnings={[
            {
              code: "empty",
              path: "/reactions",
              message: "All Reaction cells are empty.",
            },
            {
              code: "profile_portrait_unavailable",
              path: "/appearance/profile",
              message: "No profile portrait was selected.",
            },
          ]}
          busy={false}
          onEdit={vi.fn()}
        />,
      );
      expect(html).toContain("Rowan 🌿");
      expect(html).toContain("PocketTTS · Eve");
      expect(html).toContain("Edit Voice");
      expect(html).toContain("A curious companion");
      expect(html).not.toContain("Read the complete identity");
      expect(html).not.toContain("max-h-80");
      expect(html).toContain("All Reaction cells are empty.");
      expect(html).not.toContain("Edit Avatar");
      expect(html).not.toContain("Uses application appearance defaults");
      expect(html).not.toContain("No profile portrait was selected.");
      expect(html).not.toMatch(/Profile crop|Background crop|profile picture/);
      expect(html).not.toContain("Ready-to-chat defaults");
      expect(html).not.toContain("gJx1vCzNCD1EQHT212Ls");
      expect(html).not.toContain("Recommended Starter Pack · version");
      expect(html).not.toContain("Source revision details");
      expect(html).not.toContain("Preview selected Actions");
      expect(html).not.toContain("Ready to create");
      expect(html).not.toContain("Recheck sources");
      expect(html).not.toMatch(/Save as Blueprint|Publish Anima|Voice clone/);
    },
  );

  it("counts filled Reaction cells and the Reactions in their pools", () => {
    const draft = readyDraft();
    draft.reactions = setReactionPool(draft, "joy", "2", [
      ref("cheer"),
      ref("grin"),
    ]);
    draft.reactions = setReactionPool(draft, "anger", "4", [ref("cheer")]);
    const html = renderToStaticMarkup(
      <CreateAnimaReviewStep
        draft={draft}
        sources={{ avatars: { data: [] } } as unknown as AnimaCreationSources}
        spec={null}
        warnings={[]}
        busy={false}
        onEdit={vi.fn()}
      />,
    );
    // Two of 96 cells hold Reactions; a Reaction counts once per cell it is in.
    expect(html).toMatch(/>2 <span[^>]*>\/ 96<\/span>/);
    expect(html).toContain("Reaction cells assigned");
    expect(html).toContain("3 Reactions across all cells");
  });
});
