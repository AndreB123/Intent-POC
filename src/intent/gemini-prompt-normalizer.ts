import { z } from "zod";
import { ResolvedAgentStageConfig } from "./agent-stage-config";
import { CODE_SURFACE_IDS, CodeSurfaceId } from "./code-surface";
import { createGeminiClient } from "./gemini-client";
import { buildGeminiSourceSummary, GeminiSourceDescriptor } from "./gemini-source-summary";
import type { PlanningScopingDetails, ScopingContextPack } from "./intent-types";

export type PromptNormalizerSourceDescriptor = GeminiSourceDescriptor;

export interface GeminiPromptNormalizationInput {
  rawPrompt: string;
  defaultSourceId: string;
  availableSources: Record<string, PromptNormalizerSourceDescriptor>;
  requestedSourceIds?: string[];
  scopingContext?: ScopingContextPack;
  stage: ResolvedAgentStageConfig;
}

export interface PromptNormalizationHints {
  desiredOutcome?: string;
  sourceIds?: string[];
  codeSurfaceId?: CodeSurfaceId;
  codeSurfaceAlternatives?: CodeSurfaceId[];
  captureIdsBySource?: Record<string, string[]>;
  scopingDetails?: PlanningScopingDetails;
  warnings?: string[];
}

const planningScopingDetailSections = [
  "repoContext",
  "sourceScope",
  "adaptiveBoundaries",
  "minimumSuccess",
  "baseline",
  "verificationObligations"
] satisfies Array<keyof PlanningScopingDetails>;

const promptNormalizationFieldSchemas = {
  desiredOutcome: z.string().min(1),
  sourceIds: z.array(z.string().min(1)),
  codeSurfaceId: z.enum(CODE_SURFACE_IDS),
  codeSurfaceAlternatives: z.array(z.enum(CODE_SURFACE_IDS)),
  captureIdsBySource: z.record(z.array(z.string().min(1))),
  scopingDetails: z.record(z.unknown()),
  warnings: z.array(z.string().min(1))
} satisfies Record<keyof PromptNormalizationHints, z.ZodTypeAny>;

const scopingDetailsSectionSchema = z.array(z.string().min(1));

function dedupeValues(values: string[]): string[] {
  return Array.from(new Set(values));
}

function buildInvalidHintWarning(fieldName: keyof PromptNormalizationHints): string {
  switch (fieldName) {
    case "desiredOutcome":
      return "Gemini prompt normalization returned an invalid desiredOutcome hint, so it was ignored.";
    case "sourceIds":
      return "Gemini prompt normalization returned an invalid sourceIds hint, so it was ignored.";
    case "codeSurfaceId":
      return "Gemini prompt normalization returned an invalid codeSurfaceId hint, so it was ignored.";
    case "codeSurfaceAlternatives":
      return "Gemini prompt normalization returned invalid codeSurfaceAlternatives hints, so they were ignored.";
    case "captureIdsBySource":
      return "Gemini prompt normalization returned an invalid captureIdsBySource hint, so it was ignored.";
    case "scopingDetails":
      return "Gemini prompt normalization returned an invalid scopingDetails hint, so it was ignored.";
    case "warnings":
      return "Gemini prompt normalization returned invalid warning entries, so they were ignored.";
  }
}

function buildInvalidScopingDetailsWarning(sectionName: keyof PlanningScopingDetails): string {
  return `Gemini prompt normalization returned invalid scopingDetails.${sectionName} hints, so they were ignored.`;
}

function parseScopingDetails(rawValue: unknown): {
  scopingDetails?: PlanningScopingDetails;
  warnings: string[];
} {
  if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
    return {
      warnings: [buildInvalidHintWarning("scopingDetails")]
    };
  }

  const rawSections = rawValue as Partial<Record<keyof PlanningScopingDetails, unknown>>;
  const parsedSections: Partial<PlanningScopingDetails> = {};
  const warnings: string[] = [];

  for (const sectionName of planningScopingDetailSections) {
    const rawSection = rawSections[sectionName];
    if (rawSection === undefined) {
      continue;
    }

    const parseResult = scopingDetailsSectionSchema.safeParse(rawSection);
    if (!parseResult.success) {
      warnings.push(buildInvalidScopingDetailsWarning(sectionName));
      continue;
    }

    parsedSections[sectionName] = parseResult.data;
  }

  return {
    scopingDetails: Object.keys(parsedSections).length > 0 ? parsedSections : undefined,
    warnings
  };
}

export function parsePromptNormalizationHintsResponse(text: string): PromptNormalizationHints {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Gemini prompt normalization returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Gemini prompt normalization returned invalid JSON: expected an object response.");
  }

  const rawHints = parsed as Partial<Record<keyof PromptNormalizationHints, unknown>>;
  const parsedHints: Partial<PromptNormalizationHints> = {};
  const parserWarnings: string[] = [];

  for (const fieldName of Object.keys(promptNormalizationFieldSchemas) as Array<keyof PromptNormalizationHints>) {
    const rawValue = rawHints[fieldName];
    if (rawValue === undefined) {
      continue;
    }

    if (fieldName === "scopingDetails") {
      const { scopingDetails, warnings } = parseScopingDetails(rawValue);
      if (scopingDetails) {
        parsedHints.scopingDetails = scopingDetails;
      }
      parserWarnings.push(...warnings);
      continue;
    }

    const parseResult = promptNormalizationFieldSchemas[fieldName].safeParse(rawValue);
    if (!parseResult.success) {
      parserWarnings.push(buildInvalidHintWarning(fieldName));
      continue;
    }

    (parsedHints as Record<keyof PromptNormalizationHints, unknown>)[fieldName] = parseResult.data;
  }

  const combinedWarnings = dedupeValues([...(parsedHints.warnings ?? []), ...parserWarnings]);
  if (combinedWarnings.length > 0) {
    parsedHints.warnings = combinedWarnings;
  }

  return parsedHints;
}

const promptNormalizationResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    desiredOutcome: {
      type: "string"
    },
    sourceIds: {
      type: "array",
      items: {
        type: "string"
      }
    },
    codeSurfaceId: {
      type: "string",
      enum: [...CODE_SURFACE_IDS]
    },
    codeSurfaceAlternatives: {
      type: "array",
      items: {
        type: "string",
        enum: [...CODE_SURFACE_IDS]
      }
    },
    captureIdsBySource: {
      type: "object",
      additionalProperties: {
        type: "array",
        items: {
          type: "string"
        }
      }
    },
    scopingDetails: {
      type: "object",
      additionalProperties: false,
      properties: {
        repoContext: {
          type: "array",
          items: {
            type: "string"
          }
        },
        sourceScope: {
          type: "array",
          items: {
            type: "string"
          }
        },
        adaptiveBoundaries: {
          type: "array",
          items: {
            type: "string"
          }
        },
        minimumSuccess: {
          type: "array",
          items: {
            type: "string"
          }
        },
        baseline: {
          type: "array",
          items: {
            type: "string"
          }
        },
        verificationObligations: {
          type: "array",
          items: {
            type: "string"
          }
        }
      }
    },
    warnings: {
      type: "array",
      items: {
        type: "string"
      }
    }
  }
} as const;

function buildNormalizationPrompt(input: GeminiPromptNormalizationInput): string {
  return [
    "You are selecting bounded planning hints for an intent-driven visual evidence runner.",
    "The runner now uses a single workflow model: every prompt is treated as a behavior-change attempt.",
    "Visual screenshot verification, tracked screenshots, and code validation are downstream verification strategies inside that single workflow.",
    "The user prompt may already be a reviewed IDD draft with explicit sections for context, scope, boundaries, baseline, and minimum success. Treat that reviewed draft as authoritative instead of collapsing it into generic workflow language.",
    "Return only JSON that matches the provided schema.",
    "Do not invent source ids or capture ids.",
    "If you are unsure about a field, omit it instead of guessing.",
    "When you infer desiredOutcome, keep it specific to the requested behavior and selected source scope. Avoid generic repo-wide packaging language.",
    "When you return scopingDetails, keep each entry short, concrete, and grounded in the provided scoping context pack.",
    "Use scopingDetails only for the first-click scoping preview sections: repoContext, sourceScope, adaptiveBoundaries, minimumSuccess, baseline, and verificationObligations.",
    "Do not duplicate every fallback statement. Prefer details that add prompt-specific context the deterministic draft may not already say.",
    "Choose sourceIds only from the configured source list.",
    `Choose codeSurfaceId only from: ${CODE_SURFACE_IDS.join(", ")}.`,
    "Choose captureIdsBySource[sourceId] only from that source's configured capture ids.",
    ...(input.requestedSourceIds && input.requestedSourceIds.length > 0
      ? [
          `Requested source scope: ${input.requestedSourceIds.join(", ")}`,
          "Keep any returned sourceIds inside the requested source scope."
        ]
      : []),
    `Configured default source id: ${input.defaultSourceId}`,
    "Configured sources:",
    buildGeminiSourceSummary(input.availableSources),
    ...(input.scopingContext
      ? [
          "Relevant scoping context pack:",
          JSON.stringify(input.scopingContext, null, 2),
          "Use the scoping context pack to narrow source and code-surface hints. Do not restate unrelated repo metadata that is absent from the pack."
        ]
      : []),
    "User prompt:",
    input.rawPrompt
  ].join("\n\n");
}

export async function normalizePromptWithGemini(
  input: GeminiPromptNormalizationInput
): Promise<PromptNormalizationHints> {
  const ai = createGeminiClient({
    apiKeyEnv: input.stage.apiKeyEnv,
    apiVersion: input.stage.apiVersion
  });

  const response = await ai.models.generateContent({
    model: input.stage.model,
    contents: buildNormalizationPrompt(input),
    config: {
      temperature: input.stage.temperature,
      maxOutputTokens: input.stage.maxTokens,
      responseMimeType: "application/json",
      responseJsonSchema: promptNormalizationResponseJsonSchema
    }
  });

  const text = response.text?.trim();
  if (!text) {
    throw new Error("Gemini prompt normalization returned an empty response.");
  }

  return parsePromptNormalizationHintsResponse(text);
}