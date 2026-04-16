export const CODE_SURFACE_IDS = [
  "intent-studio",
  "surface-catalog",
  "capture-and-evidence",
  "orchestrator-and-planning",
  "config-and-settings",
  "shared-source"
] as const;

export type CodeSurfaceId = (typeof CODE_SURFACE_IDS)[number];
export type CodeSurfaceConfidence = "high" | "medium" | "low";

export interface CodeSurfaceAlternative {
  id: CodeSurfaceId;
  label: string;
  reason: string;
}

export interface CodeSurfaceSelection {
  sourceId: string;
  id: CodeSurfaceId;
  label: string;
  confidence: CodeSurfaceConfidence;
  rationale: string;
  alternatives: CodeSurfaceAlternative[];
}

const CODE_SURFACE_LABELS: Record<CodeSurfaceId, string> = {
  "intent-studio": "Intent Studio",
  "surface-catalog": "Surface Catalog",
  "capture-and-evidence": "Capture And Evidence",
  "orchestrator-and-planning": "Orchestrator And Planning",
  "config-and-settings": "Config And Settings",
  "shared-source": "Shared Source"
};

const INTENT_STUDIO_KEYWORDS = ["intent studio", "studio screen", "studio page", "studio server"];
const SURFACE_CATALOG_KEYWORDS = [
  "surface catalog",
  "component library",
  "library",
  "catalog page",
  "catalog view",
  "component page",
  "surface frame"
];
const CAPTURE_AND_EVIDENCE_KEYWORDS = [
  "screenshot",
  "capture",
  "baseline",
  "diff",
  "comparison",
  "evidence",
  "manifest",
  "hashes"
];
const ORCHESTRATOR_AND_PLANNING_KEYWORDS = [
  "orchestrator",
  "run-intent",
  "normalize intent",
  "source lane",
  "execution plan",
  "implementation loop",
  "qa verification",
  "planner"
];
const CONFIG_AND_SETTINGS_KEYWORDS = [
  "config",
  "yaml",
  ".yml",
  ".yaml",
  "setting",
  "settings",
  "environment variable",
  "env var"
];
const UI_AFFORDANCE_KEYWORDS = [
  "button",
  "toggle",
  "header",
  "top right",
  "dark mode",
  "theme",
  "screen",
  "page"
];

function includesAnyPhrase(prompt: string, phrases: string[]): boolean {
  return phrases.some((phrase) => prompt.includes(phrase));
}

function buildAlternative(id: CodeSurfaceId, reason: string): CodeSurfaceAlternative {
  return {
    id,
    label: CODE_SURFACE_LABELS[id],
    reason
  };
}

export function getCodeSurfaceLabel(id: CodeSurfaceId): string {
  return CODE_SURFACE_LABELS[id];
}

export function isCodeSurfaceId(value: string | undefined): value is CodeSurfaceId {
  return value !== undefined && CODE_SURFACE_IDS.includes(value as CodeSurfaceId);
}

export function inferCodeSurface(input: {
  prompt: string;
  primarySourceId: string;
  sourceIds: string[];
  hintedCodeSurfaceId?: CodeSurfaceId;
  hintedAlternativeIds?: CodeSurfaceId[];
}): CodeSurfaceSelection {
  const normalizedPrompt = input.prompt.toLowerCase();

  if (input.hintedCodeSurfaceId) {
    const alternativeIds = (input.hintedAlternativeIds ?? []).filter((id) => id !== input.hintedCodeSurfaceId);
    return {
      sourceId: input.primarySourceId,
      id: input.hintedCodeSurfaceId,
      label: getCodeSurfaceLabel(input.hintedCodeSurfaceId),
      confidence: alternativeIds.length > 0 ? "medium" : "high",
      rationale: `Prompt normalization identified ${getCodeSurfaceLabel(input.hintedCodeSurfaceId)} as the most likely code surface within ${input.primarySourceId}.`,
      alternatives: alternativeIds.map((id) => buildAlternative(id, "Prompt normalization kept this as a fallback interpretation."))
    };
  }

  if (includesAnyPhrase(normalizedPrompt, INTENT_STUDIO_KEYWORDS)) {
    return {
      sourceId: input.primarySourceId,
      id: "intent-studio",
      label: getCodeSurfaceLabel("intent-studio"),
      confidence: "high",
      rationale: `The prompt explicitly references Intent Studio inside ${input.primarySourceId}.`,
      alternatives: [buildAlternative("surface-catalog", "The request could still affect the catalog shell around demo surfaces.")]
    };
  }

  if (includesAnyPhrase(normalizedPrompt, SURFACE_CATALOG_KEYWORDS)) {
    return {
      sourceId: input.primarySourceId,
      id: "surface-catalog",
      label: getCodeSurfaceLabel("surface-catalog"),
      confidence: "high",
      rationale: `The prompt points to library or catalog behavior inside ${input.primarySourceId}.`,
      alternatives: [buildAlternative("intent-studio", "The catalog request may also touch the Studio shell if the prompt is using Studio language loosely.")]
    };
  }

  if (includesAnyPhrase(normalizedPrompt, CAPTURE_AND_EVIDENCE_KEYWORDS)) {
    return {
      sourceId: input.primarySourceId,
      id: "capture-and-evidence",
      label: getCodeSurfaceLabel("capture-and-evidence"),
      confidence: "high",
      rationale: `The prompt is centered on screenshots, evidence, or comparison outputs within ${input.primarySourceId}.`,
      alternatives: [buildAlternative("surface-catalog", "Evidence requests can still originate from a surface-catalog change.")]
    };
  }

  if (includesAnyPhrase(normalizedPrompt, ORCHESTRATOR_AND_PLANNING_KEYWORDS)) {
    return {
      sourceId: input.primarySourceId,
      id: "orchestrator-and-planning",
      label: getCodeSurfaceLabel("orchestrator-and-planning"),
      confidence: "high",
      rationale: `The prompt references orchestration or planning flow behavior inside ${input.primarySourceId}.`,
      alternatives: [buildAlternative("shared-source", "Some orchestrator changes may still require broader source updates.")]
    };
  }

  if (includesAnyPhrase(normalizedPrompt, CONFIG_AND_SETTINGS_KEYWORDS)) {
    return {
      sourceId: input.primarySourceId,
      id: "config-and-settings",
      label: getCodeSurfaceLabel("config-and-settings"),
      confidence: "high",
      rationale: `The prompt refers to configuration or settings inside ${input.primarySourceId}.`,
      alternatives: [buildAlternative("shared-source", "Configuration changes can cascade into broader source updates.")]
    };
  }

  if (input.sourceIds.includes("demo-catalog") && includesAnyPhrase(normalizedPrompt, UI_AFFORDANCE_KEYWORDS)) {
    return {
      sourceId: input.primarySourceId,
      id: "shared-source",
      label: getCodeSurfaceLabel("shared-source"),
      confidence: "low",
      rationale: `The prompt suggests a user-facing change in ${input.primarySourceId}, but it does not unambiguously identify which code surface owns it.`,
      alternatives: [
        buildAlternative("intent-studio", "The request may belong to the Studio shell."),
        buildAlternative("surface-catalog", "The request may belong to the catalog rendering surface.")
      ]
    };
  }

  return {
    sourceId: input.primarySourceId,
    id: "shared-source",
    label: getCodeSurfaceLabel("shared-source"),
    confidence: "low",
    rationale: `No specific code surface could be inferred confidently inside ${input.primarySourceId}, so the whole source remains in play.`,
    alternatives: []
  };
}