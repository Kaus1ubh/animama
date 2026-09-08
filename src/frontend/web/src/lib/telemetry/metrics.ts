import { metrics, type Counter, type Histogram } from "@opentelemetry/api";

type MetricAttributes = Record<string, string | number | boolean>;

let meterInstance: ReturnType<typeof metrics.getMeter> | null = null;

function getMeter() {
  if (!meterInstance) {
    meterInstance = metrics.getMeter("animama-webui");
  }
  return meterInstance;
}

let uiInteractionCounter: Counter | null = null;
let uiInteractionDuration: Histogram | null = null;

let sseStartCounter: Counter | null = null;
let sseTokenCounter: Counter | null = null;
let sseErrorCounter: Counter | null = null;
let sseDurationHistogram: Histogram | null = null;

function ensureUiMetrics() {
  if (!uiInteractionCounter) {
    uiInteractionCounter = getMeter().createCounter(
      "anima.webui.ui.interactions",
      {
        description: "User interaction count (frontend)",
        unit: "1",
      },
    );
  }
  if (!uiInteractionDuration) {
    uiInteractionDuration = getMeter().createHistogram(
      "anima.webui.ui.interaction.duration",
      {
        description: "User interaction duration",
        unit: "ms",
      },
    );
  }
}

function ensureSseMetrics() {
  if (!sseStartCounter) {
    sseStartCounter = getMeter().createCounter("anima.webui.sse.starts", {
      description: "Chat SSE starts",
      unit: "1",
    });
  }
  if (!sseTokenCounter) {
    sseTokenCounter = getMeter().createCounter("anima.webui.sse.tokens", {
      description: "SSE tokens received",
      unit: "1",
    });
  }
  if (!sseErrorCounter) {
    sseErrorCounter = getMeter().createCounter("anima.webui.sse.errors", {
      description: "SSE stream errors",
      unit: "1",
    });
  }
  if (!sseDurationHistogram) {
    sseDurationHistogram = getMeter().createHistogram(
      "anima.webui.sse.duration",
      {
        description: "SSE stream duration",
        unit: "ms",
      },
    );
  }
}

export function recordUiInteraction(attributes?: MetricAttributes) {
  ensureUiMetrics();
  uiInteractionCounter?.add(1, attributes);
}

export function recordUiInteractionDuration(
  durationMs: number,
  attributes?: MetricAttributes,
) {
  ensureUiMetrics();
  uiInteractionDuration?.record(durationMs, attributes);
}

export function recordSseStart(attributes?: MetricAttributes) {
  ensureSseMetrics();
  sseStartCounter?.add(1, attributes);
}

export function recordSseToken(attributes?: MetricAttributes) {
  ensureSseMetrics();
  sseTokenCounter?.add(1, attributes);
}

export function recordSseError(attributes?: MetricAttributes) {
  ensureSseMetrics();
  sseErrorCounter?.add(1, attributes);
}

export function recordSseDuration(
  durationMs: number,
  attributes?: MetricAttributes,
) {
  ensureSseMetrics();
  sseDurationHistogram?.record(durationMs, attributes);
}
