import { expect, test } from "../fixtures/animama";

test("accountless Library smoke @smoke @read-only", async ({
  page,
  animamaEvidence,
}) => {
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
    await animamaEvidence.attachJson("accountless-library-checkpoint", {
      path: new URL(page.url()).pathname,
      heading: "Library",
      accountless: true,
      mutationPerformed: false,
    });
  });
});
