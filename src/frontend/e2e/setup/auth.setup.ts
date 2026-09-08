import { chmod } from "node:fs/promises";

import { expect, test } from "playwright/test";

function isLoopbackUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname === "::1" ||
      hostname === "[::1]"
    ) {
      return true;
    }
    const parts = hostname.split(".");
    return (
      parts.length === 4 &&
      Number(parts[0]) === 127 &&
      parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
    );
  } catch {
    return false;
  }
}

test("authenticate through the local sign-in UI", async ({ page }) => {
  const email = process.env.ANIMAMA_E2E_EMAIL;
  const password = process.env.ANIMAMA_E2E_PASSWORD;
  const authStatePath = process.env.ANIMAMA_E2E_AUTH_STATE;
  const targetUrls = [
    process.env.ANIMAMA_E2E_WEB_URL,
    process.env.ANIMAMA_E2E_AUTH_URL,
    process.env.ANIMAMA_E2E_API_URL,
  ];

  if (!email || !password || !authStatePath || targetUrls.some((url) => !url)) {
    throw new Error(
      "The E2E runner did not provide complete authentication settings.",
    );
  }
  if (
    process.env.ANIMAMA_E2E_USES_DEFAULT_CREDENTIALS === "1" &&
    !targetUrls.every((url) => isLoopbackUrl(url as string))
  ) {
    throw new Error(
      "Built-in E2E credentials may only be used with loopback URLs.",
    );
  }

  const emailInput = page.getByLabel("Email", { exact: true });
  const passwordInput = page.getByLabel("Password", { exact: true });
  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "Sign in to your account" }),
    ).toBeVisible();
    await emailInput.fill(email);
    await passwordInput.fill(password);
    await page.getByRole("button", { name: /^Sign In$/i }).click();
    await page.waitForURL(
      (url) => url.pathname === "/a" || url.pathname.startsWith("/a/"),
      { timeout: 30_000 },
    );
    await page.context().storageState({ path: authStatePath });
    await chmod(authStatePath, 0o600);
  } catch {
    await emailInput.fill("").catch(() => {});
    await passwordInput.fill("").catch(() => {});
    throw new Error(
      "Local E2E authentication failed. Verify the main stack and the seeded Codex user, then rerun.",
    );
  }
});
