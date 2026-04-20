import { z } from "zod";
import { SourceConfig } from "../config/schema";
import { ResolvedAgentStageConfig } from "./agent-stage-config";
import { CODE_SURFACE_IDS, CodeSurfaceId } from "./code-surface";
import { createGeminiClient } from "./gemini-client";

export type PromptNormalizerSourceDescriptor = Pick<SourceConfig, "aliases" | "capture" | "planning" | "source">;

export interface GeminiPromptNormalizationInput {
  rawPrompt: string;
  defaultSourceId: string;
  availableSources: Record<string, PromptNormalizerSourceDescriptor>;
  requestedSourceIds?: string[];
  stage: ResolvedAgentStageConfig;
}

export interface PromptNormalizationHints {
  desiredOutcome?: string;
  sourceIds?: string[];
  codeSurfaceId?: CodeSurfaceId;
  codeSurfaceAlternatives?: CodeSurfaceId[];
  captureIdsBySource?: Record<string, string[]>;
  warnings?: string[];
}

const promptNormalizationFieldSchemas = {
  desiredOutcome: z.string().min(1),
  sourceIds: z.array(z.string().min(1)),
  codeSurfaceId: z.enum(CODE_SURFACE_IDS),
  codeSurfaceAlternatives: z.array(z.enum(CODE_SURFACE_IDS)),
  captureIdsBySource: z.record(z.array(z.string().min(1))),
  warnings: z.array(z.string().min(1))
} satisfies Record<keyof PromptNormalizationHints, z.ZodTypeAny>;

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
    case "warnings":
      return "Gemini prompt normalization returned invalid warning entries, so they were ignored.";
  }
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
    warnings: {
      type: "array",
      items: {
        type: "string"
      }
    }
  }
} as const;

function buildSourceSummary(availableSources: Record<string, PromptNormalizerSourceDescriptor>): string {
  const summaries = Object.entries(availableSources).map(([sourceId, source]) => ({
    sourceId,
    aliases: source.aliases,
    sourceType: source.source.type,
    repoId: source.planning.repoId,
    repoLabel: source.planning.repoLabel,
    role: source.planning.role,
    captures: source.capture.items.map((item) => ({
      id: item.id,
      name: item.name,
      path: item.path
    }))
  }));

  return JSON.stringify(summaries, null, 2);
}

function buildNormalizationPrompt(input: GeminiPromptNormalizationInput): string {
  return [
    "You are selecting bounded planning hints for an intent-driven visual evidence runner.",
    "The runner now uses a single workflow model: every prompt is treated as a behavior-change attempt.",
    "Visual screenshot verification, tracked screenshots, and code validation are downstream verification strategies inside that single workflow.",
    "Return only JSON that matches the provided schema.",
    "Do not invent source ids or capture ids.",
    "If you are unsure about a field, omit it instead of guessing.",
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
    buildSourceSummary(input.availableSources),
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