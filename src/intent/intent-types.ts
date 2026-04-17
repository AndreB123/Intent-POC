import type { AgentStageId } from "./agent-stage-config";
import type { CodeSurfaceSelection } from "./code-surface";

export type IntentType = "capture-evidence" | "refresh-library" | "change-behavior";
export type NormalizationSource = "llm" | "rules" | "fallback";
export type AgentStageSource = NormalizationSource | "skipped";
export type ExecutionStrategy = "single-source" | "multi-source";
export type RepoContextStatus = "selected" | "candidate";
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
  | "linear-scoping"
  | "playwright-tdd"
  | "screenshot"
  | "environment-deployment"
  | "implementation"
  | "qa-verification"
  | "reporting"
  | "linear-publishing";

export type IntentLifecycleStatus = "planned" | "executing" | "verified" | "reverted";

export type PlaywrightCheckpointAction =
  | "goto"
  | "click"
  | "fill"
  | "assert-visible"
  | "assert-hidden"
  | "assert-below"
  | "mock-studio-state"
  | "assert-attribute-contains";

export interface PlaywrightCheckpoint {
  id: string;
  label: string;
  action: PlaywrightCheckpointAction;
  assertion: string;
  screenshotId: string;
  path?: string;
  target?: string;
  value?: string;
  captureId?: string;
  locator?: string;
  referenceTarget?: string;
  attributeName?: string;
  expectedSubstring?: string;
  waitForSelector?: string;
  waitUntil?: "load" | "domcontentloaded" | "networkidle";
  mockStudioState?: Record<string, unknown>;
}

export interface WorkItemExecutionPlan {
  order: number;
  dependsOnWorkItemIds: string[];
  stepMapping?: Record<string, string>;
  reversionState?: Record<string, unknown>;
}

export interface PlaywrightSpecArtifact {
  framework: "playwright";
  sourceId: string;
  relativeSpecPath: string;
  suiteName: string;
  testName: string;
  scenarioIds: string[];
  checkpoints: PlaywrightCheckpoint[];
}

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
  type: "playwright-spec";
  title: string;
  description: string;
  scenarioIds: string[];
  sourceIds: string[];
  userVisibleOutcome: string;
  verification: string;
  execution: WorkItemExecutionPlan;
  playwright: {
    generatedBy: "rules" | "llm";
    specs: PlaywrightSpecArtifact[];
  };
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

export interface RepoContextCandidate {
  repoId: string;
  label: string;
  role?: string;
  sourceIds: string[];
  selectionStatus: RepoContextStatus;
  reason: string;
  summary?: string;
  sourceTypes: Array<"local" | "git">;
  locations: string[];
  refs: string[];
  notes: string[];
  captureCount: number;
}

export interface PlannerManagedSection {
  id: string;
  title: string;
  scope: "business" | "source";
  sourceId?: string;
  summary: string;
}

export interface PlanningResumeTarget {
  mode: "new" | "resume-explicit";
  issueReference?: string;
}

export interface PlanningContext {
  repoCandidates: RepoContextCandidate[];
  plannerSections: PlannerManagedSection[];
  reviewNotes: string[];
  linearPlan: PlanningResumeTarget;
}

export interface AgentStageMeta {
  stageId: AgentStageId;
  label: string;
  description: string;
  provider?: string;
  model?: string;
  status: "skipped" | "completed" | "fallback";
  source: AgentStageSource;
  warnings: string[];
}

export interface NormalizedIntent {
  intentId: string;
  receivedAt: string;
  rawPrompt: string;
  summary: string;
  intentType: IntentType;
  codeSurface?: CodeSurfaceSelection;
  businessIntent: BusinessIntent;
  planning: PlanningContext;
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
  };
  linear: {
    createIssue: boolean;
    issueTitle: string;
  };
  execution: {
    continueOnCaptureError: boolean;
  };
  normalizationMeta: {
    source: NormalizationSource;
    warnings: string[];
    stages: AgentStageMeta[];
  };
}