import { spawn } from "node:child_process";

const DEFAULT_TEST_GLOB = "src/**/*.test.ts";

function splitArgs(argv: string[]): { runnerArgs: string[]; testTargets: string[] } {
  const runnerArgs: string[] = [];
  const testTargets: string[] = [];

  for (const arg of argv) {
    if (arg.startsWith("-")) {
      runnerArgs.push(arg);
      continue;
    }

    testTargets.push(arg);
  }

  return { runnerArgs, testTargets };
}

function main(): void {
  const tsxCliPath = require.resolve("tsx/cli");
  const { runnerArgs, testTargets } = splitArgs(process.argv.slice(2));
  const selectedTargets = testTargets.length === 0 ? [DEFAULT_TEST_GLOB] : testTargets;

  const child = spawn(`"${process.execPath}"`, [`"${tsxCliPath}"`, "--test", ...runnerArgs, ...selectedTargets], {
    stdio: "inherit",
    shell: true
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 1);
  });

  child.on("error", (error) => {
    console.error(error);
    process.exit(1);
  });
}

main();