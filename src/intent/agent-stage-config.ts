import { AgentConfig } from "../config/schema";

export const AGENT_STAGE_SEQUENCE = [
  "promptNormalization",
  "linearScoping",
  "bddPlanning",
  "tddPlanning",
  "implementation",
  "qaVerification"
] as const;

export type AgentStageId = (typeof AGENT_STAGE_SEQUENCE)[number];

export interface GeminiModelOption {
  id: string;
  label: string;
  description: string;
  recommendedStages: AgentStageId[];
}

export const GEMINI_MODEL_OPTIONS: GeminiModelOption[] = [
  {
    id: "gemini-3",
    label: "Gemini 3",
    description: "Highest-quality Gemini 3 option for deeper planning passes.",
    recommendedStages: ["bddPlanning", "tddPlanning", "implementation", "qaVerification"]
  },
  {
    id: "gemini-3-flash",
    label: "Gemini 3 Flash",
    description: "Fast Gemini 3 option for lightweight prompt interpretation.",
    recommendedStages: ["promptNormalization", "linearScoping"]
  },
  {
    id: "gemini-3.1",
    label: "Gemini 3.1",
    description: "Latest high-reasoning Gemini option for intent planning and refinement.",
    recommendedStages: ["bddPlanning", "tddPlanning", "implementation", "qaVerification"]
  },
  {
    id: "gemini-3.1-flash",
    label: "Gemini 3.1 Flash",
    description: "Latest fast Gemini option for prompt interpretation and bounded extraction.",
    recommendedStages: ["promptNormalization", "linearScoping"]
  }
];

export const AGENT_STAGE_DEFINITIONS: Record<
  AgentStageId,
  {
    id: AgentStageId;
    label: string;
    description: string;
    defaultModel: string;
    defaultEnabled: boolean;
    enabledFlag:
      | "allowPromptNormalization"
      | "allowLinearScoping"
      | "allowBDDPlanning"
      | "allowTDDPlanning"
      | "allowImplementation"
      | "allowQAVerification";
  }
> = {
  promptNormalization: {
    id: "promptNormalization",
    label: "Prompt Interpretation",
    description: "Bound the raw prompt to intent type, source scope, and capture hints before planning.",
    defaultModel: "gemini-3.1-flash",
    defaultEnabled: true,
    enabledFlag: "allowPromptNormalization"
  },
  linearScoping: {
    id: "linearScoping",
    label: "Linear Scoping",
    description: "Shape the work into resumable Linear-owned lanes before execution planning expands.",
    defaultModel: "gemini-3.1-flash",
    defaultEnabled: true,
    enabledFlag: "allowLinearScoping"
  },
  bddPlanning: {
    id: "bddPlanning",
    label: "BDD Planning",
    description: "Refine the business intent, acceptance criteria, and scenarios after prompt interpretation.",
    defaultModel: "gemini-3.1",
    defaultEnabled: true,
    enabledFlag: "allowBDDPlanning"
  },
  tddPlanning: {
    id: "tddPlanning",
    label: "TDD Planning",
    description: "Translate the accepted scenarios into Playwright-first executable test artifacts.",
    defaultModel: "gemini-3.1",
    defaultEnabled: true,
    enabledFlag: "allowTDDPlanning"
  },
  implementation: {
    id: "implementation",
    label: "Implementation",
    description: "Apply the planned changes against the scoped source workspace.",
    defaultModel: "gemini-3.1",
    defaultEnabled: false,
    enabledFlag: "allowImplementation"
  },
  qaVerification: {
    id: "qaVerification",
    label: "QA Verification",
    description: "Verify implementation output, tests, and evidence before completion or retry.",
    defaultModel: "gemini-3.1",
    defaultEnabled: false,
    enabledFlag: "allowQAVerification"
  }
};

export interface RunAgentStageOverride {
  enabled?: boolean;
  provider?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  apiKeyEnv?: string;
  apiVersion?: string;
  fallbackToRules?: boolean;
}

export interface RunAgentConfigOverride {
  stages?: Partial<Record<AgentStageId, RunAgentStageOverride>>;
}

export interface ResolvedAgentStageConfig {
  id: AgentStageId;
  label: string;
  description: string;
  enabled: boolean;
  provider?: string;
  model: string;
  temperature: number;
  maxTokens?: number;
  apiKeyEnv?: string;
  apiVersion?: string;
  fallbackToRules: boolean;
}

export function resolveAgentStageConfig(
  agent: AgentConfig | undefined,
  stageId: AgentStageId
): ResolvedAgentStageConfig {
  const definition = AGENT_STAGE_DEFINITIONS[stageId];
  const stageConfig = agent?.stages?.[stageId] ?? {};

  return {
    id: stageId,
    label: definition.label,
    description: definition.description,
    enabled: stageConfig.enabled ?? (agent?.[definition.enabledFlag] ?? definition.defaultEnabled),
    provider: stageConfig.provider ?? agent?.provider,
    model: stageConfig.model ?? agent?.model ?? definition.defaultModel,
    temperature: stageConfig.temperature ?? agent?.temperature ?? 0.1,
    maxTokens: stageConfig.maxTokens ?? agent?.maxTokens,
    apiKeyEnv: stageConfig.apiKeyEnv ?? agent?.apiKeyEnv,
    apiVersion: stageConfig.apiVersion ?? agent?.apiVersion,
    fallbackToRules: stageConfig.fallbackToRules ?? agent?.fallbackToRules ?? true
  };
}

export function applyAgentOverrides(agent: AgentConfig, overrides?: RunAgentConfigOverride): AgentConfig {
  if (!overrides?.stages) {
    return agent;
  }

  const nextStages = {
    ...agent.stages
  };

  for (const stageId of AGENT_STAGE_SEQUENCE) {
    const stageOverride = overrides.stages[stageId];
    if (!stageOverride) {
      continue;
    }

    nextStages[stageId] = {
      ...(agent.stages?.[stageId] ?? {}),
      ...stageOverride
    };
  }

  return {
    ...agent,
    stages: nextStages
  };
}