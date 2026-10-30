import type { FunnelStepType } from "@/lib/funnel-flow";
import type { PageDocument } from "@/lib/funnel-page-document";

/**
 * Client-safe part of the step template picker (「更換模板」／新增步驟). It must
 * not import the template registry (`funnel-template-gallery.ts`, every
 * template's build code): the browser only receives these options, and reads a
 * template's full document through a server action when it is previewed or applied.
 */
export type StepTemplateOption = {
  id: string;
  name: string;
  description: string;
  category: string;
  /** Step types the gallery offers this template for (the goal is fixed per funnel). */
  stepTypes: FunnelStepType[];
  /** First sections of the template, enough for the card thumbnail. */
  thumbnail: PageDocument;
};

/** Options offered for one step type, in gallery order (the server list is already in that order). */
export function filterStepTemplateOptions(options: readonly StepTemplateOption[], stepType: FunnelStepType): StepTemplateOption[] {
  return options.filter((option) => option.stepTypes.includes(stepType));
}
