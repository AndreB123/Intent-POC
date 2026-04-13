import { ResolvedSourceWorkspace, ResolvedTargetWorkspace } from "./resolve-target";
import { runCommand } from "../shared/process";

export async function prepareSourceWorkspace(workspace: ResolvedSourceWorkspace): Promise<void> {
  const installCommand = workspace.source.workspace.installCommand;
  if (!installCommand) {
    return;
  }

  await runCommand(installCommand, {
    cwd: workspace.rootDir,
    env: workspace.source.workspace.env,
    timeoutMs: workspace.source.workspace.installTimeoutMs
  });
}

export async function prepareWorkspace(workspace: ResolvedTargetWorkspace): Promise<void> {
  await prepareSourceWorkspace(workspace);
}