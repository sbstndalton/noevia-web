import { isChatGenerationModel } from './model-kind';
import { isResident } from './model-residency';
import type { InstalledModel, Project } from './types';

/** #1829: what the chat side panel's Model line shows, and where it came from. */
export type InspectorModel =
  | { kind: 'answered' | 'selected' | 'loaded'; model: string }
  | { kind: 'auto' }
  | { kind: 'none' };


/**
 * The model that answered the last turn (from the reply's own stream metadata) wins. With no reply yet:
 * the Auto summary when the chat is on Auto, else the chat's selected model, else a loaded chat model.
 * An embedding, reranking or system model (Laya, Kev, sidecars) is never offered, whichever source names it.
 */
export function pickInspectorModel(input: {
  replyModel?: string | null;
  project: Pick<Project, 'model' | 'routing'> | null;
  models: readonly InstalledModel[];
}): InspectorModel {
  const { replyModel, project, models } = input;
  // Labels come from the installed list, so a model whose name does not say "embed" is still excluded by its label.
  const usable = (name: string | null | undefined): name is string => !!name && isChatGenerationModel(name, models.find((m) => m.name === name)?.labels ?? []);
  if (usable(replyModel)) return { kind: 'answered', model: replyModel };
  if (project?.routing === 'auto') return { kind: 'auto' };
  if (usable(project?.model)) return { kind: 'selected', model: project!.model! };
  const chat = models.filter((m) => !m.missingFile && isChatGenerationModel(m.name, m.labels));
  const loaded = chat.find(isResident) ?? chat.find((m) => m.loaded);
  return loaded ? { kind: 'loaded', model: loaded.name } : { kind: 'none' };
}
