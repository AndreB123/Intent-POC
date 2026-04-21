import { loadConfig } from "../config/load-config";
import { RunIntentOptions } from "../orchestrator/run-intent";

type BuildRuntimeRunIntentOptionsInput = Omit<RunIntentOptions, "publishToLibrary"> & {
  publishToLibrary?: boolean;
};

function normalizeSourceIds(sourceIds?: string[]): string[] | undefined {
  if (!sourceIds?.length) {
    return undefined;
  }

  const normalizedSourceIds = Array.from(
    new Set(sourceIds.map((sourceId) => sourceId.trim()).filter((sourceId) => sourceId.length > 0))
  );

  return normalizedSourceIds.length > 0 ? normalizedSourceIds : undefined;
}

function shouldPublishToTrackedLibrary(input: {
  config: Awaited<ReturnType<typeof loadConfig>>["config"];
  sourceIds: string[];
}): boolean {
  return input.sourceIds.length > 0 && input.sourceIds.every((sourceId) => {
    const sourceConfig = input.config.sources[sourceId];
    if (!sourceConfig) {
      return false;
    }

    return sourceConfig.capture.publishToLibrary || sourceConfig.capture.catalog === "surface-library";
  });
}

export async function buildRuntimeRunIntentOptions(
  input: BuildRuntimeRunIntentOptionsInput
): Promise<RunIntentOptions> {
  const loadedConfig = await loadConfig(input.configPath);
  const sourceIds = normalizeSourceIds(input.sourceIds);
  const effectiveSourceIds = sourceIds ?? [loadedConfig.config.run.sourceId];
  const publishToLibrary =
    input.publishToLibrary
    ?? (shouldPublishToTrackedLibrary({ config: loadedConfig.config, sourceIds: effectiveSourceIds }) ? true : undefined);

  return {
    configPath: input.configPath,
    intent: input.intent,
    sourceIds,
    publishToLibrary,
    agentOverrides: input.agentOverrides,
    resumeIssue: input.resumeIssue,
    dryRun: input.dryRun,
    onEvent: input.onEvent
  };
}