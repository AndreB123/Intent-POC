import { RunMode } from "../config/schema";

export type IntentType = RunMode | "refresh-library";
export type NormalizationSource = "llm" | "rules" | "fallback";
export type ExecutionStrategy = "single-source" | "multi-source";
export type ExecutionDestinationType =
  | "controller"
  | "linear"
  | "source-workspace"
  | "github"
  | "documentation"
  | "business-process";
export type ExecutionDestinationStatus = "active" | "planned" | "inactive";
export type ExecutionToolType =
  | "intent-planning"
  | "screenshot"
  | "comparison"
  | "reporting"
  | "linear-publishing";

export interface AcceptanceCriterion {
  id: string;
  description: string;
  origin: "prompt" | "inferred";
}

export interface BDDScenario {
  id: string;
  title: string;
  goal: string;
  given: string[];
  when: string[];
  then: string[];
  applicableSourceIds: string[];
}

export interface TDDWorkItem {
  id: string;
  title: string;
  description: string;
  scenarioIds: string[];
  sourceIds: string[];
  userVisibleOutcome: string;
  verification: string;
}

export interface BusinessIntent {
  statement: string;
  desiredOutcome: string;
  acceptanceCriteria: AcceptanceCriterion[];
  scenarios: BDDScenario[];
  workItems: TDDWorkItem[];
}

export interface ExecutionSourcePlan {
  sourceId: string;
  selectionReason: string;
  runMode: RunMode;
  captureScope: {
    mode: "all" | "subset";
    captureIds: string[];
  };
  warnings: string[];
}

export interface ExecutionDestinationPlan {
  id: string;
  type: ExecutionDestinationType;
  label: string;
  status: ExecutionDestinationStatus;
  reason: string;
  details: string[];
}

export interface ExecutionToolPlan {
  id: string;
  type: ExecutionToolType;
  label: string;
  enabled: boolean;
  reason: string;
  details: string[];
}

export interface ExecutionPlan {
  primarySourceId: string;
  sources: ExecutionSourcePlan[];
  destinations: ExecutionDestinationPlan[];
  tools: ExecutionToolPlan[];
  orchestrationStrategy: ExecutionStrategy;
  reviewNotes: string[];
}

export interface NormalizedIntent {
  intentId: string;
  receivedAt: string;
  rawPrompt: string;
  summary: string;
  intentType: IntentType;
  businessIntent: BusinessIntent;
  executionPlan: ExecutionPlan;
  sourceId: string;
  captureScope: {
    mode: "all" | "subset";
    captureIds: string[];
  };
  artifacts: {
    requireScreenshots: true;
    requireManifest: true;
    requireHashes: true;
    requireComparison: boolean;
  };
  linear: {
    createIssue: boolean;
    issueTitle: string;
  };
  execution: {
    runMode: RunMode;
    continueOnCaptureError: boolean;
  };
  normalizationMeta: {
    source: NormalizationSource;
    warnings: string[];
  };
}