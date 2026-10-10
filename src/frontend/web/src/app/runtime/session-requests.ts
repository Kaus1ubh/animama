import type { ProductApiTransport } from "@animama/runtime-contracts";
import { getI18n } from "react-i18next";

/** One admitted browser lifetime; it owns requests and registered private resources. */
export class SessionRequestScope {
  readonly controller = new AbortController();
  private readonly resources = new Set<() => void | Promise<void>>();
  private completion: Promise<void> | null = null;
  private suspended = false;

  readonly key: string;
  readonly transport: ProductApiTransport;
  constructor(key: string, transport: ProductApiTransport) {
    this.key = key;
    this.transport = transport;
  }

  readonly fetch: typeof globalThis.fetch = async (input, init) => {
    this.assertActive();
    if (this.suspended) {
      const t = getI18n().getFixedT(null, "app");
      throw new Error(t("connection.requestNotSent"));
    }
    const target =
      typeof input === "string"
        ? new URL(input, this.transport.baseUrl)
        : input;
    const request = new Request(target, init);
    if (
      new URL(request.url).origin !== new URL(this.transport.baseUrl).origin
    ) {
      throw new TypeError(
        "Product requests must stay on the application origin",
      );
    }
    const signal = AbortSignal.any([request.signal, this.controller.signal]);
    const response = await this.transport.fetch(
      new Request(request, { signal }),
    );
    if (this.controller.signal.aborted) {
      void response.body?.cancel();
      this.assertActive();
    }
    return this.guardResponse(response);
  };

  register(dispose: () => void | Promise<void>): () => void {
    if (this.controller.signal.aborted) {
      void Promise.resolve(dispose()).catch(() => {});
      return () => {};
    }
    this.resources.add(dispose);
    return () => this.resources.delete(dispose);
  }

  /** Connection uncertainty fences new work without deleting the current draft or resources. */
  suspend(): void {
    this.suspended = true;
  }

  resume(): void {
    this.assertActive();
    this.suspended = false;
  }

  /** Abort synchronously; callers can await durable cleanup without delaying loss of admission. */
  end(): Promise<void> {
    if (this.completion) return this.completion;
    this.controller.abort();
    const pending: Promise<void>[] = [];
    for (const dispose of [...this.resources]) {
      try {
        pending.push(Promise.resolve(dispose()));
      } catch (error) {
        pending.push(Promise.reject(error));
      }
    }
    this.resources.clear();
    this.completion = Promise.allSettled(pending).then((results) => {
      const errors = results.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      if (errors.length)
        throw new AggregateError(
          errors,
          "Session resources could not all be disposed",
        );
    });
    // Synchronous teardown callers may not await, but the controller still observes this result.
    void this.completion.catch(() => {});
    return this.completion;
  }

  private assertActive(): void {
    if (this.controller.signal.aborted) {
      throw new DOMException("This browser session has ended", "AbortError");
    }
  }

  /** Fence body reads too: headers arriving before sign-out do not admit late data. */
  private guardResponse(response: Response): Response {
    let guarded = response;
    // Browser network replies may expose an empty stream for these statuses.
    // A Response constructor forbids bodies here, including wrapped empty ones.
    if ([204, 205, 304].includes(response.status)) {
      void response.body?.cancel();
      guarded = new Response(null, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } else if (response.body) {
      const reader = response.body.getReader();
      let unregister = () => {};
      const body = new ReadableStream<Uint8Array>({
        start: (controller) => {
          unregister = this.register(() => {
            controller.error(
              new DOMException("This browser session has ended", "AbortError"),
            );
            void reader.cancel();
          });
        },
        pull: async (controller) => {
          try {
            const next = await reader.read();
            this.assertActive();
            if (next.done) {
              unregister();
              controller.close();
            } else controller.enqueue(next.value);
          } catch (error) {
            unregister();
            controller.error(error);
          }
        },
        cancel: (reason) => {
          unregister();
          return reader.cancel(reason);
        },
      });
      guarded = new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }
    const reads = new Set(["arrayBuffer", "blob", "formData", "json", "text"]);
    return new Proxy(guarded, {
      get: (target, key) => {
        if (key === "url" || key === "redirected" || key === "type")
          return Reflect.get(response, key, response);
        if (key === "body")
          return target.body ? this.guardBody(target.body) : null;
        if (key === "clone")
          return () => {
            this.assertActive();
            return this.guardResponse(target.clone());
          };
        const value = Reflect.get(target, key, target);
        if (typeof value !== "function") return value;
        if (!reads.has(String(key))) return value.bind(target);
        return async (...args: unknown[]) => {
          this.assertActive();
          const result: unknown = await value.apply(target, args);
          this.assertActive();
          return result;
        };
      },
    });
  }

  /** Native streams may have buffered data after EOF; fence each consumer read too. */
  private guardBody(
    body: ReadableStream<Uint8Array>,
  ): ReadableStream<Uint8Array> {
    return new Proxy(body, {
      get: (target, key) => {
        const value = Reflect.get(target, key, target);
        if (key === "getReader")
          return (...args: unknown[]) => {
            const reader = value.apply(
              target,
              args,
            ) as ReadableStreamDefaultReader<Uint8Array>;
            return new Proxy(reader, {
              get: (source, method) => {
                const member = Reflect.get(source, method, source);
                if (method === "read")
                  return async (...readArgs: unknown[]) => {
                    this.assertActive();
                    const result: unknown = await member.apply(
                      source,
                      readArgs,
                    );
                    this.assertActive();
                    return result;
                  };
                return typeof member === "function"
                  ? member.bind(source)
                  : member;
              },
            });
          };
        if (key === "pipeTo")
          return (
            destination: WritableStream<Uint8Array>,
            options?: StreamPipeOptions,
          ) => {
            this.assertActive();
            return target.pipeTo(destination, {
              ...options,
              signal: options?.signal
                ? AbortSignal.any([options.signal, this.controller.signal])
                : this.controller.signal,
            });
          };
        if (key === "pipeThrough")
          return (
            transform: ReadableWritablePair<Uint8Array, Uint8Array>,
            options?: StreamPipeOptions,
          ) => {
            this.assertActive();
            return this.guardBody(
              target.pipeThrough(transform, {
                ...options,
                signal: options?.signal
                  ? AbortSignal.any([options.signal, this.controller.signal])
                  : this.controller.signal,
              }),
            );
          };
        if (key === "values" || key === Symbol.asyncIterator)
          return (...args: unknown[]) => {
            const iterator = value.apply(
              target,
              args,
            ) as AsyncIterator<Uint8Array>;
            return new Proxy(iterator, {
              get: (source, method) => {
                const member = Reflect.get(source, method, source);
                if (method === "next")
                  return async (...nextArgs: unknown[]) => {
                    this.assertActive();
                    const result: unknown = await member.apply(
                      source,
                      nextArgs,
                    );
                    this.assertActive();
                    return result;
                  };
                return typeof member === "function"
                  ? member.bind(source)
                  : member;
              },
            });
          };
        if (key === "tee")
          return () => {
            this.assertActive();
            return target.tee().map((stream) => this.guardBody(stream));
          };
        if (typeof value !== "function") return value;
        return value.bind(target);
      },
    });
  }
}
