"use client";

import { markdown } from "@codemirror/lang-markdown";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";

type MemoryCodeEditorProps = {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  onCreateEditor?: (view: EditorView) => void;
  ariaLabel?: string;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
  placeholder?: string;
  indentWithTab?: boolean;
};

const memoryCodeEditorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--card)",
    color: "var(--foreground)",
    fontSize: "0.9375rem",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    height: "100%",
    overflow: "auto",
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    lineHeight: "1.7",
  },
  ".cm-content": {
    minHeight: "100%",
    padding: "1.5rem 1.75rem",
    caretColor: "var(--foreground)",
  },
  ".cm-line": { padding: "0" },
  ".cm-activeLine": {
    backgroundColor: "color-mix(in srgb, var(--muted) 24%, transparent)",
  },
  ".cm-cursor": { borderLeftColor: "var(--foreground)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--primary) 35%, transparent)",
  },
});

/** Editor-only CodeMirror surface shared by the workspace and identity modal. */
export function MemoryCodeEditor({
  value,
  onChange,
  readOnly = false,
  onCreateEditor,
  ariaLabel,
  ariaInvalid,
  ariaDescribedBy,
  placeholder,
  indentWithTab = true,
}: MemoryCodeEditorProps) {
  return (
    <CodeMirror
      className="h-full"
      value={value}
      height="100%"
      editable={!readOnly}
      onCreateEditor={onCreateEditor}
      placeholder={placeholder}
      indentWithTab={indentWithTab}
      basicSetup={{
        foldGutter: false,
        highlightActiveLineGutter: false,
        lineNumbers: false,
      }}
      extensions={[
        markdown(),
        EditorView.lineWrapping,
        memoryCodeEditorTheme,
        EditorView.contentAttributes.of({
          ...(ariaLabel
            ? {
                "aria-label": ariaLabel,
                role: "textbox",
                "aria-multiline": "true",
              }
            : {}),
          ...(ariaInvalid ? { "aria-invalid": "true" } : {}),
          ...(ariaDescribedBy ? { "aria-describedby": ariaDescribedBy } : {}),
        }),
      ]}
      // The token-based theme above supplies colours for both app modes; the
      // package's built-in light theme would force a white editor in dark mode.
      theme="none"
      onChange={onChange}
    />
  );
}
