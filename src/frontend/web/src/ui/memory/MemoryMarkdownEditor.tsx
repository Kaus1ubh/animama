import { useTranslation } from "react-i18next";

import { MemoryCodeEditor } from "@/ui/memory/MemoryCodeEditor";
import { MemoryMarkdownPreview } from "@/ui/memory/MemoryMarkdownPreview";

type MemoryMarkdownEditorProps = {
  value: string;
  onChange: (value: string) => void;
};

/** Retains the identity modal's existing two-column editor/preview layout. */
export function MemoryMarkdownEditor({
  value,
  onChange,
}: MemoryMarkdownEditorProps) {
  const { t } = useTranslation("memory");
  return (
    <div className="grid h-full min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
      <div className="border-border/70 flex h-full min-h-0 flex-col border-b lg:border-r lg:border-b-0">
        <div className="border-border/70 bg-muted/20 text-muted-foreground border-b px-4 py-2 text-xs font-medium tracking-wide uppercase">
          {t("editor.editorHeading")}
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <MemoryCodeEditor value={value} onChange={onChange} />
        </div>
      </div>
      <div className="flex h-full min-h-0 flex-col">
        <div className="border-border/70 bg-muted/20 text-muted-foreground border-b px-4 py-2 text-xs font-medium tracking-wide uppercase">
          {t("shared.preview")}
        </div>
        <MemoryMarkdownPreview
          value={value}
          className="min-h-0 flex-1 overflow-auto p-6"
        />
      </div>
    </div>
  );
}
