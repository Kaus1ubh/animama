import type { BenchConfig } from "../bench-protocol";

/** Engines evaluated from the evaluation root need its served model URL. */
export function requireModelBase(config: BenchConfig): string {
  if (!config.modelBaseUrl) {
    throw new Error(`${config.engine} needs models=<base URL of its files>`);
  }
  return config.modelBaseUrl;
}

async function fetchOk(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} failed: HTTP ${response.status}`);
  return response;
}

export const fetchText = async (url: string) => (await fetchOk(url)).text();

export const fetchJson = async <T>(url: string): Promise<T> =>
  (await fetchOk(url)).json() as Promise<T>;

/**
 * sherpa-onnx `tokens.txt`: one `piece id` pair per line. Split on the last
 * space, since that is the only field separator.
 */
export function parseTokenTable(text: string): string[] {
  const tokens: string[] = [];
  for (const line of text.split("\n")) {
    const separator = line.lastIndexOf(" ");
    if (separator <= 0) continue;
    tokens[Number(line.slice(separator + 1))] = line.slice(0, separator);
  }
  return tokens;
}
