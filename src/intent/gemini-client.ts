import { GoogleGenAI } from "@google/genai";

interface GeminiModelFailoverInput<T> {
  contextLabel: string;
  primaryModel: string;
  modelFailover?: string[];
  invoke: (model: string) => Promise<T>;
}

interface GeminiModelFailoverAttempt {
  model: string;
  message: string;
}

export interface GeminiModelFailoverResult<T> {
  value: T;
  selectedModel: string;
  attemptedModels: string[];
  failedAttempts: GeminiModelFailoverAttempt[];
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function isGeminiTransientError(error: unknown): boolean {
  const normalized = normalizeErrorMessage(error).toLowerCase();

  return [
    "status\":\"unavailable\"",
    " unavailable",
    "resource_exhausted",
    "high demand",
    "too many requests",
    "rate limit",
    "status\":503",
    "status\":429",
    " code\":503",
    " code\":429",
    "deadline_exceeded"
  ].some((needle) => normalized.includes(needle));
}

export async function runGeminiModelFailover<T>(input: GeminiModelFailoverInput<T>): Promise<GeminiModelFailoverResult<T>> {
  const candidates = Array.from(
    new Set([input.primaryModel, ...(input.modelFailover ?? [])].map((modelId) => modelId.trim()).filter((modelId) => modelId.length > 0))
  );

  if (candidates.length === 0) {
    throw new Error(`${input.contextLabel} requires at least one configured Gemini model.`);
  }

  const attemptedModels: string[] = [];
  const failedAttempts: GeminiModelFailoverAttempt[] = [];

  for (let index = 0; index < candidates.length; index += 1) {
    const model = candidates[index]!;
    attemptedModels.push(model);

    try {
      const value = await input.invoke(model);
      return {
        value,
        selectedModel: model,
        attemptedModels,
        failedAttempts
      };
    } catch (error) {
      const message = normalizeErrorMessage(error);
      const transient = isGeminiTransientError(error);
      failedAttempts.push({ model, message });

      if (!transient) {
        throw new Error(`${input.contextLabel} failed on model '${model}': ${message}`);
      }

      if (index === candidates.length - 1) {
        throw new Error(
          `${input.contextLabel} failed after transient Gemini provider saturation across models [${attemptedModels.join(", ")}]: ${message}`
        );
      }
    }
  }

  throw new Error(`${input.contextLabel} failed before any Gemini model attempts completed.`);
}

export function resolveGeminiApiKey(input: { apiKeyEnv?: string }): { apiKey: string; envName: string } {
  const candidateEnvNames = Array.from(
    new Set([input.apiKeyEnv, "GEMINI_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"].filter((value): value is string => Boolean(value)))
  );

  for (const envName of candidateEnvNames) {
    const apiKey = process.env[envName];
    if (apiKey) {
      return { apiKey, envName };
    }
  }

  throw new Error(`Gemini access requires one of these environment variables: ${candidateEnvNames.join(", ")}.`);
}

export function createGeminiClient(input: { apiKeyEnv?: string; apiVersion?: string }): GoogleGenAI {
  const { apiKey } = resolveGeminiApiKey(input);

  return new GoogleGenAI({
    apiKey,
    apiVersion: input.apiVersion
  });
}