#!/usr/bin/env node

import { Command, InvalidArgumentError } from "commander";
import { serveDemoApp } from "./demo-app/serve-demo-app";
import { runIntent } from "./orchestrator/run-intent";
import { buildRuntimeRunIntentOptions } from "./runtime/build-runtime-run-intent-options";
import { log } from "./shared/log";

const program = new Command();

function parsePort(value: string): number {
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port <= 0) {
    throw new InvalidArgumentError("Port must be a positive integer.");
  }

  return port;
}

function parseVariant(value: string): "v1" | "v2" {
  if (value === "v1" || value === "v2") {
    return value;
  }

  throw new InvalidArgumentError("Variant must be 'v1' or 'v2'.");
}

function parseSourceScope(value: string, previous: string[]): string[] {
  const sourceIds = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (sourceIds.length === 0) {
    throw new InvalidArgumentError("Source scope must include at least one source id.");
  }

  return Array.from(new Set([...previous, ...sourceIds]));
}

program
  .name("intent-poc")
  .description("Intent-driven visual evidence proof of concept controller.")
  .version("0.1.0");

program
  .command("run")
  .description("Execute a configured intent run against a source app.")
  .requiredOption("-c, --config <path>", "Path to the YAML config file.")
  .option("-i, --intent <text>", "Free-text intent prompt.")
  .option(
    "-s, --source <id>",
    "Add a source id to the requested planning scope. Repeat the flag or pass a comma-separated list.",
    parseSourceScope,
    [] as string[]
  )
  .option("--resume-issue <id-or-key>", "Attach the run to an existing Linear parent issue by id or identifier.")
  .option("--dry-run", "Validate config and intent normalization without launching the source app.")
  .action(async (options) => {
    try {
      await runIntent(await buildRuntimeRunIntentOptions({
        configPath: options.config,
        intent: options.intent,
        sourceIds: options.source.length > 0 ? options.source : undefined,
        resumeIssue: options.resumeIssue,
        dryRun: options.dryRun
      }));
    } catch (error) {
      log.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  });

program
  .command("demo")
  .description("Start the built-in Intent Studio UI with the demo library and live run status.")
  .option(
    "-c, --config <path>",
    "Config file used by the studio when starting runs.",
    "./intent-poc.local-no-linear.yaml"
  )
  .option("--host <host>", "Host to bind the demo server.", "127.0.0.1")
  .option("-p, --port <port>", "Port to bind the demo server.", parsePort, 6010)
  .option("-v, --variant <variant>", "Initial demo variant: v1 or v2.", parseVariant, "v1")
  .action(async (options) => {
    try {
      await serveDemoApp({
        configPath: options.config,
        host: options.host,
        port: options.port,
        variant: options.variant
      });
    } catch (error) {
      log.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  });

void program.parseAsync(process.argv);