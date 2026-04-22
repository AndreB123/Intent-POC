import type { AgentStageId } from "./agent-stage-config";
import type { CodeSurfaceConfidence, CodeSurfaceId, CodeSurfaceSelection } from "./code-surface";
import type { SourceConfig } from "../config/schema";

export type IntentType = "change-behavior";
export type IntentPlanningDepth = "scoping" | "full";
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

export interface ResolvedUiStateRequirement {
  stateId: SourceConfig["planning"]["uiStates"][number]["id"];
  label?: string;
  description: string;
  requestedValue?: string;
  activation: SourceConfig["planning"]["uiStates"][number]["activation"];
  verificationStrategies: string[];
  notes: string[];
  reason: string;
}

export interface PlaywrightCheckpoint {
  id: string;
  label: string;
  action: PlaywrightCheckpointAction;
  assertion: string;
  screenshotId: string;
  timeoutMs?: number;
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
  requiredUiStates?: ResolvedUiStateRequirement[];
}

export interface WorkItemExecutionPlan {
  order: number;
  dependsOnWorkItemIds: string[];
  objectiveId?: string;
  workstreamId?: string;
  taskId?: string;
  subtaskId?: string;
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
  requiredUiStates?: ResolvedUiStateRequirement[];
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

export type WorkItemVerificationMode =
  | "tracked-playwright"
  | "mocked-state-playwright"
  | "targeted-code-validation";

export interface TDDWorkItem {
  id: string;
  type: "playwright-spec" | "code-validation";
  verificationMode: WorkItemVerificationMode;
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

export interface IntentSubtask {
  id: string;
  title: string;
  summary: string;
  scenarioIds: string[];
  sourceIds: string[];
  workItemIds: string[];
  verificationTaskIds: string[];
  dependsOnSubtaskIds: string[];
}

export interface IntentTask {
  id: string;
  title: string;
  summary: string;
  sourceIds: string[];
  scenarioIds: string[];
  workItemIds: string[];
  subtaskIds: string[];
  verificationTaskIds: string[];
}

export interface IntentWorkstream {
  id: string;
  title: string;
  summary: string;
  sourceIds: string[];
  taskIds: string[];
}

export interface IntentObjective {
  id: string;
  title: string;
  summary: string;
  desiredOutcome: string;
  workstreamIds: string[];
}

export interface IntentVerificationTask {
  id: string;
  title: string;
  summary: string;
  sourceIds: string[];
  workItemIds: string[];
}

export interface IntentDecomposition {
  objectives: IntentObjective[];
  workstreams: IntentWorkstream[];
  tasks: IntentTask[];
  subtasks: IntentSubtask[];
  verificationTasks: IntentVerificationTask[];
}

export interface BusinessIntent {
  statement: string;
  desiredOutcome: string;
  acceptanceCriteria: AcceptanceCriterion[];
  scenarios: BDDScenario[];
  workItems: TDDWorkItem[];
  decomposition?: IntentDecomposition;
}

export interface ExecutionSourcePlan {
  sourceId: string;
  selectionReason: string;
  captureScope: {
    mode: "all" | "subset";
    captureIds: string[];
  };
  warnings: string[];
  uiStateRequirements?: ResolvedUiStateRequirement[];
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

export interface ScopingContextSourceMatch {
  sourceId: string;
  matchedTerms: string[];
  reason: string;
}

export interface ScopingContextSurfaceHint {
  sourceId: string;
  id: CodeSurfaceId;
  label: string;
  confidence: CodeSurfaceConfidence;
  rationale: string;
  matchedTerms: string[];
  primaryPaths: string[];
  adjacentPaths: string[];
}

export interface ScopingContextPathHint {
  sourceId: string;
  path: string;
  reason: string;
}

export interface ScopingContextUiStateHint {
  sourceId: string;
  stateId: SourceConfig["planning"]["uiStates"][number]["id"];
  label?: string;
  reason: string;
  verificationStrategies: string[];
  notes: string[];
}

export interface ScopingContextVerificationHint {
  sourceId: string;
  note: string;
  reason: string;
}

export interface ScopingContextRepoNoteHint {
  sourceId: string;
  note: string;
  reason: string;
}

export interface ScopingContextRepoMemoryHint {
  memoryId: string;
  title: string;
  sourcePath: string;
  note: string;
  reason: string;
}

export interface ScopingContextCaptureHint {
  sourceId: string;
  captureIds: string[];
  reason: string;
}

export interface ScopingContextPack {
  matchedPromptTerms: string[];
  sourceMatches: ScopingContextSourceMatch[];
  primarySurface?: ScopingContextSurfaceHint;
  alternativeSurfaces: ScopingContextSurfaceHint[];
  pathHints: ScopingContextPathHint[];
  uiStateHints: ScopingContextUiStateHint[];
  verificationHints: ScopingContextVerificationHint[];
  repoNoteHints: ScopingContextRepoNoteHint[];
  repoMemoryHints: ScopingContextRepoMemoryHint[];
  captureHints: ScopingContextCaptureHint[];
  unresolvedQuestions: string[];
}

export interface PlanningScopingDetails {
  repoContext?: string[];
  sourceScope?: string[];
  adaptiveBoundaries?: string[];
  minimumSuccess?: string[];
  baseline?: string[];
  verificationObligations?: string[];
}

export interface PlanningContext {
  repoCandidates: RepoContextCandidate[];
  scopingContext?: ScopingContextPack;
  scopingDetails?: PlanningScopingDetails;
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

export interface NormalizationAmbiguityMeta {
  isAmbiguous: boolean;
  reasons: string[];
}

export interface NormalizationMeta {
  source: NormalizationSource;
  warnings: string[];
  stages: AgentStageMeta[];
  requestedPlanningDepth: IntentPlanningDepth;
  effectivePlanningDepth: IntentPlanningDepth;
  ambiguity: NormalizationAmbiguityMeta;
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
  normalizationMeta: NormalizationMeta;
}

export type ReviewedIntentStatus = "draft" | "sent" | "executing" | "delivered";

export interface ReviewedIntentArtifact {
  reviewedIntentId: string;
  status: ReviewedIntentStatus;
  createdAt: string;
  updatedAt: string;
  prompt: string;
  requestedSourceIds?: string[];
  resumeIssue?: string;
  normalizedIntent: NormalizedIntent;
}