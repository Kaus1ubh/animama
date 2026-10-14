// Vitest setup: render every test in English through the application's catalogs.
import { createWebI18n } from "@/i18n/web-i18n";

await createWebI18n("en");
