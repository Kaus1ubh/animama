import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { AppProviders } from "@web/app/providers/AppProviders";
import { AppRouter } from "@web/app/router";
import { installLocalGatewayFetchInterceptor } from "@web/lib/local-gateway/fetch-interceptor";
import "./index.css";

installLocalGatewayFetchInterceptor();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProviders>
      <AppRouter />
    </AppProviders>
  </StrictMode>,
);
