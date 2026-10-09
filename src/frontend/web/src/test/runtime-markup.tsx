import type { ReactNode } from "react";
import {
  renderToStaticMarkup as staticMarkup,
  renderToString as stringMarkup,
} from "react-dom/server";
import { ProductRuntimeProvider } from "@animama/product-ui";

/** Wraps a feature fixture in the explicit API boundary the application provides. */
export function withRuntime(node: ReactNode) {
  return (
    <ProductRuntimeProvider
      owner={{ id: "owner" }}
      capabilities={{ chat: true }}
      transport={{
        baseUrl: "http://runtime.fixture.test",
        fetch: () =>
          Promise.reject(new Error("Unexpected fixture network request")),
      }}
    >
      {node}
    </ProductRuntimeProvider>
  );
}

/** Isolated feature fixtures receive the same explicit API boundary as the application. */
export function renderToStaticMarkup(node: ReactNode): string {
  return staticMarkup(withRuntime(node));
}
export function renderToString(node: ReactNode): string {
  return stringMarkup(withRuntime(node));
}
