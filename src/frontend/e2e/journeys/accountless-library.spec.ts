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
  const apiErrors: string[] = [];
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.startsWith("/v1/") && response.status() >= 400) {
      apiErrors.push(`${response.status()} ${new URL(response.url()).pathname}`);
    }
  });
  const avatarCatalogResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/v1/avatar-catalog",
  );
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
    // Heading visibility alone can precede the catalog and leave every list loading.
    const catalog = await avatarCatalogResponse;
    expect(catalog.ok()).toBe(true);
    const avatar = page.getByRole("article", { name: "Annie", exact: true });
    await expect(avatar).toBeVisible();
    await expect(avatar.getByRole("button", { name: "Preview", exact: true })).toBeEnabled();
    await expect(avatar.getByRole("link", { name: "Use Avatar", exact: true })).toBeVisible();
    expect(apiErrors).toEqual([]);
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
