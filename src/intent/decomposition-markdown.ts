import { NormalizedIntent } from "./intent-types";

export function buildIntentDecompositionMarkdown(input: {
  normalizedIntent: NormalizedIntent;
  sourceId?: string;
}): string {
  const decomposition = input.normalizedIntent.businessIntent.decomposition;
  if (!decomposition || decomposition.objectives.length === 0) {
    return "- None";
  }

  const visibleWorkstreams = decomposition.workstreams.filter(
    (workstream) => !input.sourceId || workstream.sourceIds.includes(input.sourceId)
  );
  if (visibleWorkstreams.length === 0) {
    return "- None";
  }

  const visibleTaskIds = new Set(visibleWorkstreams.flatMap((workstream) => workstream.taskIds));
  const visibleTasks = decomposition.tasks.filter((task) => visibleTaskIds.has(task.id));
  const visibleSubtaskIds = new Set(visibleTasks.flatMap((task) => task.subtaskIds));
  const visibleSubtasks = decomposition.subtasks.filter((subtask) => visibleSubtaskIds.has(subtask.id));
  const visibleVerificationTaskIds = new Set([
    ...visibleTasks.flatMap((task) => task.verificationTaskIds),
    ...visibleSubtasks.flatMap((subtask) => subtask.verificationTaskIds)
  ]);
  const visibleVerificationTasks = decomposition.verificationTasks.filter((task) => visibleVerificationTaskIds.has(task.id));
  const visibleObjectives = decomposition.objectives.filter((objective) =>
    objective.workstreamIds.some((workstreamId) => visibleWorkstreams.some((workstream) => workstream.id === workstreamId))
  );

  const lines: string[] = [];

  for (const objective of visibleObjectives) {
    const objectiveWorkstreams = visibleWorkstreams.filter((workstream) => objective.workstreamIds.includes(workstream.id));
    if (objectiveWorkstreams.length === 0) {
      continue;
    }

    lines.push(`### Objective: ${objective.title}`);
    lines.push(`- Desired outcome: ${objective.desiredOutcome}`);
    lines.push(`- Summary: ${objective.summary}`);
    lines.push("");

    for (const workstream of objectiveWorkstreams) {
      const workstreamTasks = visibleTasks.filter((task) => workstream.taskIds.includes(task.id));

      lines.push(`#### Workstream: ${workstream.title}`);
      lines.push(`- Sources: ${workstream.sourceIds.join(", ")}`);
      lines.push(`- Summary: ${workstream.summary}`);
      lines.push("");

      for (const task of workstreamTasks) {
        const taskSubtasks = visibleSubtasks.filter((subtask) => task.subtaskIds.includes(subtask.id));
        const taskVerificationTitles = visibleVerificationTasks
          .filter((verificationTask) => task.verificationTaskIds.includes(verificationTask.id))
          .map((verificationTask) => verificationTask.title);

        lines.push(`##### Task: ${task.title}`);
        lines.push(`- Summary: ${task.summary}`);
        lines.push(`- Work items: ${task.workItemIds.join(", ") || "none"}`);
        lines.push(`- Verification tasks: ${taskVerificationTitles.join(", ") || "none"}`);

        for (const subtask of taskSubtasks) {
          const subtaskVerificationTitles = visibleVerificationTasks
            .filter((verificationTask) => subtask.verificationTaskIds.includes(verificationTask.id))
            .map((verificationTask) => verificationTask.title);
          lines.push(`###### Subtask: ${subtask.title}`);
          lines.push(`- Work items: ${subtask.workItemIds.join(", ") || "none"}`);
          lines.push(`- Verification tasks: ${subtaskVerificationTitles.join(", ") || "none"}`);
          lines.push(
            `- Depends on: ${subtask.dependsOnSubtaskIds.length > 0 ? subtask.dependsOnSubtaskIds.join(", ") : "none"}`
          );
        }

        lines.push("");
      }
    }
  }

  return lines.join("\n").trim() || "- None";
}