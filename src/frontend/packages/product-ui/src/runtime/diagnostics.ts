import { createContext, useContext, useMemo } from "react";

/** Optional host diagnostics; shared product code never selects a telemetry sink. */
export type ProductLogger = {
  debug: (
    scope: string,
    message: string,
    data?: Record<string, unknown>,
  ) => void;
  info: (
    scope: string,
    message: string,
    data?: Record<string, unknown>,
  ) => void;
  warn: (
    scope: string,
    message: string,
    data?: Record<string, unknown>,
  ) => void;
  error: (scope: string, message: string, data?: unknown) => void;
};

type Attributes = Record<string, string | number | boolean>;
export type ProductDiagnostics = {
  createLogger: (name: string) => ProductLogger;
  recordSseStart: (attributes: Attributes) => void;
  recordSseToken: (attributes: Attributes) => void;
  recordSseError: (attributes: Attributes) => void;
  recordSseDuration: (durationMs: number, attributes: Attributes) => void;
  recordUiInteraction: (attributes: Attributes) => void;
  recordUiInteractionDuration: (
    durationMs: number,
    attributes: Attributes,
  ) => void;
};

const ignore = () => undefined;
const silentLogger: ProductLogger = {
  debug: ignore,
  info: ignore,
  warn: ignore,
  error: ignore,
};
export const silentProductDiagnostics: ProductDiagnostics = {
  createLogger: () => silentLogger,
  recordSseStart: ignore,
  recordSseToken: ignore,
  recordSseError: ignore,
  recordSseDuration: ignore,
  recordUiInteraction: ignore,
  recordUiInteractionDuration: ignore,
};
export const ProductDiagnosticsContext = createContext(
  silentProductDiagnostics,
);

export function useProductDiagnostics(): ProductDiagnostics {
  return useContext(ProductDiagnosticsContext);
}

export function useProductLogger(name: string): ProductLogger {
  const diagnostics = useProductDiagnostics();
  return useMemo(() => diagnostics.createLogger(name), [diagnostics, name]);
}
