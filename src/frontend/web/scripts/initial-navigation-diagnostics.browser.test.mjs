import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import http from "node:http";
import { performance } from "node:perf_hooks";
import { chromium } from "playwright";
import { observeInitialNavigation } from "./fixtures/initial-navigation-diagnostics.mjs";

const events = [
  "request",
  "response",
  "requestfinished",
  "requestfailed",
  "framenavigated",
  "domcontentloaded",
  "load",
  "pageerror",
  "crash",
];
const timeout = 10000;
let browser, server, origin;
const sockets = new Set();
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=",
  "base64",
);

before(async () => {
  server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/dropped-document") {
      request.socket.destroy();
      return;
    }
    if (url.pathname === "/pending.png" || url.pathname === "/delayed.png") {
      response.writeHead(200, {
        "Content-Type": "image/png",
        "X-Proof-Secret": "HEADER_SENTINEL",
      });
      response.flushHeaders();
      if (url.pathname === "/delayed.png") {
        const timer = setTimeout(() => response.end(png), 12000);
        response.on("close", () => clearTimeout(timer));
      }
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html" });
    const asset = url.pathname === "/hanging" ? "pending" : "delayed";
    response.end(
      "<!doctype html><title>Loopback entry</title><p>Ready marker</p>" +
        (url.pathname === "/normal"
          ? ""
          : '<img src="/' +
            asset +
            '.png?token=QUERY_SENTINEL#FRAGMENT_SENTINEL" alt="BODY_SENTINEL">'),
    );
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = "http://127.0.0.1:" + server.address().port;
  browser = await chromium.launch({ headless: true, timeout });
  console.log(
    JSON.stringify({
      proofRuntime: {
        node: process.version,
        platform: process.platform,
        architecture: process.arch,
        browser: browser.version(),
        defaultTimeoutMs: timeout,
      },
    }),
  );
});

after(async () => {
  await browser?.close();
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => server?.close(resolve));
});

function listenerCounts(page) {
  return events.map((name) => [name, page.listenerCount(name)]);
}

test(
  "normal real loopback load keeps the owned context usable and removes observers",
  { timeout: 15000 },
  async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(timeout);
    const baseline = listenerCounts(page),
      reports = [];
    try {
      const response = await observeInitialNavigation({
        page,
        ownedContext: context,
        navigate: () => page.goto(origin + "/normal?token=QUERY_SENTINEL"),
        ready: () => page.getByText("Ready marker", { exact: true }).waitFor(),
        report: (packet) => reports.push(packet),
      });
      assert.equal(response.status(), 200);
      assert.equal(page.isClosed(), false);
      assert.equal(
        await page.getByText("Ready marker", { exact: true }).count(),
        1,
      );
      assert.deepEqual(reports, []);
      assert.deepEqual(listenerCounts(page), baseline);
      console.log(
        JSON.stringify({
          proof: "normal",
          result: "PASS",
          contextRetained: true,
          listenersRestored: true,
        }),
      );
    } finally {
      await context.close();
    }
  },
);

for (const route of ["hanging", "delayed"]) {
  test(
    "a real " +
      route +
      " subresource still fails the original 10s load wait with sanitized pending evidence",
    { timeout: 15000 },
    async () => {
      const context = await browser.newContext();
      const page = await context.newPage();
      const control = await browser.newContext();
      const controlPage = await control.newPage();
      page.setDefaultTimeout(timeout);
      await context.addCookies([
        { name: "proof", value: "COOKIE_SENTINEL", url: origin },
      ]);
      const baseline = listenerCounts(page),
        reports = [];
      let nativeError,
        thrown,
        readyCalled = false;
      const started = performance.now();
      try {
        try {
          await observeInitialNavigation({
            page,
            ownedContext: context,
            navigate: async () => {
              try {
                return await page.goto(
                  origin + "/" + route + "?token=QUERY_SENTINEL",
                );
              } catch (error) {
                nativeError = error;
                throw error;
              }
            },
            ready: async () => {
              readyCalled = true;
              await page.getByText("Ready marker", { exact: true }).waitFor();
            },
            report: (packet) => reports.push(packet),
          });
        } catch (error) {
          thrown = error;
        }
        const elapsed = performance.now() - started;
        assert.equal(
          thrown,
          nativeError,
          "preserve the genuine Playwright goto Error object",
        );
        assert.equal(thrown.name, "TimeoutError");
        assert.match(thrown.message, /Timeout 10000ms exceeded/);
        assert.equal(thrown.cause, nativeError.cause);
        assert.equal(readyCalled, false);
        assert.ok(
          elapsed >= 9500 && elapsed < 14500,
          "real navigation still uses the original 10s deadline",
        );
        assert.equal(
          reports.length,
          1,
          "a failed initial navigation must emit its bounded evidence",
        );
        const packet = reports[0],
          asset = route === "hanging" ? "/pending.png" : "/delayed.png";
        assert.equal(packet.stage, "navigation/load");
        assert.equal(packet.cleanup, "owned-context-closed");
        assert.ok(
          packet.document.status === 200 && packet.document.finishedMs !== null,
        );
        assert.ok(packet.domContentLoadedMs !== null);
        assert.equal(packet.loadMs, null);
        const pending = packet.requests.find(
          (request) => request.path === asset,
        );
        assert.ok(pending, "identify the real unfinished image");
        assert.equal(pending.status, 200);
        assert.equal(pending.finishedMs, null);
        assert.equal(pending.failedMs, null);
        const serialized = JSON.stringify(packet);
        for (const excluded of [
          "QUERY_SENTINEL",
          "COOKIE_SENTINEL",
          "HEADER_SENTINEL",
          "BODY_SENTINEL",
          "FRAGMENT_SENTINEL",
          "?",
          "#",
          origin,
        ])
          assert.equal(serialized.includes(excluded), false);
        assert.equal(page.isClosed(), true);
        assert.deepEqual(listenerCounts(page), baseline);
        assert.equal(controlPage.isClosed(), false);
        await controlPage.goto(origin + "/normal", { timeout });
        console.log(
          JSON.stringify({
            proof: route,
            result: "PASS",
            elapsedMs: Math.round(elapsed),
            sameNativeError: true,
            originalDeadlineMs: timeout,
            unrelatedContextUsable: true,
            packet,
          }),
        );
      } finally {
        await context.close();
        await control.close();
      }
    },
  );
}

test(
  "a genuine network navigation error survives diagnostics writer failure and owned cleanup",
  { timeout: 15000 },
  async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(timeout);
    const baseline = listenerCounts(page),
      reports = [];
    let nativeError,
      thrown,
      readyCalled = false;
    try {
      try {
        await observeInitialNavigation({
          page,
          ownedContext: context,
          navigate: async () => {
            try {
              return await page.goto(
                origin + "/dropped-document?token=QUERY_SENTINEL",
              );
            } catch (error) {
              nativeError = error;
              throw error;
            }
          },
          ready: async () => {
            readyCalled = true;
          },
          report: (packet) => {
            reports.push(packet);
            throw new Error("WRITER_SENTINEL");
          },
        });
      } catch (error) {
        thrown = error;
      }
      assert.equal(thrown, nativeError);
      assert.match(thrown.message, /net::ERR_EMPTY_RESPONSE/);
      assert.equal(thrown.cause, nativeError.cause);
      assert.equal(readyCalled, false);
      assert.equal(reports.length, 1);
      assert.equal(reports[0].cleanup, "owned-context-closed");
      assert.ok(
        reports[0].requests.some(
          (request) =>
            request.failure === "net::ERR_EMPTY_RESPONSE" &&
            request.failedMs !== null,
        ),
      );
      assert.equal(
        JSON.stringify(reports[0]).includes("QUERY_SENTINEL"),
        false,
      );
      assert.equal(page.isClosed(), true);
      assert.deepEqual(listenerCounts(page), baseline);
      console.log(
        JSON.stringify({
          proof: "genuine-network-error",
          result: "PASS",
          sameNativeError: true,
          writerFailureDidNotReplaceError: true,
          packet: reports[0],
        }),
      );
    } finally {
      await context.close();
    }
  },
);
