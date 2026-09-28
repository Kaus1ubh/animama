"use client";

import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";

import { markdown } from "@codemirror/lang-markdown";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";

import "./memory-markdown.css";

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

/** Markdown syntax has its own palette; ordinary prose retains the app foreground. */
const memoryMarkdownHighlight = HighlightStyle.define([
  { tag: tags.heading, color: "var(--memory-link)", fontWeight: "600" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  {
    tag: [tags.link, tags.url],
    color: "var(--memory-link)",
    textDecoration: "underline",
    textUnderlineOffset: "3px",
  },
  { tag: [tags.monospace, tags.labelName], color: "var(--memory-code)" },
  {
    tag: [tags.quote, tags.comment],
    color: "var(--memory-marker)",
    fontStyle: "italic",
  },
  // Markers stay readable but subordinate to the content they delimit.
  {
    tag: [tags.processingInstruction, tags.contentSeparator],
    color: "var(--memory-marker)",
    fontWeight: "400",
    textDecoration: "none",
  },
]);

const memoryCodeEditorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--card)",
    color: "var(--foreground)",
    fontSize: "0.875rem",
    fontWeight: "400",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    height: "100%",
    overflow: "auto",
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    lineHeight: "1.6",
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
      className="memory-markdown-colors h-full"
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
        syntaxHighlighting(memoryMarkdownHighlight),
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
