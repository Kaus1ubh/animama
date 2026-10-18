import "@/index.css";

import { createWebI18n } from "@/i18n/web-i18n";

// The page embeds Action creator controls whose modules read translations
// as they load, so the page's modules load only once i18n exists (as the
// app's own entry does).
void createWebI18n("en").then(async () => {
  const { mountTunePage } = await import("./tune");
  mountTunePage(document.getElementById("root")!);
});
