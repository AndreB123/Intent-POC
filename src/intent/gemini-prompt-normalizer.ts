import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { AgentConfig, RunMode, SourceConfig } from "../config/schema";
import { IntentType } from "./intent-types";

export type PromptNormalizerSourceDescriptor = Pick<SourceConfig, "aliases" | "capture" | "planning" | "source">;

export interface GeminiPromptNormalizationInput {
  rawPrompt: string;
  runMode: RunMode;
  defaultSourceId: string;
  availableSources: Record<string, PromptNormalizerSourceDescriptor>;
  agent: AgentConfig;
}

export interface PromptNormalizationHints {
  intentType?: IntentType;
  desiredOutcome?: string;
  sourceIds?: string[];
  captureIdsBySource?: Record<string, string[]>;
  warnings?: string[];
}

const promptNormalizationHintsSchema: z.ZodType<PromptNormalizationHints> = z.object({
  intentType: z.enum(["baseline", "compare", "approve-baseline", "refresh-library"]).optional(),
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
      enum: ["baseline", "compare", "approve-baseline", "refresh-library"]
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
    "The supported intentType values are baseline, compare, approve-baseline, and refresh-library.",
    `Configured default source id: ${input.defaultSourceId}`,
    `Configured fallback run mode: ${input.runMode}`,
    "Configured sources:",
    buildSourceSummary(input.availableSources),
    "User prompt:",
    input.rawPrompt
  ].join("\n\n");
}

function resolveGeminiApiKey(agent: AgentConfig): { apiKey: string; envName: string } {
  const candidateEnvNames = Array.from(
    new Set([agent.apiKeyEnv, "GEMINI_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"].filter((value): value is string => Boolean(value)))
  );

  for (const envName of candidateEnvNames) {
    const apiKey = process.env[envName];
    if (apiKey) {
      return { apiKey, envName };
    }
  }

  throw new Error(
    `Gemini prompt normalization requires one of these environment variables: ${candidateEnvNames.join(", ")}.`
  );
}

export async function normalizePromptWithGemini(
  input: GeminiPromptNormalizationInput
): Promise<PromptNormalizationHints> {
  const { apiKey } = resolveGeminiApiKey(input.agent);

  const ai = new GoogleGenAI({
    apiKey,
    apiVersion: input.agent.apiVersion
  });

  const response = await ai.models.generateContent({
    model: input.agent.model ?? "gemini-2.5-flash",
    contents: buildNormalizationPrompt(input),
    config: {
      temperature: input.agent.temperature,
      maxOutputTokens: input.agent.maxTokens,
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