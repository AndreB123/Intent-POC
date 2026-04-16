import { z } from "zod";
import { SourceConfig } from "../config/schema";
import { ResolvedAgentStageConfig } from "./agent-stage-config";
import { createGeminiClient } from "./gemini-client";
import { IntentType } from "./intent-types";

export type PromptNormalizerSourceDescriptor = Pick<SourceConfig, "aliases" | "capture" | "planning" | "source">;

export interface GeminiPromptNormalizationInput {
  rawPrompt: string;
  defaultSourceId: string;
  availableSources: Record<string, PromptNormalizerSourceDescriptor>;
  requestedSourceIds?: string[];
  stage: ResolvedAgentStageConfig;
}

export interface PromptNormalizationHints {
  intentType?: IntentType;
  desiredOutcome?: string;
  sourceIds?: string[];
  captureIdsBySource?: Record<string, string[]>;
  warnings?: string[];
}

const promptNormalizationHintsSchema: z.ZodType<PromptNormalizationHints> = z.object({
  intentType: z.enum(["capture-evidence", "refresh-library"]).optional(),
  desiredOutcome: z.string().min(1).optional(),
  sourceIds: z.array(z.string().min(1)).optional(),
  captureIdsBySource: z.record(z.array(z.string().min(1))).optional(),
  warnings: z.array(z.string().min(1)).optional()
});

const promptNormalizationResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    intentType: {
      type: "string",
      enum: ["capture-evidence", "refresh-library"]
    },
    desiredOutcome: {
      type: "string"
    },
    sourceIds: {
      type: "array",
      items: {
        type: "string"
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
    "Return only JSON that matches the provided schema.",
    "Do not invent source ids or capture ids.",
    "If you are unsure about a field, omit it instead of guessing.",
    "Choose sourceIds only from the configured source list.",
    "Choose captureIdsBySource[sourceId] only from that source's configured capture ids.",
    ...(input.requestedSourceIds && input.requestedSourceIds.length > 0
      ? [
          `Requested source scope: ${input.requestedSourceIds.join(", ")}`,
          "Keep any returned sourceIds inside the requested source scope."
        ]
      : []),
    "The supported intentType values are capture-evidence and refresh-library.",
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

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Gemini prompt normalization returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return promptNormalizationHintsSchema.parse(parsed);
}