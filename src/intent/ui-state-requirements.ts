import type { SourceConfig } from "../config/schema";
import {
  PlaywrightSpecArtifact,
  ResolvedUiStateRequirement,
  TDDWorkItem
} from "./intent-types";

type UiStateActivation = SourceConfig["planning"]["uiStates"][number]["activation"][number];

export function describeUiStateActivation(activation: UiStateActivation): string {
  switch (activation.type) {
    case "query-param":
      return `query param '${activation.target ?? "<unspecified>"}'`;
    case "mocked-state":
      return `mocked app state '${activation.target ?? "<unspecified>"}'`;
    case "ui-control":
      return `UI control '${activation.target ?? "<unspecified>"}'`;
    case "environment":
      return `environment variable '${activation.target ?? "<unspecified>"}'`;
    case "seed-data":
      return `seed data '${activation.target ?? "<unspecified>"}'`;
    default:
      return activation.type;
  }
}

export function dedupeUiStateRequirements(
  requirements: readonly ResolvedUiStateRequirement[]
): ResolvedUiStateRequirement[] {
  const unique = new Map<string, ResolvedUiStateRequirement>();

  for (const requirement of requirements) {
    const key = `${requirement.stateId}:${requirement.requestedValue ?? ""}`;
    if (!unique.has(key)) {
      unique.set(key, requirement);
    }
  }

  return Array.from(unique.values());
}

export function collectSpecRequiredUiStates(spec: PlaywrightSpecArtifact): ResolvedUiStateRequirement[] {
  return dedupeUiStateRequirements([
    ...(spec.requiredUiStates ?? []),
    ...spec.checkpoints.flatMap((checkpoint) => checkpoint.requiredUiStates ?? [])
  ]);
}

export function collectWorkItemRequiredUiStates(workItem: TDDWorkItem): ResolvedUiStateRequirement[] {
  return dedupeUiStateRequirements(workItem.playwright.specs.flatMap((spec) => collectSpecRequiredUiStates(spec)));
}

export function formatCompactUiStateList(requirements: readonly ResolvedUiStateRequirement[]): string {
  return dedupeUiStateRequirements(requirements)
    .map((requirement) =>
      requirement.requestedValue
        ? `${requirement.stateId}=${requirement.requestedValue}`
        : requirement.stateId
    )
    .join(", ");
}

export function formatDetailedUiStateRequirement(requirement: ResolvedUiStateRequirement): string {
  const title = requirement.label ?? requirement.stateId;
  const identifier = requirement.requestedValue
    ? `${requirement.stateId}=${requirement.requestedValue}`
    : requirement.stateId;
  const activationSummary =
    requirement.activation.length > 0
      ? requirement.activation.map((activation) => describeUiStateActivation(activation)).join(", ")
      : "no explicit activation";

  return `${title} [${identifier}] via ${activationSummary}. Reason: ${requirement.reason}`;
}