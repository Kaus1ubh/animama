import { expect, test } from "../fixtures/animama";

test("accountless Library smoke @smoke @read-only", async ({
  page,
  animamaEvidence,
}) => {
  const apiRequests: Array<{ url: string; authorization?: string }> = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/v1/")) {
      apiRequests.push({ url: request.url(), authorization: request.headers()["authorization"] });
    }
  });
  const response = await test.step("Open the Library route", async () => {
    return page.goto("/a/library", {
      waitUntil: "domcontentloaded",
    });
  });

  await test.step("Assert the accountless Library is visible", async () => {
    expect(response?.ok()).toBe(true);
    await expect(page).toHaveURL(/\/a\/library(?:[/?#]|$)/);
    await expect(
      page.getByRole("heading", { name: "Library", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Sign in to your account" }),
    ).toHaveCount(0);
    expect(apiRequests.length).toBeGreaterThan(0);
    for (const request of apiRequests) {
      expect(new URL(request.url).origin).toBe(new URL(page.url()).origin);
      expect(request.authorization).toBeUndefined();
    }
    await animamaEvidence.attachBuffer("accountless-library", await page.screenshot(), "image/png");
    await animamaEvidence.attachJson("accountless-library-checkpoint", {
      path: new URL(page.url()).pathname,
      heading: "Library",
      accountless: true,
      mutationPerformed: false,
    });
  });
});
