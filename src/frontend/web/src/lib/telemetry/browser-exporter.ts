import { env } from "@/platform/env";
import {
  isMetricSink,
  setMetricSink,
  type MetricInstrument,
  type MetricSink,
} from "./metric-sink";
import {
  MAX_ATTRIBUTE_LENGTH,
  MAX_MESSAGE_LENGTH,
  sanitizeAttributes,
  sanitizeStack,
  sanitizeText,
  type TelemetryAttributes,
} from "./sanitize";

export const METRICS_INTERVAL_MS = 60_000;
export const LOGS_INTERVAL_MS = 10_000;
export const MAX_SERIES_PER_INSTRUMENT = 16;
export const MAX_QUEUED_LOGS = 32;
/** Every request fits a same-origin forwarder's 64 KiB body limit. */
export const MAX_REQUEST_BYTES = 64 * 1024;
/** Page-hide flushes share the browser's 64 KiB in-flight keepalive quota. */
const KEEPALIVE_REQUEST_BYTES = MAX_REQUEST_BYTES / 2;
export const REQUEST_TIMEOUT_MS = 10_000;
const MAX_BACKOFF_MS = 5 * 60_000;
/** Room for the resource, scope and metric envelopes around measured items. */
const ENVELOPE_BYTES = 4 * 1024;
const HISTOGRAM_BOUNDS = [
  0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1_000, 2_500, 5_000, 7_500, 10_000,
  30_000, 60_000, 120_000,
];
const SERVICE_NAME = "animama-webui";
const DELTA_TEMPORALITY = 1;
const ERROR_SEVERITY = 17;
const OVERFLOW_KEY = "overflow";
const OVERFLOW: TelemetryAttributes = { "otel.metric.overflow": true };
/** Characters of a failure's type, message and stack that identify a repeat. */
const DEDUPE_PREFIX = 2_048;

// OTLP/HTTP JSON follows the protobuf JSON mapping: 64-bit integers are strings.
type AnyValue =
  | { stringValue: string }
  | { boolValue: boolean }
  | { intValue: string }
  | { doubleValue: number };
type KeyValue = { key: string; value: AnyValue };
type Series = {
  attributes: TelemetryAttributes;
  count: number;
  sum: number;
  min: number;
  max: number;
  buckets: number[];
};
type QueuedLog = {
  key: string;
  time: number;
  body: string;
  attributes: TelemetryAttributes;
};

export type BrowserTelemetryOptions = {
  /** The capability's validated same-origin base path; signals post to `{path}/{signal}`. */
  path: string;
  /** The admitted session's fetch: same-origin, and aborted when the session ends. */
  fetch: typeof globalThis.fetch;
  /** Uncaught errors, unhandled rejections and `pagehide`; the page's window by default. */
  target?: EventTarget;
  /** The hidden-page flush; the page's document by default. */
  visibility?: EventTarget & {
    readonly visibilityState?: DocumentVisibilityState;
  };
};

const encoder = new TextEncoder();
const byteLength = (text: string) => encoder.encode(text).byteLength;
const nanos = (ms: number) => `${Math.trunc(ms)}000000`;

function anyValue(value: string | number | boolean): AnyValue {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { boolValue: value };
  return Number.isSafeInteger(value)
    ? { intValue: String(value) }
    : { doubleValue: value };
}

function keyValues(attributes: TelemetryAttributes): KeyValue[] {
  return Object.entries(attributes).map(([key, value]) => ({
    key,
    value: anyValue(value),
  }));
}

/** OTLP explicit buckets: bucket i holds values in (bounds[i-1], bounds[i]]. */
function bucketIndex(value: number): number {
  const index = HISTOGRAM_BOUNDS.findIndex((bound) => value <= bound);
  return index < 0 ? HISTOGRAM_BOUNDS.length : index;
}

/**
 * Reads only an `Error`'s type, message and stack, or a thrown string; other
 * values, even Error-shaped objects, may hold content and are never read.
 */
function describeFailure(reason: unknown): {
  type: string;
  message: string;
  stack: string | null;
} {
  if (typeof reason === "string")
    return { type: "string", message: reason, stack: null };
  if (reason instanceof Error) {
    const type =
      typeof reason.name === "string" && reason.name ? reason.name : "Error";
    const message = typeof reason.message === "string" ? reason.message : "";
    let stack = typeof reason.stack === "string" ? reason.stack : null;
    // V8 starts a stack with `${name}: ${message}`; the capped message goes once.
    const header = message ? `${type}: ${message}` : type;
    // The header is a whole first line, so a frame such as `ErrorBoundary@…` stays.
    if (stack === header || stack?.startsWith(`${header}\n`))
      stack = stack.slice(header.length + 1) || null;
    return { type, message, stack };
  }
  return {
    type: reason === null ? "null" : typeof reason,
    message: "",
    stack: null,
  };
}

/**
 * Exports the web app's metrics and uncaught errors as OTLP/HTTP JSON to
 * `{path}/metrics` and `{path}/logs` on the page's own origin, and returns the
 * function that stops it. Measurements are aggregated as delta sums and
 * histograms and sent each minute; errors are sent every ten seconds and when
 * the page is hidden. Every buffer is bounded and a failed batch is dropped,
 * then export pauses with exponential backoff. Recording never waits for the
 * network, so telemetry cannot block or break the UI.
 */
export function startBrowserTelemetry(
  options: BrowserTelemetryOptions,
): () => void {
  const target =
    options.target ?? (typeof window === "undefined" ? undefined : window);
  const visibility =
    options.visibility ??
    (typeof document === "undefined" ? undefined : document);
  const resource = {
    attributes: keyValues({
      "service.name": SERVICE_NAME,
      "service.version": env.appVersion,
    }),
  };
  const scope = { name: SERVICE_NAME };
  const series = new Map<MetricInstrument, Map<string, Series>>();
  let windowStart = Date.now();
  let logs: QueuedLog[] = [];
  const queuedLogKeys = new Set<string>();
  const inFlight = { metrics: false, logs: false };
  let failures = 0;
  let pausedUntil = 0;
  let stopped = false;

  const sink: MetricSink = (instrument, value, attributes) => {
    if (stopped || !Number.isFinite(value)) return;
    try {
      let points = series.get(instrument);
      if (!points) series.set(instrument, (points = new Map()));
      const clean = sanitizeAttributes(attributes);
      let key = JSON.stringify(
        Object.entries(clean).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      );
      let point = points.get(key);
      if (!point && points.size >= MAX_SERIES_PER_INSTRUMENT) {
        // Further attribute sets share one overflow series, as the OTel SDK does.
        key = OVERFLOW_KEY;
        point = points.get(key);
      }
      if (!point) {
        point = {
          attributes: key === OVERFLOW_KEY ? OVERFLOW : clean,
          count: 0,
          sum: 0,
          min: value,
          max: value,
          buckets:
            instrument.kind === "histogram"
              ? new Array<number>(HISTOGRAM_BOUNDS.length + 1).fill(0)
              : [],
        };
        points.set(key, point);
      }
      point.count += 1;
      point.sum += value;
      point.min = Math.min(point.min, value);
      point.max = Math.max(point.max, value);
      if (instrument.kind === "histogram") point.buckets[bucketIndex(value)]++;
    } catch {
      // A measurement is never worth breaking the code that recorded it.
    }
  };

  function capture(reason: unknown, fallback: string): void {
    // Check the bound first, so a failing render loop costs no sanitizing.
    if (stopped || logs.length >= MAX_QUEUED_LOGS) return;
    try {
      const { type, message, stack } = describeFailure(reason);
      // A repeated failure, such as a failing render loop, is queued (and
      // sanitized) once per batch; the key is never exported.
      const key = JSON.stringify([
        type.slice(0, DEDUPE_PREFIX),
        message.slice(0, DEDUPE_PREFIX),
        (stack ?? "").slice(0, DEDUPE_PREFIX),
      ]);
      if (queuedLogKeys.has(key)) return;
      const text = message ? sanitizeText(message, MAX_MESSAGE_LENGTH) : "";
      const attributes: TelemetryAttributes = {
        "exception.type": sanitizeText(type, MAX_ATTRIBUTE_LENGTH),
      };
      if (text) attributes["exception.message"] = text;
      const frames = stack ? sanitizeStack(stack) : "";
      if (frames) attributes["exception.stacktrace"] = frames;
      queuedLogKeys.add(key);
      logs.push({ key, time: Date.now(), body: text || fallback, attributes });
    } catch {
      // Reporting a failure must not raise another one.
    }
  }
  const onError = (event: Event) => {
    const { error, message } = event as ErrorEvent;
    capture(error ?? message, "Uncaught error");
  };
  const onRejection = (event: Event) =>
    capture((event as PromiseRejectionEvent).reason, "Unhandled rejection");

  /** One request per signal at a time; any failure drops its batch and backs off. */
  async function send(
    signal: "metrics" | "logs",
    body: string,
    keepalive: boolean,
  ): Promise<void> {
    inFlight[signal] = true;
    let ok = false;
    try {
      const response = await options.fetch(`${options.path}/${signal}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive,
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      ok = response.ok;
      void response.body?.cancel().catch(() => {});
    } catch {
      ok = false;
    } finally {
      inFlight[signal] = false;
    }
    if (stopped) return;
    if (ok) failures = 0;
    else {
      failures += 1;
      pausedUntil =
        Date.now() + Math.min(LOGS_INTERVAL_MS * 2 ** failures, MAX_BACKOFF_MS);
    }
  }
  const ready = (signal: "metrics" | "logs") =>
    !stopped && !inFlight[signal] && Date.now() >= pausedUntil;

  function exportMetrics(keepalive = false): void {
    // While a request or backoff is pending, measurements keep aggregating.
    if (!ready("metrics") || series.size === 0) return;
    const start = windowStart;
    const end = Date.now();
    const taken = [...series];
    series.clear();
    windowStart = end;
    const limit = keepalive ? KEEPALIVE_REQUEST_BYTES : MAX_REQUEST_BYTES;
    let budget = limit - ENVELOPE_BYTES;
    const metrics: object[] = [];
    for (const [instrument, points] of taken) {
      const dataPoints: object[] = [];
      for (const point of points.values()) {
        const common = {
          attributes: keyValues(point.attributes),
          startTimeUnixNano: nanos(start),
          timeUnixNano: nanos(end),
        };
        const encoded =
          instrument.kind === "counter"
            ? { ...common, asDouble: point.sum }
            : {
                ...common,
                count: String(point.count),
                sum: point.sum,
                min: point.min,
                max: point.max,
                bucketCounts: point.buckets.map(String),
                explicitBounds: HISTOGRAM_BOUNDS,
              };
        budget -= byteLength(JSON.stringify(encoded));
        // Points past the budget are dropped with the rest of this window.
        if (budget < 0) break;
        dataPoints.push(encoded);
      }
      if (dataPoints.length)
        metrics.push({
          name: instrument.name,
          description: instrument.description,
          unit: instrument.unit,
          ...(instrument.kind === "counter"
            ? {
                sum: {
                  aggregationTemporality: DELTA_TEMPORALITY,
                  isMonotonic: true,
                  dataPoints,
                },
              }
            : {
                histogram: {
                  aggregationTemporality: DELTA_TEMPORALITY,
                  dataPoints,
                },
              }),
        });
      if (budget < 0) break;
    }
    const body = JSON.stringify({
      resourceMetrics: [{ resource, scopeMetrics: [{ scope, metrics }] }],
    });
    if (byteLength(body) <= limit) void send("metrics", body, keepalive);
  }

  function exportLogs(keepalive = false): void {
    if (!ready("logs") || logs.length === 0) return;
    const limit = keepalive ? KEEPALIVE_REQUEST_BYTES : MAX_REQUEST_BYTES;
    let budget = limit - ENVELOPE_BYTES;
    const logRecords: object[] = [];
    for (const record of logs) {
      const encoded = {
        timeUnixNano: nanos(record.time),
        observedTimeUnixNano: nanos(record.time),
        severityNumber: ERROR_SEVERITY,
        severityText: "ERROR",
        body: { stringValue: record.body },
        attributes: keyValues(record.attributes),
      };
      budget -= byteLength(JSON.stringify(encoded));
      // Records that do not fit wait for the next batch; the queue stays bounded.
      if (budget < 0 && logRecords.length) break;
      logRecords.push(encoded);
    }
    for (const record of logs.splice(0, logRecords.length))
      queuedLogKeys.delete(record.key);
    const body = JSON.stringify({
      resourceLogs: [{ resource, scopeLogs: [{ scope, logRecords }] }],
    });
    if (byteLength(body) <= limit) void send("logs", body, keepalive);
  }

  // `keepalive` lets the request outlive a page that is being hidden or
  // unloaded. Errors go first: they are the likelier reason the page is leaving.
  const flush = () => {
    exportLogs(true);
    exportMetrics(true);
  };
  const onVisibilityChange = () => {
    if (visibility?.visibilityState === "hidden") flush();
  };
  const metricsTimer = setInterval(exportMetrics, METRICS_INTERVAL_MS);
  const logsTimer = setInterval(exportLogs, LOGS_INTERVAL_MS);
  target?.addEventListener("error", onError);
  target?.addEventListener("unhandledrejection", onRejection);
  target?.addEventListener("pagehide", flush);
  visibility?.addEventListener("visibilitychange", onVisibilityChange);
  setMetricSink(sink);

  return () => {
    if (stopped) return;
    stopped = true;
    clearInterval(metricsTimer);
    clearInterval(logsTimer);
    target?.removeEventListener("error", onError);
    target?.removeEventListener("unhandledrejection", onRejection);
    target?.removeEventListener("pagehide", flush);
    visibility?.removeEventListener("visibilitychange", onVisibilityChange);
    if (isMetricSink(sink)) setMetricSink(null);
    // Unsent data belongs to the ended session and is dropped with it.
    series.clear();
    logs = [];
    queuedLogKeys.clear();
  };
}
