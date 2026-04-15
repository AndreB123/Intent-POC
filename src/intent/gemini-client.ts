import { GoogleGenAI } from "@google/genai";

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