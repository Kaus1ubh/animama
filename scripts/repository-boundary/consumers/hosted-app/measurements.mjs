/** Observe real browser resources without substituting workers, PCM or playback. */
import { execFileSync } from "node:child_process";

export async function observeBrowser(context, browser) {
    const browserCdp = await browser.newBrowserCDPSession();
    let peakRssKiB = 0;
    const rss = async () => {
        const { processInfo } = await browserCdp.send(
            "SystemInfo.getProcessInfo",
        );
        const ids = processInfo
            .map((process) => process.id)
            .filter(Number.isSafeInteger);
        // Match the recorded local baseline: sum RSS for this browser's processes.
        const result = execFileSync("ps", ["-o", "rss=", "-p", ids.join(",")], {
            encoding: "utf8",
        });
        const current = result
            .trim()
            .split(/\s+/)
            .reduce((sum, value) => sum + Number(value), 0);
        peakRssKiB = Math.max(peakRssKiB, current);
        return current;
    };
    let sampling = false;
    let closed = false;
    const samplingErrors = [];
    const timer = setInterval(async () => {
        if (sampling) return;
        sampling = true;
        try {
            await rss();
        } catch (error) {
            if (!closed) samplingErrors.push(error.message);
        } finally {
            sampling = false;
        }
    }, 1000);
    timer.unref();
    await context.addInitScript(() => {
        const resources = (window.artifactResources = {
            workers: [],
            audio: [],
            worklets: [],
            created: [],
            revoked: [],
            chunks: [],
            peakHeap: 0,
        });
        const NativeWorker = window.Worker,
            NativeAudio = window.AudioContext;
        const NativeWorklet = window.AudioWorkletNode;
        window.Worker = class extends NativeWorker {
            constructor(url, options) {
                super(url, options);
                const record = {
                    url: String(url),
                    terminated: false,
                    messages: [],
                    errors: [],
                    requests: [],
                };
                resources.workers.push(record);
                this.addEventListener("message", (event) => {
                    record.messages.push(event.data.type);
                    if (event.data.type === "error")
                        record.errors.push(
                            String(event.data.error ?? event.data.message),
                        );
                    if (event.data.type === "audio_chunk")
                        resources.chunks.push({
                            samples: event.data.data?.length ?? 0,
                            time: performance.now(),
                        });
                });
                const send = this.postMessage.bind(this),
                    terminate = this.terminate.bind(this);
                this.postMessage = (message, ...args) => {
                    record.requests.push({
                        type: message.type,
                        time: performance.now(),
                    });
                    return send(message, ...args);
                };
                this.terminate = () => {
                    record.terminated = true;
                    terminate();
                };
            }
        };
        window.AudioContext = class extends NativeAudio {
            constructor(options) {
                super(options);
                resources.audio.push(this);
            }
        };
        window.AudioWorkletNode = class extends NativeWorklet {
            constructor(...args) {
                super(...args);
                const record = {
                    name: args[1],
                    inputSamples: 0,
                    nonzeroSamples: 0,
                    messages: [],
                };
                resources.worklets.push(record);
                const send = this.port.postMessage.bind(this.port);
                this.port.postMessage = (message, ...transfer) => {
                    if (
                        message.type === "audio" &&
                        message.data instanceof Float32Array
                    ) {
                        record.inputSamples += message.data.length;
                        record.nonzeroSamples += message.data.filter(
                            (sample) => Number.isFinite(sample) && sample !== 0,
                        ).length;
                    }
                    return send(message, ...transfer);
                };
                this.port.addEventListener("message", (event) =>
                    record.messages.push(event.data.type),
                );
                this.port.start();
            }
        };
        const create = URL.createObjectURL.bind(URL),
            revoke = URL.revokeObjectURL.bind(URL);
        URL.createObjectURL = (value) => {
            const url = create(value);
            resources.created.push(url);
            return url;
        };
        URL.revokeObjectURL = (url) => {
            resources.revoked.push(url);
            revoke(url);
        };
        setInterval(() => {
            resources.peakHeap = Math.max(
                resources.peakHeap,
                performance.memory?.usedJSHeapSize ?? 0,
            );
        }, 100);
    });
    return {
        browserVersion: browser.version(),
        snapshot: async (page, cdp) => {
            const heap = await cdp.send("Runtime.getHeapUsage");
            const resources = await page.evaluate(() => ({
                timings: performance
                    .getEntriesByType("mark")
                    .map((mark) => ({ name: mark.name, time: mark.startTime })),
                peakHeap: window.artifactResources.peakHeap,
                workers: window.artifactResources.workers.map((worker) => ({
                    ...worker,
                })),
                audio: window.artifactResources.audio.map(
                    (audio) => audio.state,
                ),
                worklets: window.artifactResources.worklets,
                objectUrls: {
                    created: window.artifactResources.created.length,
                    revoked: window.artifactResources.revoked.length,
                },
            }));
            return {
                heapUsedBytes: heap.usedSize,
                browserRssKiB: await rss(),
                peakBrowserRssKiB: peakRssKiB,
                samplingErrors: [...samplingErrors],
                ...resources,
            };
        },
        close: () => {
            closed = true;
            clearInterval(timer);
        },
    };
}
