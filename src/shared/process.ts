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

export interface RunningCommand {
  pid: number | undefined;
  stop: () => Promise<void>;
}

export async function runCommand(command: string, options: CommandOptions): Promise<CommandResult> {
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

      const result: CommandResult = {
        command,
        cwd: options.cwd,
        stdout,
        stderr,
        exitCode: code ?? -1
      };

      if (timedOut) {
        reject(new Error(`Command timed out after ${options.timeoutMs}ms: ${command}`));
        return;
      }

      if ((code ?? -1) !== 0) {
        reject(
          new Error(
            `Command failed (${code ?? -1}) in ${options.cwd}: ${command}\n${stderr || stdout}`
          )
        );
        return;
      }

      resolve(result);
    });
  });
}

export async function startBackgroundCommand(
  command: string,
  options: CommandOptions & { logFilePath: string }
): Promise<RunningCommand> {
  const logStream = createWriteStream(options.logFilePath, { flags: "a" });
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

  child.on("close", () => {
    logStream.end();
  });

  return {
    pid: child.pid,
    async stop(): Promise<void> {
      if (!child.pid || child.killed) {
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
    }
  };
}