import path from "node:path";
import { ensureDirectory } from "../shared/fs";
import { startBackgroundCommand, runCommand } from "../shared/process";
import { ResolvedSourceWorkspace } from "../target/resolve-target";

export interface RunningApp {
  pid: number | undefined;
  logPath: string;
  stop: () => Promise<void>;
}

export async function startApp(
  workspace: ResolvedSourceWorkspace,
  logFilePath: string
): Promise<RunningApp> {
  await ensureDirectory(path.dirname(logFilePath));

  const appRunner = await startBackgroundCommand(workspace.source.app.startCommand, {
    cwd: workspace.appDir,
    env: workspace.source.app.env,
    logFilePath
  });

  return {
    pid: appRunner.pid,
    logPath: logFilePath,
    async stop(): Promise<void> {
      if (workspace.source.app.stopCommand) {
        try {
          await runCommand(workspace.source.app.stopCommand, {
            cwd: workspace.appDir,
            env: workspace.source.app.env,
            timeoutMs: 30_000
          });
          return;
        } catch {
          await appRunner.stop();
          return;
        }
      }

      await appRunner.stop();
    }
  };
}