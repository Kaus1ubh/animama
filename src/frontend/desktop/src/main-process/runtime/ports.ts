import { createServer } from "node:net";

/** Preflight never confers listener ownership; the child's bind/readiness remains authoritative. */
async function probeLoopbackPort(port: number): Promise<number> {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("port_unavailable"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

/** First installation and private PostgreSQL may choose an unused ephemeral port. */
export function unusedLoopbackPort(): Promise<number> {
  return probeLoopbackPort(0);
}

/** A saved application origin must fail closed on collision, never silently move. */
export async function assertLoopbackPortAvailable(port: number): Promise<void> {
  await probeLoopbackPort(port);
}
