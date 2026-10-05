import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppProviders } from "./app/providers/AppProviders";
import { AppRouter } from "./app/router";
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
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProviders controller={controller}>
      <AppRouter />
    </AppProviders>
  </StrictMode>,
);
