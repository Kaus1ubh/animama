/**
 * Copy text to the clipboard from a click handler.
 *
 * Prefers the async Clipboard API. The desktop shell's permission handler
 * allows only microphone media, which can deny `clipboard-sanitized-write`, so
 * a rejected write falls back to copying a selected off-screen textarea. That
 * relies on the click's transient user activation still being live (about 5 s
 * in Chromium), which covers the short awaits before it. Returns whether
 * either method succeeded.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fall through to the selection-based copy.
  }
  const previousFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  // Inside a modal dialog, focus outside it is pulled back by the focus trap,
  // which would drop the selection; keep the textarea within the dialog.
  const container = previousFocus?.closest("[role=dialog]") ?? document.body;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.cssText = "position:fixed;top:-1000px;left:-1000px;opacity:0";
  container.appendChild(textarea);
  try {
    textarea.select();
    // execCommand can report success with an empty selection (e.g. if focus
    // was moved away), so require the selection to be the text.
    const selected =
      textarea.selectionStart === 0 && textarea.selectionEnd === text.length;
    return selected && document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
    previousFocus?.focus({ preventScroll: true });
  }
}
