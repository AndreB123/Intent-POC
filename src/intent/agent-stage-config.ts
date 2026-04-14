import { AgentConfig } from "../config/schema";

export const AGENT_STAGE_SEQUENCE = ["promptNormalization", "intentPlanning"] as const;

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
    recommendedStages: ["intentPlanning"]
  },
  {
    id: "gemini-3-flash",
    label: "Gemini 3 Flash",
    description: "Fast Gemini 3 option for lightweight prompt interpretation.",
    recommendedStages: ["promptNormalization"]
  },
  {
    id: "gemini-3.1",
    label: "Gemini 3.1",
    description: "Latest high-reasoning Gemini option for intent planning and refinement.",
    recommendedStages: ["intentPlanning"]
  },
  {
    id: "gemini-3.1-flash",
    label: "Gemini 3.1 Flash",
    description: "Latest fast Gemini option for prompt interpretation and bounded extraction.",
    recommendedStages: ["promptNormalization"]
  }
];

export const AGENT_STAGE_DEFINITIONS: Record<
  AgentStageId,
  {
    id: AgentStageId;
    label: string;
    description: string;
    defaultModel: string;
    enabledFlag: "allowPromptNormalization" | "allowIntentPlanning";
  }
> = {
  promptNormalization: {
    id: "promptNormalization",
    label: "Prompt Interpretation",
    description: "Bound the raw prompt to intent type, source scope, and capture hints before planning.",
    defaultModel: "gemini-3.1-flash",
    enabledFlag: "allowPromptNormalization"
  },
  intentPlanning: {
    id: "intentPlanning",
    label: "Intent Planning",
    description: "Refine the business intent, acceptance criteria, and BDD plan after bounded normalization.",
    defaultModel: "gemini-3.1",
    enabledFlag: "allowIntentPlanning"
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
    enabled: stageConfig.enabled ?? (agent?.[definition.enabledFlag] ?? true),
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