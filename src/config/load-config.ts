import { promises as fs } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import YAML from "yaml";
import { ZodError } from "zod";
import { AppConfig, configSchema } from "./schema";

export interface LoadedConfig {
  config: AppConfig;
  configPath: string;
  configDir: string;
}

dotenv.config();

function expandEnvPlaceholders(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, envVar: string) => {
      const envValue = process.env[envVar];
      if (envValue === undefined) {
        throw new Error(`Missing required environment variable '${envVar}'.`);
      }

      return envValue;
    });
  }

  if (Array.isArray(value)) {
    return value.map((item) => expandEnvPlaceholders(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, expandEnvPlaceholders(entry)])
    );
  }

  return value;
}

function stripNullValues(value: unknown): unknown {
  if (value === null) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value.map((item) => stripNullValues(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, entry]) => [key, stripNullValues(entry)])
        .filter(([, entry]) => entry !== undefined)
    );
  }

  return value;
}

function resolveControllerRelativePaths(config: AppConfig, configDir: string): AppConfig {
  const resolvedSources = Object.fromEntries(
    Object.entries(config.sources).map(([sourceId, configuredSource]) => {
      const resolvedSource =
        configuredSource.source.type === "local"
          ? { ...configuredSource.source, localPath: path.resolve(configDir, configuredSource.source.localPath) }
          : configuredSource.source;

      return [
        sourceId,
        {
          ...configuredSource,
          source: resolvedSource,
          workspace: {
            ...configuredSource.workspace,
            cloneRoot: path.resolve(configDir, configuredSource.workspace.cloneRoot)
          }
        }
      ];
    })
  ) as AppConfig["sources"];

  return {
    ...config,
    sources: resolvedSources,
    artifacts: {
      ...config.artifacts,
      runRoot: path.resolve(configDir, config.artifacts.runRoot),
      libraryRoot: path.resolve(configDir, config.artifacts.libraryRoot),
      baselineRoot: path.resolve(configDir, config.artifacts.baselineRoot)
    }
  };
}

function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const location = issue.path.length > 0 ? issue.path.join(".") : "<root>";
      return `${location}: ${issue.message}`;
    })
    .join("\n");
}

export async function loadConfig(configPathInput: string): Promise<LoadedConfig> {
  const configPath = path.resolve(configPathInput);
  const configDir = path.dirname(configPath);
  const rawContent = await fs.readFile(configPath, "utf8");
  const rawParsed = YAML.parse(rawContent);
  const expanded = expandEnvPlaceholders(stripNullValues(rawParsed));

  try {
    const parsed = configSchema.parse(expanded);
    const config = resolveControllerRelativePaths(parsed, configDir);
    return { config, configPath, configDir };
  } catch (error) {
    if (error instanceof ZodError) {
      throw new Error(`Configuration validation failed:\n${formatZodError(error)}`);
    }

    throw error;
  }
}