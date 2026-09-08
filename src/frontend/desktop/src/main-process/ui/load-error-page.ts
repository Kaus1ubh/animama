function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function createLoadErrorHtml(
  targetUrl: string,
  message: string,
): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Anima</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family:
          Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
          "Segoe UI", sans-serif;
      }

      body {
        align-items: center;
        background: Canvas;
        color: CanvasText;
        display: flex;
        margin: 0;
        min-height: 100vh;
      }

      main {
        margin: 0 auto;
        max-width: 680px;
        padding: 48px 32px;
      }

      h1 {
        font-size: 24px;
        font-weight: 650;
        margin: 0 0 12px;
      }

      p {
        line-height: 1.5;
        margin: 0 0 16px;
      }

      code {
        background: color-mix(in srgb, CanvasText 8%, transparent);
        border-radius: 6px;
        font-family:
          ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono",
          monospace;
        font-size: 0.92em;
        padding: 2px 5px;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Anima could not load</h1>
      <p>The desktop shell could not reach <code>${escapeHtml(targetUrl)}</code>.</p>
      <p>${escapeHtml(message)}</p>
      <p>Start the Vite web app or set <code>ANIMAMA_DESKTOP_WEB_URL</code> to a reachable hosted frontend, then relaunch Animama.</p>
    </main>
  </body>
</html>`;
}
