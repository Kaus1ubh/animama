import type { EditorView } from "@uiw/react-codemirror";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/ui/components/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/components/tabs";
import { MemoryCodeEditor } from "@/ui/memory/MemoryCodeEditor";
import { MemoryMarkdownPreview } from "@/ui/memory/MemoryMarkdownPreview";
import type { CreateAnimaDraft } from "./createAnimaDraft";

/** One plain Markdown document with Write/Preview and explicit suggestion consent. */
export function CreateAnimaIdentityStep({
  draft,
  suggestion,
  errors,
  readOnly = false,
  onChange,
}: {
  draft: CreateAnimaDraft;
  suggestion: string | null;
  errors: string[];
  readOnly?: boolean;
  onChange: (patch: Pick<CreateAnimaDraft, "identity_markdown">) => void;
}) {
  const { t } = useTranslation("create");
  const editor = useRef<EditorView | null>(null);
  const [tab, setTab] = useState("write");
  const [suggestionOpen, setSuggestionOpen] = useState(false);

  const applySuggestion = (append: boolean) => {
    if (readOnly || !suggestion) return;
    const insert = `${append && draft.identity_markdown ? "\n\n" : ""}${suggestion}`;
    const from = append ? draft.identity_markdown.length : 0;
    const to = draft.identity_markdown.length;
    setTab("write");
    if (editor.current) {
      editor.current.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + insert.length },
        scrollIntoView: true,
      });
      requestAnimationFrame(() => editor.current?.focus());
    } else {
      onChange({
        identity_markdown: append
          ? `${draft.identity_markdown}${insert}`
          : insert,
      });
    }
    setSuggestionOpen(false);
  };

  return (
    <div id="creation-identity" tabIndex={-1} className="space-y-4">
      <p className="text-sm font-medium">
        {t("identityStep.title")}{" "}
        <span className="text-muted-foreground">
          {t("identityStep.required")}
        </span>
      </p>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="write">{t("identityStep.write")}</TabsTrigger>
          <TabsTrigger value="preview">{t("identityStep.preview")}</TabsTrigger>
        </TabsList>
        <TabsContent
          value="write"
          forceMount
          className="data-[state=inactive]:hidden"
        >
          <div className="focus-within:ring-ring h-[390px] min-w-0 overflow-hidden rounded-xl border focus-within:ring-2">
            <MemoryCodeEditor
              value={draft.identity_markdown}
              readOnly={readOnly}
              onChange={(identity_markdown) => onChange({ identity_markdown })}
              onCreateEditor={(view) => {
                editor.current = view;
              }}
              ariaLabel={t("identityStep.editorLabel")}
              ariaInvalid={errors.includes("/identity_markdown")}
              indentWithTab={false}
              placeholder={t("identityStep.placeholder")}
            />
          </div>
        </TabsContent>
        <TabsContent value="preview">
          <MemoryMarkdownPreview
            value={draft.identity_markdown}
            emptyText={t("identityStep.previewEmpty")}
            className="min-h-[390px] overflow-auto rounded-xl border p-5"
          />
        </TabsContent>
      </Tabs>
      {suggestion ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setSuggestionOpen(true)}
        >
          {t("identityStep.useSuggestion")}
        </Button>
      ) : null}
      <Dialog open={suggestionOpen} onOpenChange={setSuggestionOpen}>
        <DialogContent>
          <DialogTitle>{t("identityStep.suggestion.title")}</DialogTitle>
          <DialogDescription>
            {t("identityStep.suggestion.description")}
          </DialogDescription>
          <div className="max-h-48 overflow-auto text-sm whitespace-pre-wrap">
            {suggestion}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSuggestionOpen(false)}>
              {t("actions.cancel")}
            </Button>
            <Button variant="outline" onClick={() => applySuggestion(true)}>
              {t("identityStep.suggestion.append")}
            </Button>
            <Button onClick={() => applySuggestion(false)}>
              {t("identityStep.suggestion.replace")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
