import { SourceConfig } from "../config/schema";

export type GeminiSourceDescriptor = Pick<SourceConfig, "aliases" | "capture" | "planning" | "source">;

export function buildGeminiSourceSummary(availableSources: Record<string, GeminiSourceDescriptor>): string {
  return JSON.stringify(
    Object.entries(availableSources).map(([sourceId, source]) => ({
      sourceId,
      aliases: source.aliases,
      sourceType: source.source.type,
      repoId: source.planning.repoId,
      repoLabel: source.planning.repoLabel,
      role: source.planning.role,
      summary: source.planning.summary,
      notes: source.planning.notes,
      verificationNotes: source.planning.verificationNotes,
      uiStates: source.planning.uiStates.map((uiState) => ({
        id: uiState.id,
        label: uiState.label,
        description: uiState.description,
        activation: uiState.activation,
        verificationStrategies: uiState.verificationStrategies,
        notes: uiState.notes
      })),
      captures: source.capture.items.map((item) => ({
        id: item.id,
        name: item.name,
        path: item.path
      }))
    })),
    null,
    2
  );
}