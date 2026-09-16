import { test, expect } from "../fixtures/animama";

/** First run is installation state; no account or browser authentication state exists. */
test("complete accountless first-run setup on the isolated installation", async ({
  page,
  animamaEvidence,
}) => {
  await page.goto("/");
  await page.waitForURL(
    (url) => url.pathname === "/setup" || url.pathname.startsWith("/a"),
  );
  const firstRunPerformed = new URL(page.url()).pathname === "/setup";
  if (firstRunPerformed) {
    await expect(
      page.getByRole("heading", { name: "What should Animama call you?" }),
    ).toBeVisible();
    const next = page.getByRole("button", { name: "Continue", exact: true });
    await expect(next).toBeDisabled();
    await page.getByLabel("Display name", { exact: true }).fill("   ");
    await expect(next).toBeDisabled();
    await page
      .getByLabel("Display name", { exact: true })
      .fill("Browser Fixture");
    await next.click();
  }
  await page.waitForURL((url) => url.pathname.startsWith("/a"));
  await expect(
    page.getByRole("heading", { name: "Sign in to your account" }),
  ).toHaveCount(0);
  await animamaEvidence.attachJson("installation-setup-mode", {
    firstRunPerformed,
    existingInstallation: !firstRunPerformed,
  });
});
