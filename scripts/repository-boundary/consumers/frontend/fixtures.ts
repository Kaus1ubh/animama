import type { ProductApiTransport } from "@animama/runtime-contracts";
import type { PyAnimaResponse, PyChatMessage, PyChatResponse } from "@animama/runtime-contracts/api-types";

export type Scope = "local" | "hosted";
export type RequestRecord = { scope: Scope; path: string; method: string; body?: Record<string, unknown> };
export const evidence = {
  requests: [] as RequestRecord[],
  aborted: [] as Scope[],
  acceptedGestures: [] as string[],
  errors: [] as string[],
};

/** Different transport origins partition server ownership; browser bodies never assert owner IDs. */
export function fixtureTransport(scope: Scope): ProductApiTransport {
  const baseUrl = `${location.origin}/fixture/${scope}`;
  const animaId = `${scope}-anima`;
  const chatId = `${scope}-chat`;
  const messages: PyChatMessage[] = [];
  const anima: PyAnimaResponse = {
    id: animaId,
    display_name: scope === "local" ? "Local Anima" : "Hosted Anima",
    aggregate_revision: 1,
    identity_status: "ready",
    chat_profile: { anima_id: animaId, default_model_provider_id: "fixture-model" },
  };
  const chat: PyChatResponse = { id: chatId, anima_id: animaId, title: "Fixture conversation" };
  const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
  const frame = (data: unknown) => new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
  return {
    baseUrl,
    fetch: async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (!request.url.startsWith(baseUrl + "/")) throw new Error(`Cross-owner request: ${request.url}`);
      if (request.headers.has("Authorization")) throw new Error("Fixture product code injected an unexpected bearer token");
      const path = url.pathname.slice(`/fixture/${scope}`.length);
      const body = request.method === "GET" ? undefined : await request.clone().json() as Record<string, unknown>;
      evidence.requests.push({ scope, path, method: request.method, body });
      if (body && ("user_id" in body || "owner_id" in body)) throw new Error("Product payload must not choose a server owner");
      if (path === `/thumbnails/${scope}.svg`) return globalThis.fetch(`/thumbnails/${scope}.svg`);
      if (path === "/v1/animas") {
        return json([{ ...anima, presentation: {
          display_name: anima.display_name,
          profile_thumbnail: {
            content_revision: `thumbnail-${scope}`, content_type: "image/svg+xml",
            source_type: "catalog", url: `thumbnails/${scope}.svg`, width: 32, height: 32,
            presentation: { fit: "cover", focal_x: 0.5, focal_y: 0.5, zoom: 1 },
          },
        } }]);
      }
      if (path === `/v1/animas/${animaId}`) return json(anima);
      if (path === "/v1/model-providers") {
        return json([{ id: "fixture-model", model: "fixture", model_provider: "fixture",
          api_standard: "fixture-chat-standard", supports_streaming: true }]);
      }
      if (path === "/v1/chats" && request.method === "POST") {
        if (body?.anima_id !== animaId) throw new Error("Chat creation escaped the selected owner/anima");
        return json(chat);
      }
      if (path === "/v1/chats") return json([chat]);
      if (path === `/v1/chats/${chatId}`) return json(chat);
      if (path === `/v1/chats/${chatId}/messages`) return json({ messages });
      if (path === `/v1/animas/${animaId}/chat:sse`) {
        if (body?.runtime_revision !== `fixture-revision-${scope}`) throw new Error("Missing issued runtime fence");
        if (body.chat_id !== chatId) throw new Error("Chat request escaped its owner");
        if (body.message === "fail") return new Response("fixture unavailable", { status: 503 });
        const runId = String(body.run_id);
        let closed = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const close = () => {
              if (closed) return;
              closed = true;
              clearTimeout(timer);
              controller.close();
            };
            request.signal.addEventListener("abort", () => { evidence.aborted.push(scope); close(); }, { once: true });
            controller.enqueue(frame({ run_id: "stale-run", text: "STALE OUTPUT MUST NOT RENDER", is_delta: true }));
            controller.enqueue(frame({ run_id: runId, gesture: "stale-gesture", runtime_revision: "stale-revision" }));
            controller.enqueue(frame({ run_id: runId, gesture: "accepted-gesture", runtime_revision: `fixture-revision-${scope}` }));
            const text = body.message === "hold" ? "Waiting for cancellation" : `Hello from ${scope}`;
            controller.enqueue(frame({ run_id: runId, text, is_delta: true }));
            if (body.message === "hold") return;
            timer = setTimeout(() => {
              if (closed) return;
              messages.push({ chat_id: chatId, run_id: runId, role: "user", content: String(body.message) });
              messages.push({ chat_id: chatId, run_id: runId, role: "assistant", content: text });
              controller.enqueue(frame({ run_id: runId, chat_id: chatId }));
              close();
            }, 120);
          },
          cancel() { closed = true; clearTimeout(timer); },
        });
        return new Response(stream, { headers: { "content-type": "text/event-stream" } });
      }
      const error = `Unexpected fixture request ${request.method} ${path}`;
      evidence.errors.push(error);
      throw new Error(error);
    },
  };
}
