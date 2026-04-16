import { spawn } from "node:child_process";
import { splitTestRunnerArgs } from "./test-target-args";

export interface TestStackSelection {
  command: string;
  args: string[];
}

export function selectTestStackCommand(argv: string[]): TestStackSelection {
  const { runnerArgs, testTargets } = splitTestRunnerArgs(argv);

  if (testTargets.length > 0) {
    return {
      command: "npm",
      args: ["run", "test:code", "--", ...runnerArgs, ...testTargets]
    };
  }

  return {
    command: "npm",
    args: ["run", "test:stack:all", "--", ...runnerArgs]
  };
}

function main(): void {
  const selection = selectTestStackCommand(process.argv.slice(2));
  const child = spawn(selection.command, selection.args, {
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

if (process.argv[1] && /run-test-stack\.(ts|js)$/.test(process.argv[1])) {
  main();
}