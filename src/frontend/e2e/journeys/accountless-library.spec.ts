import { expect, test } from "../fixtures/animama";
import { attachPlaybackCheckpoint } from "../helpers/checkpoints";
import { provePoseClipPlayback } from "../helpers/playback-assertions";
import {
  PreviewNetworkRecorder,
  ReadOnlyJourneyGuard,
} from "../helpers/preview-network";
import { openLibraryPreview } from "../helpers/preview-surfaces";

test("accountless Library smoke @smoke @read-only", async ({
  page,
  animamaEvidence,
}) => {
  const apiRequests: Array<{ url: string; authorization?: string }> = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/v1/")) {
      apiRequests.push({
        url: request.url(),
        authorization: request.headers()["authorization"],
      });
    }
  });
  const apiErrors: string[] = [];
  page.on("response", (response) => {
    if (
      new URL(response.url()).pathname.startsWith("/v1/") &&
      response.status() >= 400
    ) {
      apiErrors.push(
        `${response.status()} ${new URL(response.url()).pathname}`,
      );
    }
  });
  const avatarCatalogResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/v1/avatar-catalog",
  );
  const response = await test.step("Open the Library route", async () => {
    return page.goto("/library", {
      waitUntil: "domcontentloaded",
    });
  });

  await test.step("Assert the accountless Library is visible", async () => {
    expect(response?.ok()).toBe(true);
    await expect(page).toHaveURL(/\/library(?:[/?#]|$)/);
    await expect(
      page.getByRole("heading", { name: "Library", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Sign in to your account" }),
    ).toHaveCount(0);
    // Heading visibility alone can precede the catalog and leave every list loading.
    const catalog = await avatarCatalogResponse;
    expect(catalog.ok()).toBe(true);
    const avatar = page.getByRole("article", { name: "Annie", exact: true });
    await expect(avatar).toBeVisible();
    await expect(
      avatar.getByRole("button", { name: "Preview", exact: true }),
    ).toBeEnabled();
    await expect(
      avatar.getByRole("link", { name: "Use Avatar", exact: true }),
    ).toBeVisible();
    expect(apiErrors).toEqual([]);
    expect(apiRequests.length).toBeGreaterThan(0);
    for (const request of apiRequests) {
      expect(new URL(request.url).origin).toBe(new URL(page.url()).origin);
      expect(request.authorization).toBeUndefined();
    }
    await animamaEvidence.attachBuffer(
      "accountless-library",
      await page.screenshot(),
      "image/png",
    );
    await animamaEvidence.attachJson("accountless-library-checkpoint", {
      path: new URL(page.url()).pathname,
      heading: "Library",
      accountless: true,
      mutationPerformed: false,
    });
  });
});

test("accountless built-in pose playback @surface-library @channel-pose-clip @read-only", async ({
  page,
  animamaEvidence,
}) => {
  const name = "accountless-shy-finger-poke";
  const network = new PreviewNetworkRecorder(page);
  const readOnly = new ReadOnlyJourneyGuard(page);
  const blockedMethods: string[] = [];
  // Preview preparation is the only permitted POST. In particular, navigating
  // this journey must not select an Anima by writing remembered settings.
  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    const preview =
      request.method() === "POST" &&
      /^\/v1\/gestures\/[^/]+:preview$/.test(new URL(request.url()).pathname);
    if (["GET", "HEAD", "OPTIONS"].includes(request.method()) || preview) {
      await route.continue();
    } else {
      blockedMethods.push(request.method());
      await route.abort("blockedbyclient");
    }
  });
  try {
    await page.goto("/library", { waitUntil: "domcontentloaded" });
    const surface = await openLibraryPreview({
      page,
      contentName: "shy-finger-poke",
      section: "gesture",
      selectAnnie: false,
    });
    await expect(surface.locator("canvas")).toBeVisible();
    const samples = await provePoseClipPlayback({
      evidence: animamaEvidence,
      evidenceName: name,
      expectedTarget: { kind: "anima_pose_clip", runtimeId: "shy-finger-poke" },
      expectedAvatarEffects: ["eye_vv_pair"],
      expectedEventIds: [
        "scene-kawaii-sparkles",
        "avatar-eye-vv-pair",
        "scene-focus-light-streak",
      ],
      // The 0.35-second light-streak event must fire, but this pose-motion
      // journey does not require a polling sample inside that brief effect.
      expectedSceneEffects: ["kawaii-sparkles"],
      maxMissingBones: 1,
      surface,
    });
    await network.waitForPreview("shy-finger-poke");
    await network.requireResources([
      "eye_vv.png",
      "emoji-sparkles-2728.svg",
      "emoji-sparkling-heart-1f496.svg",
    ]);
    await network.attach(animamaEvidence, `${name}-preview-network`);
    await attachPlaybackCheckpoint({
      evidence: animamaEvidence,
      locator: surface,
      name,
      samples,
    });
    await readOnly.assertNoMutations(animamaEvidence);
    await animamaEvidence.attachJson(`${name}-request-policy`, {
      blockedMethods,
    });
    expect(blockedMethods).toEqual([]);
  } finally {
    await network.dispose();
    await readOnly.dispose();
  }
});
