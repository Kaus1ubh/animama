import "@fontsource-variable/dm-sans";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppProviders } from "./app/providers/AppProviders";
import { AppRouter } from "./app/router";
import { initialLocale } from "./i18n/locale-preference";
import { createWebI18n } from "./i18n/web-i18n";
import { createHostedComposition } from "./app/hosted-runtime/hosted-composition";
import { RuntimeController } from "./app/runtime/runtime-controller";
import { installBrowserSessionResources } from "./app/runtime/browser-session-resources";
import "./index.css";

const composition = createHostedComposition({
  baseUrl: window.location.origin,
  fetch: window.fetch.bind(window),
  navigate: (url) => window.location.assign(url),
});
// Install authority before any component, SDK query, byte load or stream can dispatch.
window.fetch = composition.browserFetch;
const controller = new RuntimeController(composition);
installBrowserSessionResources(window, () => controller.getSnapshot().scope);
// Text renders in the first-paint locale; App settings may switch it once loaded.
void createWebI18n(initialLocale()).then((i18n) => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <AppProviders controller={controller} i18n={i18n}>
        <AppRouter />
      </AppProviders>
    </StrictMode>,
  );
});
