import { createWriteStream } from "node:fs";
import { spawn } from "node:child_process";

export interface CommandOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export interface CommandResult {
  command: string;
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CommandResultWithStatus extends CommandResult {
  timedOut: boolean;
}

export interface RunningCommand {
  pid: number | undefined;
  stop: () => Promise<void>;
  waitForExit: () => Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>;
}

export async function runCommandAllowFailure(command: string, options: CommandOptions): Promise<CommandResultWithStatus> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      shell: true
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timeoutId = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
        }, options.timeoutMs)
      : undefined;

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      reject(error);
    });

    child.on("close", (code) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      resolve({
        command,
        cwd: options.cwd,
        stdout,
        stderr,
        exitCode: code ?? -1,
        timedOut
      });
    });
  });
}

export async function runCommand(command: string, options: CommandOptions): Promise<CommandResult> {
  const result = await runCommandAllowFailure(command, options);

  if (result.timedOut) {
    throw new Error(`Command timed out after ${options.timeoutMs}ms: ${command}`);
  }

  if (result.exitCode !== 0) {
    throw new Error(`Command failed (${result.exitCode}) in ${options.cwd}: ${command}\n${result.stderr || result.stdout}`);
  }

  return result;
}

export async function startBackgroundCommand(
  command: string,
  options: CommandOptions & { logFilePath: string }
): Promise<RunningCommand> {
  const logStream = createWriteStream(options.logFilePath, { flags: "a" });
  let exited = false;
  let resolveExit: ((value: { exitCode: number | null; signal: NodeJS.Signals | null }) => void) | undefined;
  const exitPromise = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    resolveExit = resolve;
  });
  const child = spawn(command, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    shell: true,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk: Buffer | string) => {
    logStream.write(chunk.toString());
  });

  child.stderr.on("data", (chunk: Buffer | string) => {
    logStream.write(chunk.toString());
  });

  child.on("close", (code, signal) => {
    exited = true;
    resolveExit?.({ exitCode: code, signal });
    logStream.end();
  });

  return {
    pid: child.pid,
    waitForExit: () => exitPromise,
    async stop(): Promise<void> {
      if (!child.pid || child.killed || exited) {
        return;
      }

      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        try {
          child.kill("SIGTERM");
        } catch {
          return;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 1_000));

      if (!child.killed) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          try {
            child.kill("SIGKILL");
          } catch {
            return;
          }
        }
      }

      await exitPromise;
    }
  };
}