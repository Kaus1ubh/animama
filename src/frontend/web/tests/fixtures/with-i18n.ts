import { createWebI18n } from "@/i18n/web-i18n";

/**
 * Load a fixture once English i18n exists, as the app's entry files do, so
 * code that runs while its modules load can translate. Fixtures render in
 * English, like the browser journeys.
 */
export async function loadFixtureWithI18n(
  load: () => Promise<unknown>,
): Promise<void> {
  await createWebI18n("en");
  await load();
}
