import type {
  ParticleVFXEditorValidationIssue,
  ParticleVFXEmitterDraft,
} from "@/lib/avatar/particle-vfx/editor/types";

/** Retain the affected emitter or field when moving issues into the header. */
export function particleVFXValidationMessages(
  issues: readonly ParticleVFXEditorValidationIssue[],
  emitters: readonly Pick<ParticleVFXEmitterDraft, "path" | "name">[],
): string[] {
  return issues.map((issue) => {
    const emitter = emitters.find((entry) => entry.path === issue.target);
    const target = emitter?.name ?? issue.target.replace(/^emitter:/, "");
    return `${target}: ${issue.message}`;
  });
}
