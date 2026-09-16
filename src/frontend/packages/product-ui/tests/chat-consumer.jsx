import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ProductRuntimeProvider, useRuntimeOwnerId } from "@animama/product-ui";
import { useChatSse } from "@animama/product-ui/query";

// A separately bundled consumer: only package exports and browser primitives.
// The transport deliberately permits late responses to exercise cancellation races.
const requests = [];
const events = [];
const settled = [];
let stopOnToken = false;
let run = 0;
let api;
const transport = {
  baseUrl: "https://chat-fixture.invalid",
  fetch: async (request) => {
    const body = await request.clone().json();
    return new Promise((resolve) => {
      const entry = { request, body, resolve, cancelled: false };
      entry.stream = new ReadableStream({
        start(controller) {
          entry.controller = controller;
        },
        cancel() {
          entry.cancelled = true;
        },
      });
      requests.push(entry);
    });
  },
};

function Consumer() {
  const { startChat, stop, isStreaming } = useChatSse();
  const owner = useRuntimeOwnerId();
  const [transcript, setTranscript] = useState("");
  api = { startChat, stop };
  function start() {
    const run_id = `run-${++run}`;
    void startChat({
      animaId: "anima-fixture",
      body: { message: "hello", run_id, runtime_revision: "revision-fixture" },
      onOpen: () => events.push(["open", run_id]),
      onToken: (text) => {
        events.push(["token", text]);
        setTranscript((old) => old + text);
        if (stopOnToken) stop();
      },
      onComplete: (data) => events.push(["complete", data.run_id]),
      onError: (error) => events.push(["error", error.message ?? error.error]),
      onEmotionUpdate: () => events.push(["emotion"]),
      onChatTitleUpdated: () => events.push(["title"]),
      onAvatarGestureRequested: () => events.push(["gesture"]),
    }).finally(() => settled.push(run_id));
  }
  return (
    <main>
      <span id="owner">{owner}</span>
      <button id="start" onClick={start}>
        Start
      </button>
      <button id="stop" disabled={!isStreaming} onClick={stop}>
        Stop
      </button>
      <output id="streaming">{String(isStreaming)}</output>
      <output id="transcript">{transcript}</output>
    </main>
  );
}

const root = createRoot(document.getElementById("root"));
function mount(owner = "owner-fixture") {
  root.render(
    <ProductRuntimeProvider
      owner={{ id: owner }}
      capabilities={{ chat: true }}
      transport={transport}
    >
      <Consumer />
    </ProductRuntimeProvider>,
  );
}
window.fixture = {
  mount,
  unmount: () => root.unmount(),
  stop: () => api.stop(),
  requests: () =>
    requests.map(({ request, body, cancelled }) => ({
      url: request.url,
      method: request.method,
      body,
      aborted: request.signal.aborted,
      cancelled,
      authorization: request.headers.get("authorization"),
    })),
  events: () => events,
  settled: () => settled,
  stopOnToken: () => {
    stopOnToken = true;
  },
  respond: (index, status = 200) =>
    requests[index].resolve(
      new Response(
        status === 200
          ? requests[index].stream
          : JSON.stringify({ detail: "fixture error" }),
        {
          status,
          headers: {
            "Content-Type":
              status === 200 ? "text/event-stream" : "application/json",
          },
        },
      ),
    ),
  send: (index, data) =>
    requests[index].controller.enqueue(
      new TextEncoder().encode(
        data.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
      ),
    ),
  close: (index) => requests[index].controller.close(),
  fail: (index) =>
    requests[index].controller.error(new Error("fixture transport failed")),
};
mount();
