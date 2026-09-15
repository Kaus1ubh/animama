import { request } from "node:http";

const origin = new URL(
  process.env.ANIMAMA_PUBLIC_ORIGIN ?? "http://localhost:3000",
);

/** Probe Vite through its real Host boundary and the unchanged FastAPI proxy. */
async function check(path) {
  await new Promise((resolve, reject) => {
    const probe = request(
      {
        hostname: "127.0.0.1",
        port: 5173,
        path,
        headers: { Host: origin.host },
      },
      (response) => {
        response.resume();
        response.once("error", reject);
        response.once("end", () =>
          response.statusCode === 200
            ? resolve()
            : reject(new Error("Not ready")),
        );
      },
    );
    const deadline = setTimeout(
      () => probe.destroy(new Error("Readiness deadline exceeded")),
      2000,
    );
    probe.once("close", () => clearTimeout(deadline));
    probe.once("error", reject);
    probe.end();
  });
}

try {
  await check("/health");
  await check("/");
} catch {
  process.exitCode = 1;
}
