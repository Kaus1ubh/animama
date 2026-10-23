import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LOGS_INTERVAL_MS,
  MAX_QUEUED_LOGS,
  MAX_REQUEST_BYTES,
  MAX_SERIES_PER_INSTRUMENT,
  METRICS_INTERVAL_MS,
  startBrowserTelemetry,
} from "./browser-exporter";
import {
  recordSseDuration,
  recordSseToken,
  recordUiInteraction,
} from "./metrics";

const uuid = "123e4567-e89b-42d3-a456-426614174000";

type AnyValue = { stringValue?: string; boolValue?: boolean };
type KeyValue = { key: string; value: AnyValue };
type DataPoint = {
  attributes: KeyValue[];
  startTimeUnixNano: string;
  timeUnixNano: string;
  asDouble?: number;
  count?: string;
  sum?: number;
  bucketCounts?: string[];
  explicitBounds?: number[];
};
type Metric = {
  name: string;
  unit: string;
  sum?: {
    aggregationTemporality: number;
    isMonotonic: boolean;
    dataPoints: DataPoint[];
  };
  histogram?: { aggregationTemporality: number; dataPoints: DataPoint[] };
};
type LogRecord = {
  severityNumber: number;
  severityText: string;
  body: AnyValue;
  attributes: KeyValue[];
};
type Body = {
  resourceMetrics: Array<{
    resource: { attributes: KeyValue[] };
    scopeMetrics: Array<{ metrics: Metric[] }>;
  }>;
  resourceLogs: Array<{ scopeLogs: Array<{ logRecords: LogRecord[] }> }>;
};
type Sent = { path: string; init: RequestInit; body: Body };

function harness(
  respond: () => Promise<Response> = async () =>
    new Response(null, { status: 200 }),
) {
  const sent: Sent[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({
      path: String(input),
      init: init ?? {},
      body: JSON.parse(String(init?.body)),
    });
    return respond();
  });
  const errors = new EventTarget();
  const visibility = Object.assign(new EventTarget(), {
    visibilityState: "visible" as DocumentVisibilityState,
  });
  const stop = startBrowserTelemetry({
    path: "/api/telemetry",
    fetch,
    target: errors,
    visibility,
  });
  return { sent, fetch, errors, visibility, stop };
}

function attributes(list: KeyValue[] | undefined) {
  return Object.fromEntries(
    (list ?? []).map(({ key, value }) => [
      key,
      value.stringValue ?? value.boolValue,
    ]),
  );
}

function metricsOf(sent: Sent) {
  return sent.body.resourceMetrics[0].scopeMetrics[0].metrics;
}

function logsOf(sent: Sent) {
  return sent.body.resourceLogs[0].scopeLogs[0].logRecords;
}

function fail(error: unknown, type = "error") {
  return Object.assign(new Event(type), {
    error,
    message: error instanceof Error ? error.message : "",
  });
}

function reject(reason: unknown) {
  return Object.assign(new Event("unhandledrejection"), { reason });
}

const bytes = (sent: Sent) =>
  new TextEncoder().encode(String(sent.init.body)).byteLength;

let active: (() => void) | null = null;
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  active?.();
  active = null;
  vi.useRealTimers();
});

describe("browser telemetry exporter", () => {
  it("records nothing before it starts", async () => {
    recordUiInteraction({ action: "before-start" });
    const { sent, stop } = harness();
    active = stop;
    await vi.advanceTimersByTimeAsync(METRICS_INTERVAL_MS);
    expect(sent).toEqual([]);
  });

  it("exports delta metrics as OTLP JSON to the same-origin path", async () => {
    const { sent, stop } = harness();
    active = stop;
    recordUiInteraction({ action: "chat.submit", anima_id: uuid });
    recordUiInteraction({ action: "chat.submit", anima_id: uuid });
    recordSseDuration(1_200, { anima_id: uuid, status: "ok" });
    await vi.advanceTimersByTimeAsync(METRICS_INTERVAL_MS);

    expect(sent).toHaveLength(1);
    const [request] = sent;
    expect(request.path).toBe("/api/telemetry/metrics");
    expect(request.init.method).toBe("POST");
    expect(new Headers(request.init.headers).get("content-type")).toBe(
      "application/json",
    );
    expect(
      attributes(request.body.resourceMetrics[0].resource.attributes),
    ).toMatchObject({ "service.name": "animama-webui" });
    const metrics = metricsOf(request);
    const interactions = metrics.find(
      (metric) => metric.name === "anima.webui.ui.interactions",
    )!;
    expect(interactions.sum!.aggregationTemporality).toBe(1);
    expect(interactions.sum!.isMonotonic).toBe(true);
    const [point] = interactions.sum!.dataPoints;
    expect(point.asDouble).toBe(2);
    expect(attributes(point.attributes)).toEqual({ action: "chat.submit" });
    expect(point.startTimeUnixNano).toMatch(/^\d+$/);
    expect(point.timeUnixNano).toMatch(/^\d+$/);
    const duration = metrics.find(
      (metric) => metric.name === "anima.webui.sse.duration",
    )!;
    expect(duration.unit).toBe("ms");
    const [histogram] = duration.histogram!.dataPoints;
    expect(histogram).toMatchObject({ count: "1", sum: 1_200 });
    expect(histogram.bucketCounts).toHaveLength(
      histogram.explicitBounds!.length + 1,
    );
    expect(attributes(histogram.attributes)).toEqual({ status: "ok" });
    expect(String(request.init.body)).not.toContain(uuid);

    // Delta temporality: an idle interval sends nothing.
    await vi.advanceTimersByTimeAsync(METRICS_INTERVAL_MS);
    expect(sent).toHaveLength(1);
  });

  it("exports uncaught errors and rejections as sanitized error logs", async () => {
    const { sent, errors, stop } = harness();
    active = stop;
    const error = new TypeError(
      `Failed for person@example.com at https://app.example.test/v1/animas/${uuid}?draft=hello`,
    );
    error.stack = `TypeError: ${error.message}\n    at send (https://app.example.test/assets/index-abc.js?v=1:2:3)`;
    errors.dispatchEvent(fail(error));
    errors.dispatchEvent(reject(`chat ${uuid} was not saved`));
    errors.dispatchEvent(reject({ prompt: "a private prompt" }));
    errors.dispatchEvent(reject({ name: "Leak", message: "a private prompt" }));
    // A Firefox frame that starts with the type is not a message header.
    const unnamed = new Error("");
    unnamed.stack = "ErrorBoundary@https://app.example.test/assets/a.js:1:2";
    errors.dispatchEvent(fail(unnamed));
    await vi.advanceTimersByTimeAsync(LOGS_INTERVAL_MS);

    expect(sent.map((request) => request.path)).toEqual([
      "/api/telemetry/logs",
    ]);
    const records = logsOf(sent[0]);
    expect(records).toHaveLength(4);
    for (const record of records) {
      expect(record.severityNumber).toBe(17);
      expect(record.severityText).toBe("ERROR");
    }
    expect(records[0].body.stringValue).toBe(
      "Failed for <email> at /v1/animas/<id>",
    );
    expect(attributes(records[0].attributes)).toEqual({
      "exception.type": "TypeError",
      "exception.message": "Failed for <email> at /v1/animas/<id>",
      // The stack drops its message header, which is capped separately.
      "exception.stacktrace": "    at send (/assets/index-abc.js:2:3)",
    });
    expect(records[1].body.stringValue).toBe("chat <id> was not saved");
    // Only Errors and strings are read: other values, even Error-shaped
    // objects, may hold content. The two object reasons share one record.
    expect(records[2].body.stringValue).toBe("Unhandled rejection");
    expect(attributes(records[2].attributes)).toEqual({
      "exception.type": "object",
    });
    expect(records[3].body.stringValue).toBe("Uncaught error");
    expect(attributes(records[3].attributes)).toEqual({
      "exception.type": "Error",
      "exception.stacktrace": "ErrorBoundary@/assets/a.js:1:2",
    });
    const body = String(sent[0].init.body);
    for (const forbidden of [
      "@example.com",
      "example.test",
      "draft=",
      "?v=",
      "private prompt",
      uuid,
    ])
      expect(body).not.toContain(forbidden);
  });

  it("bounds metric series, queued logs and each request's size", async () => {
    const { sent, errors, stop } = harness();
    active = stop;
    for (let index = 0; index < MAX_SERIES_PER_INSTRUMENT * 3; index++)
      recordSseToken({ status: `status-${index}` });
    // Identical errors (a failing render loop) queue once per batch.
    for (let index = 0; index < 50; index++)
      errors.dispatchEvent(fail(new Error("same failure")));
    for (let index = 0; index < MAX_QUEUED_LOGS * 3; index++) {
      const error = new Error(`failure ${index}`);
      // Wide characters make each capped stack line about 3 KB, so batches split.
      error.stack = `Error: failure ${index}\n${"あい ".repeat(2_000)}`;
      errors.dispatchEvent(fail(error));
    }
    await vi.advanceTimersByTimeAsync(METRICS_INTERVAL_MS);

    const metrics = sent.filter((request) => request.path.endsWith("/metrics"));
    expect(metrics).toHaveLength(1);
    const tokens = metricsOf(metrics[0]).find(
      (metric) => metric.name === "anima.webui.sse.tokens",
    )!;
    expect(tokens.sum!.dataPoints).toHaveLength(MAX_SERIES_PER_INSTRUMENT + 1);
    const overflow = tokens.sum!.dataPoints.at(-1)!;
    expect(attributes(overflow.attributes)).toEqual({
      "otel.metric.overflow": true,
    });
    expect(overflow.asDouble).toBe(MAX_SERIES_PER_INSTRUMENT * 2);

    const logs = sent.filter((request) => request.path.endsWith("/logs"));
    const messages = logs.flatMap((request) =>
      logsOf(request).map((record) => record.body.stringValue),
    );
    expect(messages.filter((text) => text === "same failure")).toHaveLength(1);
    // The queue held at most its bound; the rest were dropped, not deferred.
    expect(messages.length).toBeLessThanOrEqual(MAX_QUEUED_LOGS);
    for (const request of sent)
      expect(bytes(request)).toBeLessThanOrEqual(MAX_REQUEST_BYTES);
    // A full batch leaves later records for the next interval instead of growing.
    expect(logs.length).toBeGreaterThan(1);
  });

  it("sanitizes a repeated failure once, however often it is thrown", async () => {
    const { sent, errors, stop } = harness();
    active = stop;
    const error = new Error(`${"x ".repeat(2_500)}${uuid}`);
    // Fake timers also freeze performance.now(), so measure with hrtime.
    const started = process.hrtime.bigint();
    for (let index = 0; index < 5_000; index++)
      errors.dispatchEvent(fail(error));
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    expect(elapsedMs).toBeLessThan(250);
    await vi.advanceTimersByTimeAsync(LOGS_INTERVAL_MS);
    expect(logsOf(sent[0])).toHaveLength(1);
  });

  it("drops a failed batch, backs off and keeps recording without waiting", async () => {
    let status = 503;
    const { sent, errors, stop } = harness(
      async () => new Response(null, { status }),
    );
    active = stop;
    errors.dispatchEvent(fail(new Error("first")));
    await vi.advanceTimersByTimeAsync(LOGS_INTERVAL_MS);
    expect(sent).toHaveLength(1);

    errors.dispatchEvent(fail(new Error("second")));
    // The failure pauses export for twice the interval; the failed batch is gone.
    await vi.advanceTimersByTimeAsync(LOGS_INTERVAL_MS);
    expect(sent).toHaveLength(1);
    status = 200;
    await vi.advanceTimersByTimeAsync(LOGS_INTERVAL_MS * 2);
    expect(sent).toHaveLength(2);
    expect(logsOf(sent[1]).map((record) => record.body.stringValue)).toEqual([
      "second",
    ]);
  });

  it("never stacks requests behind an endpoint that does not answer", async () => {
    const { sent, errors, stop } = harness(() => new Promise(() => {}));
    active = stop;
    for (let tick = 0; tick < 20; tick++) {
      errors.dispatchEvent(fail(new Error(`hang ${tick}`)));
      recordUiInteraction({ action: "chat.submit" });
      await vi.advanceTimersByTimeAsync(LOGS_INTERVAL_MS);
    }
    // One request per signal waits for its timeout; nothing queues behind it.
    expect(
      sent.filter((request) => request.path.endsWith("/logs")),
    ).toHaveLength(1);
    expect(
      sent.filter((request) => request.path.endsWith("/metrics")),
    ).toHaveLength(1);
    expect(sent[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it("flushes with keepalive when the page is hidden", async () => {
    const { sent, errors, visibility, stop } = harness();
    active = stop;
    recordUiInteraction({ action: "chat.submit" });
    for (let index = 0; index < MAX_QUEUED_LOGS; index++) {
      const error = new Error(`before leaving ${index}`);
      error.stack = `Error: before leaving ${index}\n${"あい ".repeat(2_000)}`;
      errors.dispatchEvent(fail(error));
    }
    visibility.visibilityState = "hidden";
    visibility.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);

    // Errors go first; both bodies together fit the browser's 64 KiB keepalive quota.
    expect(sent.map((request) => request.path)).toEqual([
      "/api/telemetry/logs",
      "/api/telemetry/metrics",
    ]);
    expect(sent.every((request) => request.init.keepalive === true)).toBe(true);
    expect(bytes(sent[0]) + bytes(sent[1])).toBeLessThanOrEqual(
      MAX_REQUEST_BYTES,
    );
    expect(logsOf(sent[0]).length).toBeLessThan(MAX_QUEUED_LOGS);
  });

  it("stops listening and drops unsent data when stopped", async () => {
    const { sent, errors, stop } = harness();
    recordUiInteraction({ action: "chat.submit" });
    errors.dispatchEvent(fail(new Error("pending")));
    stop();
    errors.dispatchEvent(fail(new Error("after stop")));
    recordUiInteraction({ action: "chat.submit" });
    await vi.advanceTimersByTimeAsync(METRICS_INTERVAL_MS * 2);
    expect(sent).toEqual([]);
  });
});
