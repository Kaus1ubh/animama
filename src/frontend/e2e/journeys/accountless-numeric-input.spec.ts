import { expect, test } from "../fixtures/animama";
import { openCreatorStage } from "../helpers/creator-surfaces";
import { ReadOnlyJourneyGuard } from "../helpers/preview-network";

test.use({ viewport: { width: 1600, height: 1000 } });

/** Optional native numbers must preserve deliberate clearing and domain clamping. */
test("accountless optional SFX volume preserves empty values and canonical bounds", async ({
  page,
  creatorContent,
  animamaEvidence,
}) => {
  const catalogBefore = await creatorContent.snapshotLocalCatalog();
  const guard = new ReadOnlyJourneyGuard(page);
  const observations: Array<{ phase: string; volume?: number }> = [];
  const readEvent = async (phase: string) => {
    await page.getByRole("button", { name: "View JSON", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: "Creator JSON",
      exact: true,
    });
    const document = JSON.parse(
      await dialog.getByLabel("Creator JSON preview").inputValue(),
    );
    const event = document.events.find(
      (item: { id: string }) => item.id === "volume-check",
    ) as { volume?: number };
    expect(event).toBeDefined();
    observations.push({
      phase,
      ...("volume" in event ? { volume: event.volume } : {}),
    });
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    return event;
  };
  try {
    await openCreatorStage({ creator: "Reaction", page });
    await page.getByRole("button", { name: "Import", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Import", exact: true });
    await dialog.getByLabel("Creator JSON import").fill(
      JSON.stringify({
        schema: "animaPoseClip/1.0",
        id: "optional-number-check",
        name: "Optional number check",
        duration: 2,
        poses: { neutral: { expressions: { happy: 0 } } },
        poseKeyframes: [{ time: 0, pose: "neutral" }],
        events: [
          {
            id: "volume-check",
            kind: "sfx",
            time: 0.5,
            cueId: "numeric-check",
            volume: 0.6,
          },
        ],
      }),
    );
    await dialog
      .getByRole("button", { name: "Import pasted JSON", exact: true })
      .click();
    await expect(
      dialog.getByText(
        "Anima Pose Clip imported. Map any unresolved effects or sounds below.",
        { exact: true },
      ),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await page
      .getByRole("button", { name: /SFX \/ volume-check \/ numeric-check/ })
      .click();
    const volume = page.getByRole("spinbutton", {
      name: "SFX event volume",
      exact: true,
    });
    await expect(volume).toHaveValue("0.6");
    await expect(volume).toHaveAttribute("min", "0");
    await expect(volume).toHaveAttribute("max", "1");
    await expect(volume).toHaveAttribute("step", "0.05");

    await volume.fill("");
    await expect(volume).toHaveValue("");
    await volume.press("Tab");
    await expect(volume).toHaveValue("");
    expect(await readEvent("cleared")).not.toHaveProperty("volume");

    await volume.fill("0.75");
    await volume.press("Enter");
    expect(await readEvent("valid")).toHaveProperty("volume", 0.75);

    // Replacing selected text with a minus goes straight to badInput, rather
    // than first emitting a deliberate empty edit from fill("").
    await volume.focus();
    await volume.press("ControlOrMeta+A");
    await volume.press("-");
    await expect(volume).toHaveValue("");
    await volume.press("Tab");
    await expect(volume).toHaveValue("0.75");
    expect(await readEvent("incomplete-minus-restored")).toHaveProperty(
      "volume",
      0.75,
    );

    await volume.fill("2");
    await volume.press("Tab");
    await expect(volume).toHaveValue("1");
    expect(await readEvent("upper-bound")).toHaveProperty("volume", 1);
    await volume.fill("-1");
    await volume.press("Tab");
    await expect(volume).toHaveValue("0");
    expect(await readEvent("lower-bound")).toHaveProperty("volume", 0);

    await creatorContent.assertLocalCatalogUnchanged(
      catalogBefore,
      animamaEvidence,
    );
    await animamaEvidence.attachJson("optional-native-number-editing", {
      observations,
      importedUnsaved: true,
      saved: false,
      limitation:
        "Checks numeric authoring only; the unresolved sound is never played.",
    });
    await guard.assertNoMutations(animamaEvidence);
  } finally {
    await guard.dispose();
  }
});
