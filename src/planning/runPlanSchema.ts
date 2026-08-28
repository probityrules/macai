import { z } from "zod";
import { TaskModeSchema } from "../config/types.js";

export const GeneratedTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  mode: TaskModeSchema.default("coding"),
  priority: z.number().int().min(1).max(100).default(10),
});

export const GeneratedRunPlanSchema = z.object({
  summary: z.string().optional(),
  hours: z.number().positive().max(24).optional(),
  until: z
    .string()
    .regex(/^\d{1,2}:\d{2}$/)
    .optional(),
  baseBranch: z.string().optional(),
  tasks: z.array(GeneratedTaskSchema).min(1).max(20),
});

export type GeneratedRunPlan = z.infer<typeof GeneratedRunPlanSchema>;

export function extractJsonFromResponse(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    return text.slice(start, end + 1);
  }

  return text.trim();
}

export function parseGeneratedRunPlan(raw: string): GeneratedRunPlan {
  const jsonText = extractJsonFromResponse(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(
      `Failed to parse generated run plan as JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return GeneratedRunPlanSchema.parse(parsed);
}
