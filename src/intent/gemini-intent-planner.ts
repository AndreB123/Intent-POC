import { z } from "zod";
import { ResolvedAgentStageConfig } from "./agent-stage-config";
import { createGeminiClient } from "./gemini-client";
import { PromptNormalizerSourceDescriptor } from "./gemini-prompt-normalizer";
import { buildGeminiSourceSummary } from "./gemini-source-summary";

export interface GeminiIntentPlanningInput {
  rawPrompt: string;
  sourceIds: string[];
  requestedSourceIds?: string[];
  availableSources: Record<string, PromptNormalizerSourceDescriptor>;
  draftPlan: {
    statement: string;
    desiredOutcome: string;
    acceptanceCriteria: Array<{
      description: string;
      origin: "prompt" | "inferred";
    }>;
    scenarios: Array<{
      title: string;
      goal: string;
      given: string[];
      when: string[];
      then: string[];
      applicableSourceIds: string[];
    }>;
  };
  stage: ResolvedAgentStageConfig;
}

export interface GeminiIntentPlanningRefinement {
  statement?: string;
  desiredOutcome?: string;
  acceptanceCriteria?: Array<{
    description: string;
  }>;
  scenarios?: Array<{
    title: string;
    goal: string;
    given: string[];
    when: string[];
    then: string[];
    applicableSourceIds?: string[];
  }>;
  stepMapping?: Record<string, string>;
  reversionState?: Record<string, unknown>;
  warnings?: string[];
}

const planningRefinementSchema: z.ZodType<GeminiIntentPlanningRefinement> = z.object({
  statement: z.string().min(1).optional(),
  desiredOutcome: z.string().min(1).optional(),
  acceptanceCriteria: z
    .array(
      z.object({
        description: z.string().min(1)
      })
    )
    .optional(),
  scenarios: z
    .array(
      z.object({
        title: z.string().min(1),
        goal: z.string().min(1),
        given: z.array(z.string().min(1)).min(1),
        when: z.array(z.string().min(1)).min(1),
        then: z.array(z.string().min(1)).min(1),
        applicableSourceIds: z.array(z.string().min(1)).optional()
      })
    )
    .optional(),
  stepMapping: z.record(z.string()).optional(),
  reversionState: z.record(z.unknown()).optional(),
  warnings: z.array(z.string().min(1)).optional()
});

const planningRefinementResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    statement: { type: "string" },
    desiredOutcome: { type: "string" },
    acceptanceCriteria: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          description: { type: "string" }
        },
        required: ["description"]
      }
    },
    scenarios: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          goal: { type: "string" },
          given: { type: "array", items: { type: "string" } },
          when: { type: "array", items: { type: "string" } },
          then: { type: "array", items: { type: "string" } },
          applicableSourceIds: { type: "array", items: { type: "string" } }
        },
        required: ["title", "goal", "given", "when", "then"]
      }
    },
    stepMapping: { type: "object", additionalProperties: { type: "string" } },
    reversionState: { type: "object" },
    warnings: {
      type: "array",
      items: { type: "string" }
    }
  }
} as const;

function buildPlanningPrompt(input: GeminiIntentPlanningInput): string {
  return [
    "You are refining a bounded intent-driven development plan for a single behavior-change workflow.",
    "Return only JSON that matches the provided schema.",
    "Do not invent source ids, capture ids, destinations, or tools.",
    "The user prompt may already be a reviewed IDD draft. Treat its stated context, scope, boundaries, baseline, and minimum success as authoritative.",
    "You may rewrite the business statement, desired outcome, acceptance criteria, and scenarios to make the plan clearer and more execution-ready.",
    "Keep all scenarios within the provided source ids.",
    "If you are unsure, omit the field instead of guessing.",
    "Keep desiredOutcome and downstream plan details specific to the reviewed behavior change. Avoid generic packaging language.",
    "Every prompt is a behavior-change attempt. Use screenshots, mocked-state checks, or code validation only as verification strategies for that change.",
    "Explicitly map execution steps and define state reversion requirements for the intent lifecycle.",
    "The response must include 'stepMapping' (a record of step IDs to descriptions) and 'reversionState' (a record of state keys to initial values) to support lifecycle-aware execution.",
    `Selected source ids: ${input.sourceIds.join(", ")}`,
    ...(input.requestedSourceIds && input.requestedSourceIds.length > 0
      ? [`Requested source scope: ${input.requestedSourceIds.join(", ")}`]
      : []),
    "Available sources:",
    buildGeminiSourceSummary(input.availableSources),
    "Current draft plan:",
    JSON.stringify(input.draftPlan, null, 2),
    "User prompt:",
    input.rawPrompt
  ].join("\n\n");
}

export async function refineIntentPlanWithGemini(
  input: GeminiIntentPlanningInput
): Promise<GeminiIntentPlanningRefinement> {
  const ai = createGeminiClient({
    apiKeyEnv: input.stage.apiKeyEnv,
    apiVersion: input.stage.apiVersion
  });

  const response = await ai.models.generateContent({
    model: input.stage.model,
    contents: buildPlanningPrompt(input),
    config: {
      temperature: input.stage.temperature,
      maxOutputTokens: input.stage.maxTokens,
      responseMimeType: "application/json",
      responseJsonSchema: planningRefinementResponseJsonSchema
    }
  });

  const text = response.text?.trim();
  if (!text) {
    throw new Error("Gemini intent planning returned an empty response.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Gemini intent planning returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return planningRefinementSchema.parse(parsed);
}