import { performance } from "node:perf_hooks";

const maxPendingRequests = 256;
const maxCompletedRequests = 64;

function safePath(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return "[non-http]";
    return parsed.pathname.slice(0, 240);
  } catch {
    return "[invalid-url]";
  }
}

function networkTiming(request) {
  try {
    const { requestStart, responseStart, responseEnd } = request.timing();
    return { requestStart, responseStart, responseEnd };
  } catch {
    return null;
  }
}

function failureCode(request) {
  // Never report arbitrary error text, which may contain a URL or private data.
  return (
    request.failure()?.errorText.match(/net::[A-Z0-9_]+/)?.[0] ??
    "request_failed"
  );
}

/**
 * Observe one initial entry without changing its navigation/readiness contract.
 * A failure keeps the original Error, detaches observers, and closes only this
 * mount's owned context. Reporting is synchronous and contains no URL queries,
 * headers, cookies, response bodies, DOM text, or browser evaluation.
 */
export async function observeInitialNavigation({
  page,
  ownedContext,
  navigate,
  ready,
  report = (packet) =>
    console.error("Initial fixture entry failed", JSON.stringify(packet)),
}) {
  if (page.context() !== ownedContext)
    throw new TypeError("Initial entry must supply its page's owned context");

  const started = performance.now();
  const elapsed = () => Math.round((performance.now() - started) * 1000) / 1000;
  const pending = new Map(),
    completed = [];
  let nextRequest = 0,
    droppedRequests = 0,
    evictedCompleted = 0;
  let document = null,
    mainFrameCommitMs = null,
    mainFramePath = null;
  let domContentLoadedMs = null,
    loadMs = null,
    pageErrorCount = 0,
    crashed = false;
  let navigationResolvedMs = null,
    stage = "navigation/load";

  const onRequest = (request) => {
    const id = ++nextRequest;
    if (pending.size >= maxPendingRequests) {
      droppedRequests++;
      return;
    }
    const record = {
      id,
      path: safePath(request.url()),
      method: request.method(),
      startedMs: elapsed(),
      responseMs: null,
      status: null,
      finishedMs: null,
      failedMs: null,
      failure: null,
      networkTiming: null,
    };
    pending.set(request, record);
    if (request.isNavigationRequest() && request.frame() === page.mainFrame())
      document = record;
  };
  const onResponse = (response) => {
    const record = pending.get(response.request());
    if (record) {
      record.responseMs = elapsed();
      record.status = response.status();
    }
  };
  const finish = (request, failed) => {
    const record = pending.get(request);
    if (!record) return;
    if (failed) {
      record.failedMs = elapsed();
      record.failure = failureCode(request);
    } else record.finishedMs = elapsed();
    record.networkTiming = networkTiming(request);
    pending.delete(request);
    completed.push(record);
    if (completed.length > maxCompletedRequests) {
      completed.shift();
      evictedCompleted++;
    }
  };
  const listeners = [
    ["request", onRequest],
    ["response", onResponse],
    ["requestfinished", (request) => finish(request, false)],
    ["requestfailed", (request) => finish(request, true)],
    [
      "framenavigated",
      (frame) => {
        if (frame === page.mainFrame()) {
          mainFrameCommitMs = elapsed();
          mainFramePath = safePath(frame.url());
        }
      },
    ],
    [
      "domcontentloaded",
      () => {
        domContentLoadedMs = elapsed();
      },
    ],
    [
      "load",
      () => {
        loadMs = elapsed();
      },
    ],
    [
      "pageerror",
      () => {
        pageErrorCount++;
      },
    ],
    [
      "crash",
      () => {
        crashed = true;
      },
    ],
  ];
  for (const [name, listener] of listeners) page.on(name, listener);
  const detach = () => {
    for (const [name, listener] of listeners) page.off(name, listener);
  };

  try {
    const response = await navigate();
    navigationResolvedMs = elapsed();
    stage = "fixture-ready";
    await ready();
    return response;
  } catch (error) {
    // Freeze failure evidence before context cleanup aborts pending requests.
    detach();
    const packet = {
      schema: "animama-initial-entry-diagnostic/1",
      stage,
      elapsedMs: elapsed(),
      navigationResolvedMs,
      mainFrameCommitMs,
      mainFramePath,
      domContentLoadedMs,
      loadMs,
      pageErrorCount,
      crashed,
      document,
      requests: [...completed, ...pending.values()].sort((a, b) => a.id - b.id),
      truncated: { droppedRequests, evictedCompleted },
      cleanup: "owned-context-close-failed",
    };
    try {
      await ownedContext.close();
      packet.cleanup = "owned-context-closed";
    } catch {
      // Cleanup failure must not replace the genuine navigation/readiness error.
    }
    try {
      report(packet);
    } catch {
      // A diagnostic writer cannot turn a failed entry into success or mask it.
    }
    throw error;
  } finally {
    detach();
  }
}
