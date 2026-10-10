import "@fontsource-variable/dm-sans";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { AppProviders } from "@web/app/providers/AppProviders";
import { AppRouter } from "@web/app/router";
import { initialLocale } from "@web/i18n/locale-preference";
import { createWebI18n } from "@web/i18n/web-i18n";
import { installLocalGatewayFetchInterceptor } from "@web/lib/local-gateway/fetch-interceptor";
import "./index.css";
import { createLocalComposition } from "./app/local-runtime/local-composition";
import { RuntimeController } from "./app/runtime/runtime-controller";
import { installBrowserSessionResources } from "./app/runtime/browser-session-resources";

installLocalGatewayFetchInterceptor();
const controller = new RuntimeController(createLocalComposition());
installBrowserSessionResources(window, () => controller.getSnapshot().scope);

// Keep development profiling cleanup out of all built application artifacts.
if (__ANIMAMA_DEV_BUILD__) {
  void import("@web/lib/development/reactPerformanceTiming");
}

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
