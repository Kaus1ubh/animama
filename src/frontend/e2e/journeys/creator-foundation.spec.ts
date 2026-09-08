import { test, expect } from "../fixtures/animama";
import {
  openCreatorStage,
  type CreatorKind,
} from "../helpers/creator-surfaces";
import { CreatorMutationGuard } from "../helpers/preview-network";
import { selectAnnieFromSidebar } from "../helpers/preview-surfaces";

const CASES: Array<{ creator: CreatorKind; key: string }> = [
  { creator: "Gesture", key: "creator-foundation-gesture" },
  { creator: "Reaction", key: "creator-foundation-reaction" },
  { creator: "Particle VFX", key: "creator-foundation-particle-vfx" },
  { creator: "Avatar VFX", key: "creator-foundation-avatar-vfx" },
  { creator: "Scene VFX", key: "creator-foundation-scene-vfx" },
];

test.describe("creator route foundation", () => {
  for (const journey of CASES) {
    test(`${journey.key} @creator-foundation @surface-creator @read-only`, async ({
      animamaEvidence,
      creatorContent,
      page,
    }) => {
      const catalogBefore =
        await test.step("snapshot the neutral Local catalog", () =>
          creatorContent.snapshotLocalCatalog());
      await test.step("select the unique Annie sidebar Anima", () =>
        selectAnnieFromSidebar(page));

      const apiUrl = process.env.ANIMAMA_E2E_API_URL;
      if (!apiUrl) {
        throw new Error("ANIMAMA_E2E_API_URL is required for creator guards.");
      }
      const mutationGuard = await CreatorMutationGuard.attach(page, apiUrl);
      try {
        const stage =
          await test.step(`open the ${journey.creator} creator through visible links`, () =>
            openCreatorStage({
              creator: journey.creator,
              page,
              selectAnnie: false,
            }));
        await test.step("prove one valid creator-stage observation", async () => {
          expect(stage.observation.surface).toBe("creator-stage");
          expect(stage.observation.target.runtimeId).not.toBe("");
          expect(["ready", "playing", "stopped"]).toContain(
            stage.observation.target.status,
          );
          await animamaEvidence.attachJson(
            `${journey.key}-observation`,
            stage.observation,
          );
          await animamaEvidence.attachBuffer(
            `${journey.key}-creator-stage`,
            await stage.surface.screenshot({ animations: "allow" }),
            "image/png",
          );
        });
      } finally {
        try {
          await mutationGuard.assertPolicy(animamaEvidence);
        } finally {
          await mutationGuard.dispose();
          await creatorContent.assertLocalCatalogUnchanged(
            catalogBefore,
            animamaEvidence,
            journey.key,
          );
        }
      }
    });
  }
});
