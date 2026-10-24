import {
  recordMetric,
  type MetricAttributes,
  type MetricInstrument,
} from "./metric-sink";

/** The web app's metrics; nothing records them until an exporter starts. */
const instruments = {
  uiInteractions: {
    name: "anima.webui.ui.interactions",
    description: "User interaction count (frontend)",
    unit: "1",
    kind: "counter",
  },
  uiInteractionDuration: {
    name: "anima.webui.ui.interaction.duration",
    description: "User interaction duration",
    unit: "ms",
    kind: "histogram",
  },
  sseStarts: {
    name: "anima.webui.sse.starts",
    description: "Chat SSE starts",
    unit: "1",
    kind: "counter",
  },
  sseTokens: {
    name: "anima.webui.sse.tokens",
    description: "SSE tokens received",
    unit: "1",
    kind: "counter",
  },
  sseErrors: {
    name: "anima.webui.sse.errors",
    description: "SSE stream errors",
    unit: "1",
    kind: "counter",
  },
  sseDuration: {
    name: "anima.webui.sse.duration",
    description: "SSE stream duration",
    unit: "ms",
    kind: "histogram",
  },
} as const satisfies Record<string, MetricInstrument>;

export function recordUiInteraction(attributes?: MetricAttributes) {
  recordMetric(instruments.uiInteractions, 1, attributes);
}

export function recordUiInteractionDuration(
  durationMs: number,
  attributes?: MetricAttributes,
) {
  recordMetric(instruments.uiInteractionDuration, durationMs, attributes);
}

export function recordSseStart(attributes?: MetricAttributes) {
  recordMetric(instruments.sseStarts, 1, attributes);
}

export function recordSseToken(attributes?: MetricAttributes) {
  recordMetric(instruments.sseTokens, 1, attributes);
}

export function recordSseError(attributes?: MetricAttributes) {
  recordMetric(instruments.sseErrors, 1, attributes);
}

export function recordSseDuration(
  durationMs: number,
  attributes?: MetricAttributes,
) {
  recordMetric(instruments.sseDuration, durationMs, attributes);
}
