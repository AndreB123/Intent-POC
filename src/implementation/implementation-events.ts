import type { ExecuteImplementationStageInput, RunIntentEvent } from "../orchestrator/run-intent";

export function emitImplementationEvent(
  input: Pick<ExecuteImplementationStageInput, "options" | "sourcePlan" | "attemptNumber">,
  message: string,
  details?: unknown,
  level: RunIntentEvent["level"] = "info"
): void {
  input.options.onEvent?.({
    timestamp: new Date().toISOString(),
    level,
    phase: "implementation",
    message,
    details: {
      sourceId: input.sourcePlan.sourceId,
      attemptNumber: input.attemptNumber,
      ...(details && typeof details === "object" ? (details as Record<string, unknown>) : details ? { value: details } : {})
    }
  });
}