import { AgentConfig } from "../config/schema";
import { resolveGeminiApiKey } from "./gemini-client";

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
    id: "models/gemini-3.1-flash-lite-preview",
    label: "Gemini 3.1 Flash Lite Preview",
    description: "Repo-verified structured-output default for bounded planning, implementation, and QA.",
    recommendedStages: [...AGENT_STAGE_SEQUENCE]
  },
  {
    id: "models/gemini-3-flash-preview",
    label: "Gemini 3 Flash Preview",
    description: "Faster preview option for prompt interpretation and lighter planning passes.",
    recommendedStages: ["promptNormalization", "linearScoping"]
  },
  {
    id: "models/gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro Preview",
    description: "Higher-latency preview option for deeper planning experiments.",
    recommendedStages: ["bddPlanning", "tddPlanning", "implementation", "qaVerification"]
  },
  {
    id: "models/gemini-3-pro-preview",
    label: "Gemini 3 Pro Preview",
    description: "Alternative deeper reasoning preview option for longer intent passes.",
    recommendedStages: ["bddPlanning", "tddPlanning", "implementation", "qaVerification"]
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
    defaultModel: "models/gemini-3.1-flash-lite-preview",
    defaultEnabled: true,
    enabledFlag: "allowPromptNormalization"
  },
  linearScoping: {
    id: "linearScoping",
    label: "Linear Scoping",
    description: "Shape the work into resumable Linear-owned lanes before execution planning expands.",
    defaultModel: "models/gemini-3.1-flash-lite-preview",
    defaultEnabled: true,
    enabledFlag: "allowLinearScoping"
  },
  bddPlanning: {
    id: "bddPlanning",
    label: "BDD Planning",
    description: "Refine the business intent, acceptance criteria, and scenarios after prompt interpretation.",
    defaultModel: "models/gemini-3.1-flash-lite-preview",
    defaultEnabled: true,
    enabledFlag: "allowBDDPlanning"
  },
  tddPlanning: {
    id: "tddPlanning",
    label: "TDD Planning",
    description: "Translate the accepted scenarios into Playwright-first executable test artifacts.",
    defaultModel: "models/gemini-3.1-flash-lite-preview",
    defaultEnabled: true,
    enabledFlag: "allowTDDPlanning"
  },
  implementation: {
    id: "implementation",
    label: "Implementation",
    description: "Apply the planned changes against the scoped source workspace.",
    defaultModel: "models/gemini-3.1-flash-lite-preview",
    defaultEnabled: false,
    enabledFlag: "allowImplementation"
  },
  qaVerification: {
    id: "qaVerification",
    label: "QA Verification",
    description: "Verify implementation output, tests, and evidence before completion or retry.",
    defaultModel: "models/gemini-3.1-flash-lite-preview",
    defaultEnabled: false,
    enabledFlag: "allowQAVerification"
  }
};

export interface RunAgentStageOverride {
  enabled?: boolean;
  provider?: string;
  model?: string;
  modelFailover?: string[];
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
  modelFailover: string[];
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
    modelFailover: Array.from(
      new Set(
        (stageConfig.modelFailover ?? [])
          .map((modelId) => modelId.trim())
          .filter((modelId) => modelId.length > 0)
      )
    ),
    temperature: stageConfig.temperature ?? agent?.temperature ?? 0.1,
    maxTokens: stageConfig.maxTokens ?? agent?.maxTokens,
    apiKeyEnv: stageConfig.apiKeyEnv ?? agent?.apiKeyEnv,
    apiVersion: stageConfig.apiVersion ?? agent?.apiVersion,
    fallbackToRules: stageConfig.fallbackToRules ?? agent?.fallbackToRules ?? true
  };
}

export function assertImplementationStageReady(stage: ResolvedAgentStageConfig): void {
  if (!stage.enabled) {
    return;
  }

  if (!stage.provider) {
    throw new Error("Implementation stage requires an explicit provider when the stage is enabled.");
  }

  if (stage.provider !== "gemini") {
    throw new Error(`Implementation stage provider '${stage.provider}' is not supported. Supported providers: gemini.`);
  }

  resolveGeminiApiKey({ apiKeyEnv: stage.apiKeyEnv });
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