import { AgentConfig, CaptureItemConfig, SourceConfig } from "../config/schema";
import { toFileUrlPath } from "../evidence/paths";
import { sanitizeFileSegment } from "../shared/fs";
import {
  AGENT_STAGE_SEQUENCE,
  ResolvedAgentStageConfig,
  resolveAgentStageConfig
} from "./agent-stage-config";
import { CodeSurfaceId, CodeSurfaceSelection, getCodeSurfaceImplementationHints, inferCodeSurface, isCodeSurfaceId } from "./code-surface";
import {
  normalizePromptWithGemini,
  PromptNormalizationHints,
  PromptNormalizerSourceDescriptor
} from "./gemini-prompt-normalizer";
import { refineIntentPlanWithGemini, GeminiIntentPlanningRefinement } from "./gemini-intent-planner";
import { refineIntentTddWithGemini, GeminiTddPlanningRefinement } from "./gemini-tdd-planner";
import { REPO_MEMORY_CATALOG } from "./repo-memory-catalog";
import {
  AcceptanceCriterion,
  AgentStageMeta,
  BDDScenario,
  IntentPlanningDepth,
  IntentDecomposition,
  NormalizedIntent,
  NormalizationMeta,
  NormalizationSource,
  PlanningScopingDetails,
  PlaywrightCheckpoint,
  PlaywrightSpecArtifact,
  ResolvedUiStateRequirement,
  ScopingContextPack,
  TDDWorkItem
} from "./intent-types";

export type AvailableSourceDescriptor = PromptNormalizerSourceDescriptor;

export type PlanningDepth = IntentPlanningDepth;

export interface NormalizeIntentOptions {
  rawPrompt: string;
  defaultSourceId: string;
  continueOnCaptureError: boolean;
  availableSources: Record<string, AvailableSourceDescriptor>;
  agent?: AgentConfig;
  linearEnabled?: boolean;
  publishToSourceWorkspace?: boolean;
  resumeIssue?: string;
  requestedSourceIds?: string[];
  planningDepth?: PlanningDepth;
}

type SourceSelectionReason = "requested-scope" | "prompt-match" | "business-wide" | "default" | "llm";

interface SourceSelection {
  sourceIds: string[];
  selectionReason: SourceSelectionReason;
  promptMatchValues?: Record<string, string>;
}

interface NormalizationResolution {
  sourceIds: string[];
  selectionReason: SourceSelectionReason;
  promptMatchValues: Record<string, string>;
  desiredOutcome: string;
  codeSurfaceId?: CodeSurfaceId;
  codeSurfaceAlternatives?: CodeSurfaceId[];
  captureIdsBySource: Record<string, string[] | undefined>;
  scopingDetails?: PlanningScopingDetails;
  normalizationSource: NormalizationSource;
  normalizationWarnings: string[];
}

interface IntentPlanningRefinement {
  statement?: string;
  desiredOutcome?: string;
  acceptanceCriteria?: AcceptanceCriterion[];
  scenarios?: BDDScenario[];
  warnings: string[];
}

interface IntentDraft {
  statement: string;
  primarySourceId: string;
  sourcePlans: NormalizedIntent["executionPlan"]["sources"];
  primaryCaptureScope: NormalizedIntent["captureScope"];
  desiredOutcome: string;
  acceptanceCriteria: AcceptanceCriterion[];
  scenarios: BDDScenario[];
  workItems: NormalizedIntent["businessIntent"]["workItems"];
  decomposition?: NormalizedIntent["businessIntent"]["decomposition"];
  destinations: NormalizedIntent["executionPlan"]["destinations"];
  tools: NormalizedIntent["executionPlan"]["tools"];
  repoCandidates: NormalizedIntent["planning"]["repoCandidates"];
  planningReviewNotes: string[];
  reviewNotes: string[];
  summary: string;
}

interface CaptureScopeSelection {
  captureScope: {
    mode: "all" | "subset";
    captureIds: string[];
  };
  warnings: string[];
}

interface AcceptanceCriteriaSelection {
  descriptions: string[];
  warnings: string[];
}

interface CaptureItemSelection {
  captureItems: CaptureItemConfig[];
  warnings: string[];
}

interface PlaywrightSpecBuildResult {
  specs: PlaywrightSpecArtifact[];
  warnings: string[];
}

interface WorkItemBuildResult {
  workItems: NormalizedIntent["businessIntent"]["workItems"];
  decomposition?: NormalizedIntent["businessIntent"]["decomposition"];
  warnings: string[];
}

const POC_LINEAR_DISABLED_WARNING = "Linear support is disabled in this POC.";
const SCOPING_BDD_DEFERRED_WARNING = "BDD planning is deferred until the full reviewed plan pass.";
const SCOPING_TDD_DEFERRED_WARNING = "Playwright-first TDD planning is deferred until the full reviewed plan pass.";

interface BuildNormalizedIntentInput {
  planningRefinement?: IntentPlanningRefinement;
  tddWorkItemPlan?: WorkItemBuildResult;
  stageMetas?: AgentStageMeta[];
}

export interface NormalizeIntentDependencies {
  normalizePromptWithGemini: typeof normalizePromptWithGemini;
  refineIntentPlanWithGemini: typeof refineIntentPlanWithGemini;
  refineIntentTddWithGemini: typeof refineIntentTddWithGemini;
}

const defaultNormalizeIntentDependencies: NormalizeIntentDependencies = {
  normalizePromptWithGemini,
  refineIntentPlanWithGemini,
  refineIntentTddWithGemini
};

interface SanitizedIdSelection {
  validIds: string[];
  invalidIds: string[];
}

const businessWideIntentPattern =
  /\b(all targets|all systems|all sources|multiple targets|multiple systems|across\b|business[- ]wide|organization[- ]wide|org[- ]wide|everywhere|cross[- ]target|cross[- ]system)\b/i;

function dedupeValues(values: string[]): string[] {
  return Array.from(new Set(values));
}

function buildNormalizationAmbiguityMeta(
  codeSurface: CodeSurfaceSelection,
  warnings: string[]
): NormalizationMeta["ambiguity"] {
  const reasons = dedupeValues([
    ...(codeSurface.confidence !== "high" ? [codeSurface.rationale] : []),
    ...warnings.filter((warning) =>
      /did not strongly match|did not have a confidently executable visual scenario/i.test(warning)
    )
  ]);

  return {
    isAmbiguous: reasons.length > 0,
    reasons
  };
}

function tokenizePrompt(prompt: string): Set<string> {
  return new Set(prompt.toLowerCase().match(/[a-z0-9]+(?:[-_][a-z0-9]+)*/g) ?? []);
}

function matchesPromptValue(normalizedPrompt: string, promptTokens: Set<string>, value: string): boolean {
  const normalizedValue = value.trim().toLowerCase();
  if (normalizedValue.length === 0) {
    return false;
  }

  if (/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(normalizedValue)) {
    return promptTokens.has(normalizedValue);
  }

  return normalizedPrompt.includes(normalizedValue);
}

function collectPromptPhraseMatches(
  normalizedPrompt: string,
  promptTokens: Set<string>,
  phrases: string[]
): string[] {
  return dedupeValues(
    phrases
      .map((phrase) => phrase.trim())
      .filter((phrase) => phrase.length > 0 && matchesPromptValue(normalizedPrompt, promptTokens, phrase))
  );
}

function collectPromptTokenMatches(promptTokens: Set<string>, text: string): string[] {
  return dedupeValues(
    (text.toLowerCase().match(/[a-z0-9]+(?:[-_][a-z0-9]+)*/g) ?? []).filter(
      (token) => token.length > 3 && promptTokens.has(token)
    )
  );
}

const REPO_MEMORY_NOISE_TOKENS = new Set([
  "should",
  "source",
  "business",
  "review",
  "visible",
  "without",
  "details",
  "current",
  "prompt",
  "plan",
  "work",
  "needs",
  "leave",
  "built",
  "reading"
]);

function collectRepoMemoryTokenMatches(promptTokens: Set<string>, text: string): string[] {
  return collectPromptTokenMatches(promptTokens, text).filter((token) => !REPO_MEMORY_NOISE_TOKENS.has(token));
}

function buildRepoMemoryHints(input: {
  normalizedPrompt: string;
  promptTokens: Set<string>;
  sourcePlans: NormalizedIntent["executionPlan"]["sources"];
  codeSurface: CodeSurfaceSelection;
}) {
  const selectedSourceIds = new Set(input.sourcePlans.map((sourcePlan) => sourcePlan.sourceId));

  return REPO_MEMORY_CATALOG.map((entry) => {
    const titleMatches = collectPromptPhraseMatches(input.normalizedPrompt, input.promptTokens, [
      entry.title,
      entry.id,
      ...entry.tags
    ]);
    const surfaceMatches = entry.surfaceIds.includes(input.codeSurface.id);
    const sourceMatches = entry.sourceIds.some((sourceId) => selectedSourceIds.has(sourceId));
    const noteMatches = entry.notes.map((note) => ({
      note,
      matchedTerms: collectRepoMemoryTokenMatches(input.promptTokens, note)
    }));
    const bestNoteMatch = noteMatches.sort((left, right) => right.matchedTerms.length - left.matchedTerms.length)[0];
    const matchedTerms = dedupeValues([
      ...titleMatches,
      ...((titleMatches.length > 0 || surfaceMatches) ? (bestNoteMatch?.matchedTerms ?? []).slice(0, 2) : [])
    ]);

    if (titleMatches.length === 0 && !(surfaceMatches && sourceMatches && (bestNoteMatch?.matchedTerms.length ?? 0) >= 2)) {
      return null;
    }

    const score =
      matchedTerms.length * 3 +
      (surfaceMatches ? 2 : 0) +
      (sourceMatches ? 1 : 0) +
      (bestNoteMatch?.matchedTerms.length ?? 0);

    return {
      memoryId: entry.id,
      title: entry.title,
      sourcePath: entry.sourcePath,
      note: bestNoteMatch?.note ?? entry.notes[0] ?? "",
      reason:
        matchedTerms.length > 0
          ? `Matched repo memory terms: ${matchedTerms.join(", ")}.`
          : `Selected for ${input.codeSurface.label}.`,
      score
    };
  })
    .filter((hint) => hint !== null)
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
    .slice(0, 3)
    .map(({ score: _score, ...hint }) => hint);
}

function pickMentionedSources(
  prompt: string,
  options: NormalizeIntentOptions
): { sourceIds: string[]; promptMatchValues: Record<string, string> } {
  const loweredPrompt = prompt.toLowerCase();
  const promptTokens = tokenizePrompt(prompt);
  const matches: string[] = [];
  const promptMatchValues: Record<string, string> = {};

  for (const [sourceId, source] of Object.entries(options.availableSources)) {
    if (matchesPromptValue(loweredPrompt, promptTokens, sourceId)) {
      matches.push(sourceId);
      promptMatchValues[sourceId] = sourceId;
      continue;
    }

    const matchedAlias = source.aliases.find((alias) => matchesPromptValue(loweredPrompt, promptTokens, alias));
    if (matchedAlias) {
      matches.push(sourceId);
      promptMatchValues[sourceId] = matchedAlias;
    }
  }

  const sourceIds = dedupeValues(matches);

  return {
    sourceIds,
    promptMatchValues: Object.fromEntries(sourceIds.map((sourceId) => [sourceId, promptMatchValues[sourceId] ?? sourceId]))
  };
}

function getRequestedSourceIds(options: NormalizeIntentOptions): string[] | undefined {
  const requestedSourceIds = dedupeValues(
    (options.requestedSourceIds ?? []).map((sourceId) => sourceId.trim()).filter((sourceId) => sourceId.length > 0)
  );

  if (requestedSourceIds.length === 0) {
    return undefined;
  }

  const invalidSourceIds = requestedSourceIds.filter(
    (sourceId) => !Object.prototype.hasOwnProperty.call(options.availableSources, sourceId)
  );

  if (invalidSourceIds.length > 0) {
    throw new Error(`Requested source scope includes unknown source ids: ${invalidSourceIds.join(", ")}.`);
  }

  return requestedSourceIds;
}

function pickApplicableSourceIds(prompt: string, options: NormalizeIntentOptions): SourceSelection {
  const requestedSourceIds = getRequestedSourceIds(options);
  if (requestedSourceIds) {
    return {
      sourceIds: requestedSourceIds,
      selectionReason: "requested-scope",
      promptMatchValues: {}
    };
  }

  const matchedSources = pickMentionedSources(prompt, options);
  if (matchedSources.sourceIds.length > 0) {
    return {
      sourceIds: matchedSources.sourceIds,
      selectionReason: "prompt-match",
      promptMatchValues: matchedSources.promptMatchValues
    };
  }

  if (businessWideIntentPattern.test(prompt)) {
    return {
      sourceIds: Object.keys(options.availableSources),
      selectionReason: "business-wide",
      promptMatchValues: {}
    };
  }

  return {
    sourceIds: [options.defaultSourceId],
    selectionReason: "default",
    promptMatchValues: {}
  };
}

function pickCaptureIds(prompt: string, captureItems: CaptureItemConfig[]): { mode: "all" | "subset"; captureIds: string[] } {
  const loweredPrompt = prompt.toLowerCase();
  const matchedCaptureIds = captureItems
    .filter((item) => {
      if (loweredPrompt.includes(item.id.toLowerCase())) {
        return true;
      }

      if (item.name && loweredPrompt.includes(item.name.toLowerCase())) {
        return true;
      }

      return false;
    })
    .map((item) => item.id);

  if (matchedCaptureIds.length === 0) {
    return { mode: "all", captureIds: [] };
  }

  return { mode: "subset", captureIds: matchedCaptureIds };
}

function describeIgnoredCaptureHint(sourceId: string, captureIds: string[]): string {
  return `Gemini suggested narrowing ${sourceId} captures to ${captureIds.join(", ")}, but the prompt did not explicitly name those captures, so all configured captures were preserved.`;
}

function summarizeIntent(sourceIds: string[]): string {
  const scope = sourceIds.length === 1 ? sourceIds[0] : `${sourceIds.length} sources`;

  return `change behavior for ${scope}`;
}

function inferDesiredOutcomeFromPrompt(prompt: string): string | undefined {
  const firstSentence = prompt
    .split(/[.!?](?:\s|$)/)
    .map((segment) => segment.trim())
    .find((segment) => segment.length > 0);

  if (!firstSentence) {
    return undefined;
  }

  const normalized = firstSentence
    .replace(/^(?:please\s+)?(?:can|could|would)\s+you\s+/i, "")
    .replace(/^(?:help\s+me\s+)?(?:fix|update|change|add|make|ensure)\s+/i, "")
    .replace(/^(?:i|we)\s+(?:need|want)\s+/i, "")
    .replace(/^(?:make\s+sure|ensure)\s+/i, "")
    .replace(/\b(?:right now|currently)\b.*$/i, "")
    .replace(/\bbut\s+we\s+(?:do\s+not|don't|dont|want|need)\b.*$/i, "")
    .replace(/^[,.;:\s]+|[,.;:\s]+$/g, "")
    .trim();

  if (normalized.length < 8) {
    return undefined;
  }

  const sentence = /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

function createPlanId(prefix: string, input: string, index: number): string {
  const segment = sanitizeFileSegment(input) || `${prefix}-${index + 1}`;
  return `${prefix}-${index + 1}-${segment}`;
}

function extractDesiredOutcome(prompt: string): string {
  const normalizeOutcome = (value: string): string =>
    value
      .split(/[.!?](?:\s|$)/)[0]!
      .trim()
      .replace(/^[,.;:\s]+/, "")
      .replace(/[.\s]+$/, "");

  const desiredOutcomeMatch = prompt.match(/\bso that\b(.+)/i);
  if (desiredOutcomeMatch) {
    return normalizeOutcome(desiredOutcomeMatch[1]);
  }

  const mustMatch = prompt.match(/\b(?:must|should|needs to|need to|i need|we need|i want|we want|make sure|ensure)\b(.+)/i);
  if (mustMatch) {
    return normalizeOutcome(mustMatch[1]);
  }

  return inferDesiredOutcomeFromPrompt(prompt) ?? "The requested behavior works as described in the selected repo scope.";
}

function extractPromptCriteria(prompt: string): string[] {
  const matches = Array.from(prompt.matchAll(/\b(?:must|should|needs to|need to|so that)\b([^.;]+)/gi))
    .map((match) => match[1].trim().replace(/^[,\s]+/, ""))
    .filter((entry) => entry.length > 0);

  return dedupeValues(matches);
}

function buildUiStateNarrativeText(input: {
  promptText: string;
  desiredOutcome: string;
  acceptanceCriteria: string[];
  scenario?: BDDScenario;
}): string {
  return [
    input.promptText,
    input.desiredOutcome,
    ...input.acceptanceCriteria,
    input.scenario?.title ?? "",
    input.scenario?.goal ?? "",
    ...(input.scenario?.given ?? []),
    ...(input.scenario?.when ?? []),
    ...(input.scenario?.then ?? [])
  ]
    .join(" ")
    .toLowerCase();
}

function buildUiStateSearchText(uiState: SourceConfig["planning"]["uiStates"][number]): string {
  return [
    uiState.id,
    uiState.label ?? "",
    uiState.description,
    ...uiState.notes,
    ...uiState.verificationStrategies,
    ...uiState.activation.flatMap((activation) => [activation.target ?? "", ...Object.keys(activation.values), ...activation.notes])
  ]
    .join(" ")
    .toLowerCase();
}

function tokenizeUiStateText(text: string): string[] {
  const stopWords = new Set([
    "activate",
    "activated",
    "activation",
    "before",
    "capture",
    "demo",
    "deterministic",
    "driven",
    "explicit",
    "mode",
    "requested",
    "reviewable",
    "route",
    "screenshot",
    "screenshots",
    "state",
    "states",
    "supports",
    "support",
    "ui",
    "verification"
  ]);

  return Array.from(
    new Set((text.match(/[a-z0-9]+(?:[-_][a-z0-9]+)*/g) ?? []).filter((token) => token.length > 2 && !stopWords.has(token)))
  );
}

function resolveRequestedUiStateValue(
  uiState: SourceConfig["planning"]["uiStates"][number],
  combinedText: string,
  promptTokens: Set<string>
): string | undefined {
  const candidateValues = dedupeValues(uiState.activation.flatMap((activation) => Object.keys(activation.values))).sort(
    (left, right) => right.length - left.length
  );

  return candidateValues.find((value) => matchesPromptValue(combinedText, promptTokens, value));
}

function matchesUiStateDescriptor(
  uiState: SourceConfig["planning"]["uiStates"][number],
  combinedText: string,
  promptTokens: Set<string>
): boolean {
  const directPhrases = [uiState.id, uiState.label ?? ""]
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (directPhrases.some((phrase) => matchesPromptValue(combinedText, promptTokens, phrase))) {
    return true;
  }

  const identityTokens = tokenizeUiStateText([uiState.id, uiState.label ?? ""].join(" "));
  const descriptiveTokens = tokenizeUiStateText([uiState.description, ...uiState.notes].join(" "));

  return identityTokens.some((token) => promptTokens.has(token))
    && descriptiveTokens.some((token) => promptTokens.has(token));
}

function buildUiStateReason(
  uiState: SourceConfig["planning"]["uiStates"][number],
  requestedValue?: string
): string {
  const label = uiState.label ?? uiState.id;
  return requestedValue
    ? `Prompt requests the ${label} UI state with value "${requestedValue}".`
    : `Prompt references the ${label} UI state.`;
}

function resolveUiStateRequirements(input: {
  source: AvailableSourceDescriptor;
  promptText: string;
  desiredOutcome: string;
  acceptanceCriteria: string[];
  scenario?: BDDScenario;
}): ResolvedUiStateRequirement[] {
  const combinedText = buildUiStateNarrativeText({
    promptText: input.promptText,
    desiredOutcome: input.desiredOutcome,
    acceptanceCriteria: input.acceptanceCriteria,
    scenario: input.scenario
  });
  const promptTokens = tokenizePrompt(combinedText);

  return input.source.planning.uiStates.flatMap((uiState) => {
    const requestedValue = resolveRequestedUiStateValue(uiState, combinedText, promptTokens);
    if (!requestedValue && !matchesUiStateDescriptor(uiState, combinedText, promptTokens)) {
      return [];
    }

    return [
      {
        stateId: uiState.id,
        label: uiState.label,
        description: uiState.description,
        requestedValue,
        activation: uiState.activation,
        verificationStrategies: uiState.verificationStrategies,
        notes: dedupeValues([...input.source.planning.verificationNotes, ...uiState.notes]),
        reason: buildUiStateReason(uiState, requestedValue)
      }
    ];
  });
}

function buildAcceptanceCriteria(
  prompt: string,
  desiredOutcome: string,
  sourceIds: string[],
  codeSurface?: CodeSurfaceSelection
): NormalizedIntent["businessIntent"]["acceptanceCriteria"] {
  const explicitCriteria = extractPromptCriteria(prompt).map((description, index) => ({
    id: createPlanId("ac", description, index),
    description,
    origin: "prompt" as const
  }));

  const inferredCriteria = [
    sourceIds.length === 1
      ? `Intent is translated into executable work for ${sourceIds[0]}.`
      : `Intent is translated into executable work across ${sourceIds.length} applicable sources.`,
    codeSurface?.id === "orchestrator-and-planning"
      ? "Behavior changes are implemented and verified through targeted code validation."
      : "Evidence is captured and packaged for review.",
    `Results are packaged so they can be distributed consistently, with the desired outcome of: ${desiredOutcome}.`
  ]
    .filter((description) => !explicitCriteria.some((item) => item.description.toLowerCase() === description.toLowerCase()))
    .map((description, index) => ({
      id: createPlanId("ac", description, explicitCriteria.length + index),
      description,
      origin: "inferred" as const
    }));

  return [...explicitCriteria, ...inferredCriteria];
}

function buildScenarios(input: {
  statement: string;
  desiredOutcome: string;
  sourceIds: string[];
  acceptanceCriteria: NormalizedIntent["businessIntent"]["acceptanceCriteria"];
  codeSurface?: CodeSurfaceSelection;
}): NormalizedIntent["businessIntent"]["scenarios"] {
  const criteriaDescriptions = input.acceptanceCriteria.map((criterion) => criterion.description);

  const scenarios: Array<Omit<NormalizedIntent["businessIntent"]["scenarios"][number], "id">> = [
    {
      title: "Intent is translated into acceptance-ready work",
      goal: "Turn the raw business statement into reviewable BDD structure.",
      given: [
        `A business intent has been captured: ${input.statement}`,
        `The desired outcome is explicit: ${input.desiredOutcome}`
      ],
      when: [
        "The planner decomposes the intent into acceptance criteria and scenarios.",
        "Applicable sources and destinations are identified from the prompt and configuration."
      ],
      then: criteriaDescriptions.slice(0, Math.min(criteriaDescriptions.length, 2)),
      applicableSourceIds: input.sourceIds
    },
    input.codeSurface?.id === "orchestrator-and-planning"
      ? {
          title: "Behavior changes are verified for applicable sources",
          goal: "Define targeted verification that validates the requested behavior changes.",
          given: [
            input.sourceIds.length === 1
              ? `Source ${input.sourceIds[0]} is available for execution.`
              : `${input.sourceIds.length} sources are applicable to the intent.`
          ],
          when: [
            "Implementation planning prepares targeted code verification for the applicable sources.",
            "The runner maps behavior changes into source-scoped validation."
          ],
          then: [
            input.sourceIds.length === 1
              ? `Code validation confirms the requested behavior for ${input.sourceIds[0]}.`
              : `Code validation confirms the requested behavior for ${input.sourceIds.join(", ")}.`,
            "Each applicable source has executable verification for the behavior change."
          ],
          applicableSourceIds: input.sourceIds
        }
      : {
          title: "Behavior is verified visually for applicable sources",
          goal: "Define Playwright screenshot verification that QA can execute to validate behavior for each source involved in the intent.",
          given: [
            input.sourceIds.length === 1
              ? `Source ${input.sourceIds[0]} is available for execution.`
              : `${input.sourceIds.length} sources are applicable to the intent.`
          ],
          when: [
            "TDD planning prepares Playwright screenshot verification for the applicable sources.",
            "The runner maps the requested behavior into QA-runnable visual checkpoints."
          ],
          then: [
            input.sourceIds.length === 1
              ? `QA can run a Playwright screenshot flow to verify behavior for ${input.sourceIds[0]}.`
              : `QA can run Playwright screenshot flows to verify behavior for ${input.sourceIds.join(", ")}.`,
            "Each applicable source has executable visual verification coverage with reviewable screenshots."
          ],
          applicableSourceIds: input.sourceIds
        },
    {
      title: "Results are distributed consistently",
      goal: "Make the outputs visible in the places that matter to stakeholders.",
      given: [
        "Execution produces evidence, summaries, and progress state.",
        "Distribution destinations are known before execution begins."
      ],
      when: [
        "The run reaches the distribution stage.",
        "Publishing destinations receive the resulting evidence and summaries."
      ],
      then: [
        "Stakeholders can inspect the outcome through a consistent package tied to the intent.",
        "Distribution remains decoupled from any single source-specific workflow."
      ],
      applicableSourceIds: input.sourceIds
    }
  ];

  return scenarios.map((scenario, index) => ({
    id: createPlanId("scenario", scenario.title, index),
    ...scenario
  }));
}

function buildPlaywrightSpecRelativePath(sourceId: string, workItemTitle: string, fallbackWorkItemId: string): string {
  const sourceSegment = sanitizeFileSegment(sourceId) || "source";
  const workItemSegment = sanitizeFileSegment(workItemTitle)
    || sanitizeFileSegment(fallbackWorkItemId)
    || "generated-playwright-test";
  return `${sourceSegment}/${workItemSegment}.spec.ts`;
}

function buildPlaywrightCheckpointNarrativeText(input: {
  workItemTitle: string;
  promptText: string;
  desiredOutcome: string;
  acceptanceCriteria: string[];
  scenario?: BDDScenario;
}): string {
  return [
    input.workItemTitle,
    input.promptText,
    input.desiredOutcome,
    ...input.acceptanceCriteria,
    input.scenario?.title ?? "",
    input.scenario?.goal ?? "",
    ...(input.scenario?.given ?? []),
    ...(input.scenario?.when ?? []),
    ...(input.scenario?.then ?? [])
  ]
    .join(" ")
    .toLowerCase();
}

function isTextEntrySelector(selector: string): boolean {
  return /(^|[\s>+~,])(input|textarea)(?=$|[\s>+~.#[:])/i.test(selector);
}

function shouldBuildStatefulInputVerificationCheckpoints(input: {
  scenario?: BDDScenario;
  captureItems: CaptureItemConfig[];
  workItemTitle: string;
  promptText: string;
  desiredOutcome: string;
  acceptanceCriteria: string[];
}): boolean {
  if (input.captureItems.length !== 1) {
    return false;
  }

  const captureItem = input.captureItems[0]!;
  const captureTarget = captureItem.locator ?? captureItem.waitForSelector;
  if (!captureTarget) {
    return false;
  }

  const captureText = [captureItem.id, captureItem.name ?? "", captureItem.path, captureTarget].join(" ").toLowerCase();
  if (!/\binput\b/.test(captureText)) {
    return false;
  }

  const narrativeText = buildPlaywrightCheckpointNarrativeText({
    scenario: input.scenario,
    workItemTitle: input.workItemTitle,
    promptText: input.promptText,
    desiredOutcome: input.desiredOutcome,
    acceptanceCriteria: input.acceptanceCriteria
  });
  const mentionsInputSubject = /\b(input|field|text|placeholder|value)\b/i.test(narrativeText);
  const mentionsEntryOrLegibility = /\b(type|typed|typing|fill|filled|readability|readable|contrast|visibility|visible|legible)\b/i.test(
    narrativeText
  );

  return mentionsInputSubject && mentionsEntryOrLegibility;
}

function buildStatefulInputVerificationCheckpoints(input: {
  captureItem: CaptureItemConfig;
  workItemTitle: string;
  desiredOutcome: string;
  uiStateRequirements: ResolvedUiStateRequirement[];
}): PlaywrightCheckpoint[] {
  const captureTarget = input.captureItem.locator ?? input.captureItem.waitForSelector;
  if (!captureTarget) {
    throw new Error(`Stateful input verification requires a locator-backed capture item: ${input.captureItem.id}`);
  }

  const textEntryTarget = isTextEntrySelector(captureTarget) ? captureTarget : `${captureTarget} input`;
  const checkpointUiStateFields = input.uiStateRequirements.length > 0 ? { requiredUiStates: input.uiStateRequirements } : {};

  return [
    {
      id: createPlanId("checkpoint", `${input.captureItem.id}-ready-for-text-entry`, 0),
      label: `${input.captureItem.name ?? input.captureItem.id} Ready For Text Entry`,
      action: "goto",
      assertion: input.desiredOutcome,
      screenshotId: createPlanId("shot", `${input.captureItem.id}-ready-for-text-entry`, 0),
      path: input.captureItem.path,
      captureId: input.captureItem.id,
      locator: captureTarget,
      waitForSelector: input.captureItem.waitForSelector ?? captureTarget,
      target: captureTarget,
      waitUntil: input.captureItem.waitForSelector ? "load" : "networkidle",
      ...checkpointUiStateFields
    },
    {
      id: createPlanId("checkpoint", `${input.captureItem.id}-typed-text-visible`, 1),
      label: "Typed Input Text Visible",
      action: "fill",
      assertion: "Typed text remains visible and reviewable after the input field is activated.",
      screenshotId: createPlanId("shot", `${input.captureItem.id}-typed-text-visible`, 1),
      captureId: input.captureItem.id,
      target: textEntryTarget,
      waitForSelector: textEntryTarget,
      value: "Readable dark mode sample text",
      ...checkpointUiStateFields
    }
  ];
}

function buildPlaywrightCheckpoints(input: {
  sourceId: string;
  codeSurface: CodeSurfaceSelection;
  scenario?: BDDScenario;
  captureItems: CaptureItemConfig[];
  workItemTitle: string;
  promptText: string;
  desiredOutcome: string;
  acceptanceCriteria: string[];
  uiStateRequirements: ResolvedUiStateRequirement[];
}): PlaywrightCheckpoint[] {
  if (
    shouldBuildIntentStudioLifecycleCheckpoints({
      sourceId: input.sourceId,
      codeSurface: input.codeSurface,
      promptText: input.promptText,
      desiredOutcome: input.desiredOutcome,
      acceptanceCriteria: input.acceptanceCriteria,
      scenario: input.scenario
    })
  ) {
    return buildIntentStudioLifecyclePlaywrightCheckpoints({
      sourceId: input.sourceId,
      workItemTitle: input.workItemTitle,
      promptText: input.promptText,
      desiredOutcome: input.desiredOutcome,
      acceptanceCriteria: input.acceptanceCriteria,
      scenario: input.scenario,
      uiStateRequirements: input.uiStateRequirements
    });
  }

  if (input.codeSurface.id === "intent-studio") {
    return buildIntentStudioPlaywrightCheckpoints({
      scenario: input.scenario,
      workItemTitle: input.workItemTitle,
      promptText: input.promptText,
      desiredOutcome: input.desiredOutcome,
      acceptanceCriteria: input.acceptanceCriteria,
      uiStateRequirements: input.uiStateRequirements
    });
  }

  const checkpointUiStateFields = input.uiStateRequirements.length > 0 ? { requiredUiStates: input.uiStateRequirements } : {};

  if (input.captureItems.length === 0) {
    const label = `Open the primary flow for ${input.workItemTitle}`;
    return [
      {
        id: createPlanId("checkpoint", label, 0),
        label,
        action: "goto",
        assertion: input.desiredOutcome,
        screenshotId: createPlanId("shot", input.workItemTitle, 0),
        path: "/",
        ...checkpointUiStateFields
      }
    ];
  }

  if (
    shouldBuildStatefulInputVerificationCheckpoints({
      scenario: input.scenario,
      captureItems: input.captureItems,
      workItemTitle: input.workItemTitle,
      promptText: input.promptText,
      desiredOutcome: input.desiredOutcome,
      acceptanceCriteria: input.acceptanceCriteria
    })
  ) {
    return buildStatefulInputVerificationCheckpoints({
      captureItem: input.captureItems[0]!,
      workItemTitle: input.workItemTitle,
      desiredOutcome: input.desiredOutcome,
      uiStateRequirements: input.uiStateRequirements
    });
  }

  return input.captureItems.map((item, index) => ({
    id: createPlanId("checkpoint", item.id, index),
    label: item.name ?? item.id,
    action: "goto",
    assertion: item.locator
      ? `The target '${item.locator}' is visible for ${item.name ?? item.id}.`
      : `The page '${item.path}' is ready for evidence review.`,
    screenshotId: createPlanId("shot", item.id, index),
    path: item.path,
    captureId: item.id,
    locator: item.locator,
    waitForSelector: item.waitForSelector,
    target: item.locator,
    waitUntil: item.waitForSelector ? "load" : "networkidle",
    ...checkpointUiStateFields
  }));
}

function derivePlaywrightVerificationMode(
  specs: PlaywrightSpecArtifact[]
): TDDWorkItem["verificationMode"] {
  return specs.some((spec) => spec.checkpoints.some((checkpoint) => checkpoint.action === "mock-studio-state"))
    ? "mocked-state-playwright"
    : "tracked-playwright";
}

function supportsIntentStudioLifecycleVerification(sourceId: string): boolean {
  return sourceId === "intent-poc-app";
}

function hasIntentStudioLifecycleSignals(text: string): boolean {
  return /\b(intent lifecycle|lifecycle|lifecycle state|lifecycle status|application state|application status|state and status|state machine|planned execution|reverted|reversion|rollback|rerun|execution state|status of the application)\b/i.test(
    text
  );
}

function hasIntentStudioRunIndicatorSignals(text: string): boolean {
  const indicatorPattern = /\b(indicator|status pill|status badge|run status|test status|qa status|verification status)\b/i;
  const executionPattern = /\b(test run|tests run|tests are run|visual test|qa|verification|execution|runner)\b/i;
  const transitionPattern = /\b(running|active|in progress|updates|update|state|status|success|successful|failure|failed|complete|completed)\b/i;

  return (indicatorPattern.test(text) && executionPattern.test(text))
    || /\b(visual test run indicator|test run indicator)\b/i.test(text)
    || (executionPattern.test(text) && transitionPattern.test(text) && /\b(show|reflect|display|surface|track)\b/i.test(text));
}

function requiresLiveIntentStudioIndicatorVerification(input: {
  codeSurface: CodeSurfaceSelection;
  rawPrompt: string;
  desiredOutcome: string;
}): boolean {
  if (input.codeSurface.id !== "intent-studio") {
    return false;
  }

  return hasIntentStudioRunIndicatorSignals([input.rawPrompt, input.desiredOutcome].join(" "));
}

function resolveOrchestratorBehaviorVerificationMode(input: {
  codeSurface: CodeSurfaceSelection;
  sourceIds: string[];
  rawPrompt: string;
  desiredOutcome: string;
  acceptanceCriteria: NormalizedIntent["businessIntent"]["acceptanceCriteria"];
}): TDDWorkItem["verificationMode"] | null {
  if (input.codeSurface.id !== "orchestrator-and-planning") {
    return null;
  }

  const combinedText = [input.rawPrompt, input.desiredOutcome].join(" ");

  return input.sourceIds.some(supportsIntentStudioLifecycleVerification)
    && hasIntentStudioLifecycleSignals(combinedText)
    ? "mocked-state-playwright"
    : "targeted-code-validation";
}

function shouldBuildIntentStudioLifecycleCheckpoints(input: {
  sourceId: string;
  codeSurface: CodeSurfaceSelection;
  promptText: string;
  desiredOutcome: string;
  acceptanceCriteria: string[];
  scenario?: BDDScenario;
}): boolean {
  const combinedText = [
    input.promptText,
    input.desiredOutcome,
    ...input.acceptanceCriteria,
    ...(input.scenario
      ? [input.scenario.title, input.scenario.goal, ...input.scenario.given, ...input.scenario.when, ...input.scenario.then]
      : [])
  ].join(" ");

  if (!supportsIntentStudioLifecycleVerification(input.sourceId)) {
    return false;
  }

  if (input.codeSurface.id === "orchestrator-and-planning") {
    return hasIntentStudioLifecycleSignals(combinedText);
  }

  return false;
}

function buildIntentStudioLifecycleMockState(input: {
  sourceId: string;
  promptText: string;
  desiredOutcome: string;
  acceptanceCriteria: string[];
  workItemTitle: string;
  runStatus: "running" | "failed";
  lifecycleStatus: "executing" | "reverted";
  implementationStageStatus: "running" | "failed";
  qaVerificationStageStatus: "pending" | "failed";
  latestImplementationSummary: string;
}): Record<string, unknown> {
  const runId = `2026-04-16T00-00-00-000Z-${input.sourceId}`;
  const workItemId = `work-1-${sanitizeFileSegment(input.workItemTitle) || "verify-lifecycle-behavior"}-${input.sourceId}`;

  return {
    configPath: "intent-poc.yaml",
    linearEnabled: false,
    defaultSourceId: input.sourceId,
    agentStages: [],
    sources: [
      {
        id: input.sourceId,
        label: input.sourceId === "intent-poc-app" ? "Intent POC App" : "Surface Library",
        repoLabel: "Intent POC",
        role: "controller-and-demo-source",
        summary: "Intent Studio and surface library source.",
        aliases: [input.sourceId],
        captureCount: 0,
        sourceType: "local",
        sourceLocation: ".",
        startCommand: "echo start",
        readiness: "HTTP http://127.0.0.1:6006",
        baseUrl: "http://127.0.0.1:6006",
        defaultScope: true,
        status: "ready",
        issues: [],
        notes: []
      }
    ],
    currentRun: {
      sessionId: "session-1",
      prompt: input.promptText,
      requestedSourceIds: [input.sourceId],
      sourceId: input.sourceId,
      dryRun: false,
      status: input.runStatus,
      startedAt: "2026-04-16T00:00:00.000Z",
      finishedAt: input.runStatus === "failed" ? "2026-04-16T00:00:05.000Z" : undefined,
      normalizedSummary: `change behavior for ${input.sourceId}`,
      runId,
      intentPlan: {
        summary: `change behavior for ${input.sourceId}`,
        intentType: "change-behavior",
        sourceId: input.sourceId,
        linear: {
          createIssue: false,
          issueTitle: ""
        },
        planning: {
          reviewNotes: [],
          linearPlan: {
            mode: "new"
          }
        },
        businessIntent: {
          statement: input.promptText,
          desiredOutcome: input.desiredOutcome,
          acceptanceCriteria: input.acceptanceCriteria.map((description, index) => ({
            id: `ac-${index + 1}`,
            description,
            origin: "inferred"
          })),
          scenarios: [],
          workItems: [
            {
              id: workItemId,
              type: "playwright-spec",
              verificationMode: "mocked-state-playwright",
              title: input.workItemTitle,
              description: input.desiredOutcome,
              scenarioIds: [],
              sourceIds: [input.sourceId],
              userVisibleOutcome: input.desiredOutcome,
              verification: "A generated Playwright spec with mocked Studio app state validates lifecycle state handling through the Studio UI.",
              execution: {
                order: 1,
                dependsOnWorkItemIds: []
              },
              playwright: {
                generatedBy: "rules",
                specs: [
                  {
                    framework: "playwright",
                    sourceId: input.sourceId,
                    relativeSpecPath: `${input.sourceId}/mock-lifecycle.spec.ts`,
                    suiteName: `Intent-driven flow for ${input.sourceId}`,
                    testName: input.workItemTitle,
                    scenarioIds: [],
                    checkpoints: []
                  }
                ]
              }
            }
          ]
        },
        executionPlan: {
          primarySourceId: input.sourceId,
          sources: [
            {
              sourceId: input.sourceId,
              selectionReason: `Source ${input.sourceId} was selected in the requested source scope.`,
              captureScope: {
                mode: "all",
                captureIds: []
              },
              warnings: []
            }
          ],
          tools: [
            {
              id: "playwright-tdd",
              type: "playwright-tdd",
              label: "Playwright TDD generation",
              enabled: true,
              reason: "Lifecycle verification is exposed through the Studio UI.",
              details: ["Tracked specs validate Studio lifecycle state handling."]
            }
          ],
          destinations: [
            {
              id: "controller-artifacts",
              type: "controller",
              label: "Controller artifacts",
              status: "active",
              reason: "Local evidence bundles are always written by the controller.",
              details: ["Stores plan, manifests, logs, captures, and summaries on disk."]
            }
          ]
        }
      },
      events: [],
      captures: [],
      sourceRuns: [
        {
          sourceId: input.sourceId,
          status: input.runStatus === "failed" ? "failed" : "running",
          lifecycleStatus: input.lifecycleStatus,
          implementationStageStatus: input.implementationStageStatus,
          qaVerificationStageStatus: input.qaVerificationStageStatus,
          targetedWorkItemIds: [workItemId],
          completedWorkItemIds: [],
          remainingWorkItemIds: [workItemId],
          completedWorkItemCount: 0,
          remainingWorkItemCount: 1,
          latestImplementationSummary: input.latestImplementationSummary,
          captureScopeSummary: "Capture scope: all configured captures (0 executed).",
          sourceWarnings: []
        }
      ],
      artifacts: {
        summaryPath: "artifacts/business/summary.md"
      }
    },
    recentRuns: [],
    serverTime: "2026-04-16T00:00:05.000Z"
  };
}

function buildIntentStudioLifecyclePlaywrightCheckpoints(input: {
  sourceId: string;
  workItemTitle: string;
  promptText: string;
  desiredOutcome: string;
  acceptanceCriteria: string[];
  scenario?: BDDScenario;
  uiStateRequirements: ResolvedUiStateRequirement[];
}): PlaywrightCheckpoint[] {
  const combinedText = [
    input.promptText,
    input.desiredOutcome,
    ...input.acceptanceCriteria,
    input.scenario?.title ?? "",
    input.scenario?.goal ?? "",
    ...(input.scenario?.given ?? []),
    ...(input.scenario?.when ?? []),
    ...(input.scenario?.then ?? [])
  ].join(" ");
  const includesFailureFlow = /\b(fail|failure|revert|reverted|reversion|rollback|error)\b/i.test(combinedText);
  const executingState = buildIntentStudioLifecycleMockState({
    sourceId: input.sourceId,
    promptText: input.promptText,
    desiredOutcome: input.desiredOutcome,
    acceptanceCriteria: input.acceptanceCriteria,
    workItemTitle: input.workItemTitle,
    runStatus: "running",
    lifecycleStatus: "executing",
    implementationStageStatus: "running",
    qaVerificationStageStatus: "pending",
    latestImplementationSummary: "Implementation is applying the planned lifecycle changes."
  });

  const checkpoints: PlaywrightCheckpoint[] = [
    {
      id: createPlanId("checkpoint", `${input.workItemTitle}-mock-executing-state`, 0),
      label: "Lifecycle State Running",
      action: "mock-studio-state",
      assertion: "The Studio renders an executing lifecycle state for the active run.",
      screenshotId: createPlanId("shot", `${input.workItemTitle}-mock-executing-state`, 0),
      path: "/",
      waitForSelector: "#step-implementation-status",
      waitUntil: "domcontentloaded",
      mockStudioState: executingState,
      ...(input.uiStateRequirements.length > 0 ? { requiredUiStates: input.uiStateRequirements } : {})
    },
    {
      id: createPlanId("checkpoint", `${input.workItemTitle}-runner-running`, 1),
      label: "Runner Status Shows Running",
      action: "assert-attribute-contains",
      assertion: input.desiredOutcome,
      screenshotId: createPlanId("shot", `${input.workItemTitle}-runner-running`, 1),
      target: "#current-status-pill",
      attributeName: "class",
      expectedSubstring: "status-running",
      waitForSelector: "#current-status-pill",
      ...(input.uiStateRequirements.length > 0 ? { requiredUiStates: input.uiStateRequirements } : {})
    },
    {
      id: createPlanId("checkpoint", `${input.workItemTitle}-plan-step-completed`, 2),
      label: "Planned Execution Step Completed",
      action: "assert-attribute-contains",
      assertion: "The planned execution step is marked complete once a run is active.",
      screenshotId: createPlanId("shot", `${input.workItemTitle}-plan-step-completed`, 2),
      target: "#step-plan-status",
      attributeName: "data-state",
      expectedSubstring: "completed",
      waitForSelector: "#step-plan-status",
      ...(input.uiStateRequirements.length > 0 ? { requiredUiStates: input.uiStateRequirements } : {})
    },
    {
      id: createPlanId("checkpoint", `${input.workItemTitle}-implementation-step-running`, 3),
      label: "Implementation Step Running",
      action: "assert-attribute-contains",
      assertion: "The implementation lifecycle step reflects active execution.",
      screenshotId: createPlanId("shot", `${input.workItemTitle}-implementation-step-running`, 3),
      target: "#step-implementation-status",
      attributeName: "data-state",
      expectedSubstring: "running",
      waitForSelector: "#step-implementation-status",
      ...(input.uiStateRequirements.length > 0 ? { requiredUiStates: input.uiStateRequirements } : {})
    }
  ];

  if (includesFailureFlow) {
    const revertedState = buildIntentStudioLifecycleMockState({
      sourceId: input.sourceId,
      promptText: input.promptText,
      desiredOutcome: input.desiredOutcome,
      acceptanceCriteria: input.acceptanceCriteria,
      workItemTitle: input.workItemTitle,
      runStatus: "failed",
      lifecycleStatus: "reverted",
      implementationStageStatus: "failed",
      qaVerificationStageStatus: "failed",
      latestImplementationSummary: "The lifecycle reverted after the runner detected a failed execution path."
    });

    checkpoints.push(
      {
        id: createPlanId("checkpoint", `${input.workItemTitle}-mock-reverted-state`, checkpoints.length),
        label: "Lifecycle State Reverted",
        action: "mock-studio-state",
        assertion: "The Studio renders a failed run after lifecycle reversion is triggered.",
        screenshotId: createPlanId("shot", `${input.workItemTitle}-mock-reverted-state`, checkpoints.length),
        path: "/",
        waitForSelector: "#current-status-pill",
        waitUntil: "domcontentloaded",
        mockStudioState: revertedState,
        ...(input.uiStateRequirements.length > 0 ? { requiredUiStates: input.uiStateRequirements } : {})
      },
      {
        id: createPlanId("checkpoint", `${input.workItemTitle}-runner-failed`, checkpoints.length + 1),
        label: "Runner Status Shows Failed",
        action: "assert-attribute-contains",
        assertion: "The lifecycle shows a failed run after reversion.",
        screenshotId: createPlanId("shot", `${input.workItemTitle}-runner-failed`, checkpoints.length + 1),
        target: "#current-status-pill",
        attributeName: "class",
        expectedSubstring: "status-failed",
        waitForSelector: "#current-status-pill",
        ...(input.uiStateRequirements.length > 0 ? { requiredUiStates: input.uiStateRequirements } : {})
      }
    );
  }

  return checkpoints;
}

function buildIntentStudioPlaywrightCheckpoints(input: {
  scenario?: BDDScenario;
  workItemTitle: string;
  promptText: string;
  desiredOutcome: string;
  acceptanceCriteria: string[];
  uiStateRequirements: ResolvedUiStateRequirement[];
}): PlaywrightCheckpoint[] {
  const normalizedPromptText = input.promptText.toLowerCase();
  const scenarioText = [
    input.workItemTitle,
    input.desiredOutcome,
    ...input.acceptanceCriteria,
    ...(input.scenario?.given ?? []),
    ...(input.scenario?.when ?? []),
    ...(input.scenario?.then ?? [])
  ]
    .join(" ")
    .toLowerCase();
  const usesGenericScenarioFallback = input.scenario ? isGenericScenarioTitle(input.scenario.title) : true;
  const routingText = usesGenericScenarioFallback ? `${scenarioText} ${normalizedPromptText}`.trim() : scenarioText;
  const resultsLinkPattern = /\b(results page|results screen|run results|bottom of the page|bottom of the results page|artifact links?|screenshot links?|capture previews?|thumbnail|thumbnails)\b/i;
  const resultsTargetPattern = /\b(link|links|linked|preview|previews|thumbnail|thumbnails|image|images|screenshot|screenshots|artifact)\b/i;
  const isResultsLinkFlow = resultsLinkPattern.test(routingText) && resultsTargetPattern.test(routingText);
  const isCollapseFlow = /\bcollapse|collapsed|collapsable|collapsible|hide\b/i.test(routingText);
  const isExpandFlow = /\bexpand|expanded|show|restore\b/i.test(routingText);
  const mentionsPromptInput = /\b(prompt|input|textarea|text area|input box|prompt box)\b/i.test(routingText);
  const mentionsRunButton = /\b(run intent|submit|button)\b/i.test(routingText);
  const mentionsBelowRelationship = /\b(under|below|beneath)\b/i.test(routingText);
  const isLayoutFlow = /\blayout|placement|position\b/i.test(routingText) || (mentionsPromptInput && mentionsRunButton);
  const shouldAssertPromptButtonPlacement = isLayoutFlow && mentionsPromptInput && mentionsRunButton && mentionsBelowRelationship;
  const includesWorkScopeSection = /\b(work scope|source scope)\b/i.test(routingText);
  const includesStepsSection = /\b(steps|stages|optional config|optional configuration|configuration section|orchestration stages)\b/i.test(
    routingText
  );
  const isRunIndicatorFlow = hasIntentStudioRunIndicatorSignals(routingText);
  const checkpointUiStateFields = input.uiStateRequirements.length > 0 ? { requiredUiStates: input.uiStateRequirements } : {};

  if (isResultsLinkFlow) {
    const runId = "2026-04-16T00-00-00-000Z-intent-poc-app";
    const imagePath = "artifacts/sources/intent-poc-app/captures/verify-screenshot-artifact-linking.png";
    const expectedFileUrl = toFileUrlPath(imagePath) ?? "#";
    const mockStudioState: Record<string, unknown> = {
      configPath: "intent-poc.yaml",
      linearEnabled: false,
      defaultSourceId: "intent-poc-app",
      agentStages: [],
      sources: [
        {
          id: "intent-poc-app",
          label: "Intent POC App",
          repoLabel: "Intent POC",
          role: "controller-and-demo-source",
          summary: "Intent Studio and surface library source.",
          aliases: ["demo", "intent-poc-app"],
          captureCount: 1,
          sourceType: "local",
          sourceLocation: ".",
          startCommand: "echo start",
          readiness: "HTTP http://127.0.0.1:6006",
          baseUrl: "http://127.0.0.1:6006",
          defaultScope: true,
          status: "ready",
          issues: [],
          notes: []
        }
      ],
      currentRun: {
        sessionId: "session-1",
        prompt: input.desiredOutcome,
        requestedSourceIds: ["intent-poc-app"],
        sourceId: "intent-poc-app",
        dryRun: true,
        status: "completed",
        startedAt: "2026-04-16T00:00:00.000Z",
        finishedAt: "2026-04-16T00:00:05.000Z",
        runId,
        events: [],
        captures: [
          {
            sourceId: "intent-poc-app",
            captureId: "verify-screenshot-artifact-linking",
            status: "captured",
            url: "/results",
            imagePath
          }
        ],
        sourceRuns: [],
        artifacts: {
          summaryPath: "artifacts/business/summary.md"
        }
      },
      recentRuns: [],
      serverTime: "2026-04-16T00:00:05.000Z"
    };

    return [
      {
        id: createPlanId("checkpoint", `${input.workItemTitle}-mock-results-page`, 0),
        label: "Results Page Mocked Run State",
        action: "mock-studio-state",
        assertion: "The Intent Studio results page renders mocked capture output for review.",
        screenshotId: createPlanId("shot", `${input.workItemTitle}-mock-results-page`, 0),
        path: "/",
        waitForSelector: "#captures .capture-card img",
        waitUntil: "domcontentloaded",
        mockStudioState,
        ...checkpointUiStateFields
      },
      {
        id: createPlanId("checkpoint", `${input.workItemTitle}-capture-preview-src`, 1),
        label: "Capture Preview Uses Run Artifact Path",
        action: "assert-attribute-contains",
        assertion: input.desiredOutcome,
        screenshotId: createPlanId("shot", `${input.workItemTitle}-capture-preview-src`, 1),
        target: "#captures .capture-card img",
        attributeName: "src",
        expectedSubstring: expectedFileUrl,
        waitForSelector: "#captures .capture-card img",
        ...checkpointUiStateFields
      },
      {
        id: createPlanId("checkpoint", `${input.workItemTitle}-capture-link-href`, 2),
        label: "Capture Link Uses Run Artifact Path",
        action: "assert-attribute-contains",
        assertion: input.desiredOutcome,
        screenshotId: createPlanId("shot", `${input.workItemTitle}-capture-link-href`, 2),
        target: "#captures .capture-card .capture-links a",
        attributeName: "href",
        expectedSubstring: expectedFileUrl,
        waitForSelector: "#captures .capture-card .capture-links a",
        ...checkpointUiStateFields
      }
    ];
  }

  const checkpoints: PlaywrightCheckpoint[] = [
    {
      id: createPlanId("checkpoint", `${input.workItemTitle}-open-intent-studio`, 0),
      label: "Intent Studio Prompt Run",
      action: "goto",
      assertion: "The Intent Studio prompt input is visible and ready for interaction.",
      screenshotId: createPlanId("shot", `${input.workItemTitle}-intent-studio`, 0),
      path: "/",
      waitForSelector: "#prompt-input",
      waitUntil: "domcontentloaded",
      ...checkpointUiStateFields
    }
  ];

  if (isRunIndicatorFlow) {
    checkpoints.push(
      {
        id: createPlanId("checkpoint", `${input.workItemTitle}-indicator-visible`, checkpoints.length),
        label: "Test Status Indicator Visible",
        action: "assert-visible",
        assertion: "The live test status indicator is visible while the Studio run is active.",
        screenshotId: createPlanId("shot", `${input.workItemTitle}-indicator-visible`, checkpoints.length),
        target: "[data-testid='test-status-indicator']",
        waitForSelector: "[data-testid='test-status-indicator']",
        ...checkpointUiStateFields
      },
      {
        id: createPlanId("checkpoint", `${input.workItemTitle}-indicator-running`, checkpoints.length + 1),
        label: "Test Status Indicator Shows Running",
        action: "assert-attribute-contains",
        assertion: input.desiredOutcome,
        screenshotId: createPlanId("shot", `${input.workItemTitle}-indicator-running`, checkpoints.length + 1),
        target: "[data-testid='test-status-indicator']",
        attributeName: "class",
        expectedSubstring: "status-running",
        waitForSelector: "[data-testid='test-status-indicator']",
        ...checkpointUiStateFields
      },
      {
        id: createPlanId("checkpoint", `${input.workItemTitle}-indicator-state-code`, checkpoints.length + 2),
        label: "Test Status Indicator Shows QA State Code",
        action: "assert-attribute-contains",
        assertion: "The live indicator exposes the generated Playwright QA state code while verification is running.",
        screenshotId: createPlanId("shot", `${input.workItemTitle}-indicator-state-code`, checkpoints.length + 2),
        target: "[data-testid='test-status-indicator']",
        attributeName: "data-state-code",
        expectedSubstring: "QA_GENERATED_PLAYWRIGHT_RUNNING",
        waitForSelector: "[data-testid='test-status-indicator']",
        ...checkpointUiStateFields
      },
      {
        id: createPlanId("checkpoint", `${input.workItemTitle}-runner-status-running`, checkpoints.length + 3),
        label: "Runner Status Shows Running",
        action: "assert-attribute-contains",
        assertion: "The active Studio run is marked running while generated QA is executing.",
        screenshotId: createPlanId("shot", `${input.workItemTitle}-runner-status-running`, checkpoints.length + 3),
        target: "#current-status-pill",
        attributeName: "class",
        expectedSubstring: "status-running",
        waitForSelector: "#current-status-pill",
        ...checkpointUiStateFields
      }
    );

    return checkpoints;
  }

  if (shouldAssertPromptButtonPlacement) {
    checkpoints.push({
      id: createPlanId("checkpoint", `${input.workItemTitle}-submit-button-visible`, checkpoints.length),
      label: "Run Intent Button Visible",
      action: "assert-visible",
      assertion: "The run intent button is visible on the prompt run form.",
      screenshotId: createPlanId("shot", `${input.workItemTitle}-submit-button-visible`, checkpoints.length),
      target: "#submit-button",
      waitForSelector: "#submit-button",
      ...checkpointUiStateFields
    });
    checkpoints.push({
      id: createPlanId("checkpoint", `${input.workItemTitle}-submit-button-below-input`, checkpoints.length),
      label: "Run Intent Button Below Prompt Input",
      action: "assert-below",
      assertion: input.desiredOutcome,
      screenshotId: createPlanId("shot", `${input.workItemTitle}-submit-button-below-input`, checkpoints.length),
      target: "#submit-button",
      referenceTarget: "#prompt-input",
      waitForSelector: "#submit-button",
      ...checkpointUiStateFields
    });
  }

  const addSectionCollapseFlow = (section: {
    key: string;
    label: string;
    toggleTarget: string;
    collapsedTarget: string;
    expandedTarget: string;
    visibleAssertion: string;
    collapsedAssertion: string;
    expandedAssertion: string;
  }): void => {
    checkpoints.push({
      id: createPlanId("checkpoint", `${input.workItemTitle}-${section.key}-visible`, checkpoints.length),
      label: `${section.label} Visible`,
      action: "assert-visible",
      assertion: section.visibleAssertion,
      screenshotId: createPlanId("shot", `${input.workItemTitle}-${section.key}-visible`, checkpoints.length),
      target: section.collapsedTarget,
      waitForSelector: section.collapsedTarget,
      ...checkpointUiStateFields
    });

    if (isCollapseFlow || isExpandFlow) {
      checkpoints.push({
        id: createPlanId("checkpoint", `${input.workItemTitle}-${section.key}-collapse-toggle`, checkpoints.length),
        label: `Collapse ${section.label}`,
        action: "click",
        assertion: `The collapse toggle is available for the ${section.label.toLowerCase()}.`,
        screenshotId: createPlanId("shot", `${input.workItemTitle}-${section.key}-collapse-toggle`, checkpoints.length),
        target: section.toggleTarget,
        waitForSelector: section.toggleTarget,
        ...checkpointUiStateFields
      });
      checkpoints.push({
        id: createPlanId("checkpoint", `${input.workItemTitle}-${section.key}-collapsed`, checkpoints.length),
        label: `${section.label} Collapsed`,
        action: "assert-hidden",
        assertion: section.collapsedAssertion,
        screenshotId: createPlanId("shot", `${input.workItemTitle}-${section.key}-collapsed`, checkpoints.length),
        target: section.collapsedTarget,
        waitForSelector: section.collapsedTarget,
        ...checkpointUiStateFields
      });
    }

    if (isExpandFlow) {
      checkpoints.push({
        id: createPlanId("checkpoint", `${input.workItemTitle}-${section.key}-expand-toggle`, checkpoints.length),
        label: `Expand ${section.label}`,
        action: "click",
        assertion: `The expand toggle is available when the ${section.label.toLowerCase()} is collapsed.`,
        screenshotId: createPlanId("shot", `${input.workItemTitle}-${section.key}-expand-toggle`, checkpoints.length),
        target: section.toggleTarget,
        waitForSelector: section.toggleTarget,
        ...checkpointUiStateFields
      });
      checkpoints.push({
        id: createPlanId("checkpoint", `${input.workItemTitle}-${section.key}-expanded`, checkpoints.length),
        label: `${section.label} Expanded`,
        action: "assert-visible",
        assertion: section.expandedAssertion,
        screenshotId: createPlanId("shot", `${input.workItemTitle}-${section.key}-expanded`, checkpoints.length),
        target: section.expandedTarget,
        waitForSelector: section.expandedTarget,
        ...checkpointUiStateFields
      });
    }
  };

  if (includesWorkScopeSection) {
    addSectionCollapseFlow({
      key: "work-scope",
      label: "Work Scope Section",
      toggleTarget: "#toggle-work-scope-visibility",
      collapsedTarget: "#work-scope-panel",
      expandedTarget: "#source-scope",
      visibleAssertion: "The work scope section is visible before interaction.",
      collapsedAssertion: "The work scope section can be collapsed without affecting the prompt input.",
      expandedAssertion: "The work scope section can be expanded again and the configured source cards are visible."
    });
  }

  if (includesStepsSection) {
    addSectionCollapseFlow({
      key: "steps",
      label: "Steps Section",
      toggleTarget: "#toggle-stages-visibility",
      collapsedTarget: "#steps-panel",
      expandedTarget: "#agent-stages-grid",
      visibleAssertion: "The steps section is visible before interaction.",
      collapsedAssertion: isCollapseFlow
        ? input.desiredOutcome
        : "The steps section can be collapsed before it is expanded again.",
      expandedAssertion: isExpandFlow
        ? input.desiredOutcome
        : "The steps section can be expanded again and remains interactable."
    });
  }

  if (!shouldAssertPromptButtonPlacement && !includesWorkScopeSection && !includesStepsSection) {
    checkpoints.push({
      id: createPlanId("checkpoint", `${input.workItemTitle}-stage-grid-visible`, checkpoints.length),
      label: "Configuration Section Visible",
      action: "assert-visible",
      assertion: "The optional configuration section is visible before interaction.",
      screenshotId: createPlanId("shot", `${input.workItemTitle}-configuration-visible`, checkpoints.length),
      target: "#agent-stages-grid",
      waitForSelector: "#agent-stages-grid",
      ...checkpointUiStateFields
    });
  }

  return checkpoints;
}

function buildPlaywrightSpecs(input: {
  codeSurface: CodeSurfaceSelection;
  scenario?: BDDScenario;
  workItemId: string;
  title: string;
  promptText: string;
  scenarioIds: string[];
  sourceIds: string[];
  desiredOutcome: string;
  acceptanceCriteria: string[];
  captureScope: NormalizedIntent["captureScope"];
  uiStateRequirements: ResolvedUiStateRequirement[];
  availableSources: Record<string, AvailableSourceDescriptor>;
}): PlaywrightSpecBuildResult {
  const warnings: string[] = [];
  const specs: PlaywrightSpecArtifact[] = input.sourceIds.map((sourceId) => {
    const source = input.availableSources[sourceId];
    const captureSelection = selectRelevantCaptureItemsForScenario({
      scenario: input.scenario,
      captureItems: source?.capture.items ?? [],
      captureScope: input.captureScope
    });

    warnings.push(...captureSelection.warnings.map((warning) => `${warning} Source: ${sourceId}.`));

    return {
      framework: "playwright",
      sourceId,
      relativeSpecPath: buildPlaywrightSpecRelativePath(sourceId, input.title, input.workItemId),
      suiteName: `Intent-driven flow for ${sourceId}`,
      testName: input.title,
      scenarioIds: input.scenarioIds,
      requiredUiStates: input.uiStateRequirements.length > 0 ? input.uiStateRequirements : undefined,
      checkpoints: buildPlaywrightCheckpoints({
        sourceId,
        codeSurface: input.codeSurface,
        scenario: input.scenario,
        captureItems: captureSelection.captureItems,
        workItemTitle: input.title,
        promptText: input.promptText,
        desiredOutcome: input.desiredOutcome,
        acceptanceCriteria: input.acceptanceCriteria,
        uiStateRequirements: input.uiStateRequirements
      })
    };
  });

  return {
    specs,
    warnings: dedupeValues(warnings)
  };
}

function buildScenarioNarrativeText(scenario: BDDScenario): string {
  return [scenario.title, scenario.goal, ...scenario.when, ...scenario.then].join(" ").toLowerCase();
}

function isGenericScenarioTitle(title: string): boolean {
  return [
    "intent is translated into acceptance-ready work",
    "behavior is verified visually for applicable sources",
    "results are distributed consistently"
  ].includes(title.toLowerCase());
}

function tokenizeCaptureMatchText(text: string): string[] {
  const stopWords = new Set([
    "again",
    "attempt",
    "attempts",
    "batch",
    "batches",
    "catalog",
    "comparison",
    "component",
    "components",
    "completed",
    "coverage",
    "demo",
    "evidence",
    "generated",
    "grouped",
    "grouping",
    "image",
    "images",
    "lane",
    "lanes",
    "library",
    "page",
    "pages",
    "pending",
    "report",
    "reported",
    "reporting",
    "review",
    "runtime",
    "screen",
    "screens",
    "shot",
    "shots",
    "source",
    "sources",
    "surface",
    "surfaces",
    "verification",
    "view",
    "views",
    "visual",
    "workflow"
  ]);

  return Array.from(
    new Set((text.match(/[a-z0-9]+/g) ?? []).filter((token) => token.length > 2 && !stopWords.has(token)))
  );
}

function filterCaptureItemsByScope(
  captureItems: CaptureItemConfig[],
  captureScope: NormalizedIntent["captureScope"]
): CaptureItemConfig[] {
  if (captureScope.mode !== "subset") {
    return captureItems;
  }

  const selectedCaptureIds = new Set(captureScope.captureIds);
  return captureItems.filter((item) => selectedCaptureIds.has(item.id));
}

function buildCaptureItemSearchText(item: CaptureItemConfig): string {
  return [item.id, item.name ?? "", item.path, item.relativeOutputPath ?? "", item.locator ?? "", item.waitForSelector ?? ""]
    .join(" ")
    .toLowerCase();
}

function selectRelevantCaptureItemsForScenario(input: {
  scenario?: BDDScenario;
  captureItems: CaptureItemConfig[];
  captureScope: NormalizedIntent["captureScope"];
}): CaptureItemSelection {
  const scopedCaptureItems = filterCaptureItemsByScope(input.captureItems, input.captureScope);

  if (!input.scenario || scopedCaptureItems.length <= 1) {
    return {
      captureItems: scopedCaptureItems,
      warnings: []
    };
  }

  const scenarioText = buildScenarioNarrativeText(input.scenario);
  const exactMatches = scopedCaptureItems.filter((item) => {
    const normalizedId = item.id.toLowerCase();
    const normalizedName = item.name?.toLowerCase();

    return scenarioText.includes(normalizedId) || (normalizedName ? scenarioText.includes(normalizedName) : false);
  });

  if (exactMatches.length > 0) {
    return {
      captureItems: exactMatches,
      warnings: []
    };
  }

  const scenarioTokens = new Set(tokenizeCaptureMatchText(scenarioText));
  const scoredCaptureItems = scopedCaptureItems
    .map((item) => {
      const itemTokens = new Set(tokenizeCaptureMatchText(buildCaptureItemSearchText(item)));
      const overlapCount = Array.from(itemTokens).filter((token) => scenarioTokens.has(token)).length;
      const pathBonus = scenarioText.includes(item.path.toLowerCase()) ? 2 : 0;

      return {
        item,
        score: overlapCount + pathBonus
      };
    })
    .filter((entry) => entry.score > 0);

  if (scoredCaptureItems.length === 0) {
    return {
      captureItems: scopedCaptureItems,
      warnings: isGenericScenarioTitle(input.scenario.title)
        ? []
        : [
            `Scenario "${input.scenario.title}" did not strongly match a specific capture item, so the planner kept the current capture scope.`
          ]
    };
  }

  const bestScore = Math.max(...scoredCaptureItems.map((entry) => entry.score));
  if (bestScore < 2) {
    return {
      captureItems: scopedCaptureItems,
      warnings: isGenericScenarioTitle(input.scenario.title)
        ? []
        : [
            `Scenario "${input.scenario.title}" did not strongly match a specific capture item, so the planner kept the current capture scope.`
          ]
    };
  }

  return {
    captureItems: scoredCaptureItems.filter((entry) => entry.score === bestScore).map((entry) => entry.item),
    warnings: []
  };
}

function tokenizeScenarioText(text: string): string[] {
  const stopWords = new Set([
    "again",
    "below",
    "each",
    "input",
    "intent",
    "prompt",
    "remains",
    "section",
    "sections",
    "stays",
    "that",
    "the",
    "then",
    "user",
    "verify",
    "when"
  ]);

  return (text.match(/[a-z0-9]+/g) ?? []).filter((token) => token.length > 2 && !stopWords.has(token));
}

function selectRelevantAcceptanceCriteria(
  scenario: BDDScenario,
  acceptanceCriteria: NormalizedIntent["businessIntent"]["acceptanceCriteria"]
): AcceptanceCriteriaSelection {
  const scenarioContext = [scenario.title, scenario.goal, ...scenario.given, ...scenario.when].join(" ").toLowerCase();
  const scenarioTokens = new Set(tokenizeScenarioText(scenarioContext));
  const scoredCriteria = acceptanceCriteria
    .map((criterion) => {
      const normalizedDescription = criterion.description.toLowerCase();
      const overlapCount = tokenizeScenarioText(normalizedDescription).filter((token) => scenarioTokens.has(token)).length;
      const exactMatch = scenarioContext.includes(normalizedDescription);

      return {
        criterion,
        score: exactMatch ? Number.MAX_SAFE_INTEGER : overlapCount
      };
    })
    .filter((entry) => entry.score >= 2);

  if (scoredCriteria.length === 0) {
    return {
      descriptions: [],
      warnings: isGenericScenarioTitle(scenario.title)
        ? []
        : [
            `Scenario "${scenario.title}" did not strongly match any acceptance criteria, so the planner kept verification bounded to scenario-local checkpoints.`
          ]
    };
  }

  const bestScore = Math.max(...scoredCriteria.map((entry) => entry.score));
  return {
    descriptions: scoredCriteria
      .filter((entry) => entry.score === bestScore)
      .slice(0, 2)
      .map((entry) => entry.criterion.description),
    warnings: []
  };
}

function isExecutableVisualScenario(scenario: BDDScenario): boolean {
  const text = buildScenarioNarrativeText(scenario);
  const visualSignalPattern =
    /\b(playwright|screenshot|screen ?shot|visual|capture|visible|page|screen|component|view|click|toggle|toggles|collapse|collapsed|expand|expanded|collapsible|button|buttons|modal|dialog|header|form|forms|theme|ui)\b/i;
  const strongExecutionSignalPattern =
    /\b(playwright|screenshot|screen ?shot|click|toggle|toggles|collapse|collapsed|expand|expanded|collapsible|button|buttons|page|screen|component|view|modal|dialog|header|form|forms|theme|ui)\b/i;
  const processOnlyPattern =
    /\b(planner|planning|acceptance criteria|acceptance-ready|decompose|distribution|distribute|publishing|publish|destination|stakeholder|summary|manifest|package|issue|linear|business process|workflow gate)\b/i;

  if (!visualSignalPattern.test(text)) {
    return false;
  }

  if (!processOnlyPattern.test(text)) {
    return true;
  }

  return strongExecutionSignalPattern.test(text);
}

function buildWorkItemVerification(scenario: BDDScenario): string {
  const explicitEvidenceExpectation = scenario.then.find((entry) => /\b(screenshot|capture|evidence|image)\b/i.test(entry));
  if (explicitEvidenceExpectation) {
    return explicitEvidenceExpectation;
  }

  return "A generated Playwright spec captures reviewable screenshots so QA can run this verification automatically.";
}

function buildEmptyIntentDecomposition(): IntentDecomposition {
  return {
    objectives: [],
    workstreams: [],
    tasks: [],
    subtasks: [],
    verificationTasks: []
  };
}

function buildIntentDecomposition(input: {
  statement: string;
  desiredOutcome: string;
  sourceIds: string[];
  workItems: TDDWorkItem[];
  scenarios: NormalizedIntent["businessIntent"]["scenarios"];
}): IntentDecomposition {
  if (input.workItems.length === 0) {
    return buildEmptyIntentDecomposition();
  }

  const objectiveId = createPlanId("objective", input.statement, 0);
  const workstreams = input.sourceIds.map((sourceId, sourceIndex) => {
    const sourceWorkItems = input.workItems.filter((workItem) => workItem.sourceIds.includes(sourceId));
    const workstreamId = createPlanId("workstream", sourceId, sourceIndex);
    const tasksByScenario = new Map<string, TDDWorkItem[]>();

    for (const workItem of sourceWorkItems) {
      const taskKey = workItem.scenarioIds[0] ?? `source-${sourceId}`;
      const existingTaskWorkItems = tasksByScenario.get(taskKey);
      if (existingTaskWorkItems) {
        existingTaskWorkItems.push(workItem);
      } else {
        tasksByScenario.set(taskKey, [workItem]);
      }
    }

    const tasks = Array.from(tasksByScenario.entries()).map(([taskKey, taskWorkItems], taskIndex) => {
      const scenario = input.scenarios.find((candidate) => candidate.id === taskKey);
      const taskId = createPlanId("task", `${sourceId}-${taskKey}`, taskIndex);
      const subtasks: IntentDecomposition["subtasks"] = taskWorkItems.map((workItem, subtaskIndex) => {
        const subtaskId = createPlanId("subtask", workItem.id, subtaskIndex);
        workItem.execution.objectiveId = objectiveId;
        workItem.execution.workstreamId = workstreamId;
        workItem.execution.taskId = taskId;
        workItem.execution.subtaskId = subtaskId;

        return {
          id: subtaskId,
          title: workItem.title,
          summary: workItem.description,
          scenarioIds: workItem.scenarioIds,
          sourceIds: workItem.sourceIds,
          workItemIds: [workItem.id],
          verificationTaskIds: [createPlanId("verify", workItem.id, subtaskIndex)],
          dependsOnSubtaskIds: []
        };
      });

      for (let subtaskIndex = 0; subtaskIndex < taskWorkItems.length; subtaskIndex += 1) {
        const workItem = taskWorkItems[subtaskIndex];
        const subtask = subtasks[subtaskIndex];
        if (!workItem || !subtask) {
          continue;
        }

        subtask.dependsOnSubtaskIds = taskWorkItems
          .filter((candidate) => workItem.execution.dependsOnWorkItemIds.includes(candidate.id))
          .map((candidate) => candidate.execution.subtaskId)
          .filter((dependencyId): dependencyId is string => Boolean(dependencyId));
      }

      return {
        task: {
          id: taskId,
          title: scenario?.title ?? `Deliver ${sourceId}`,
          summary: scenario?.goal ?? `Execute the planned change set for ${sourceId}.`,
          sourceIds: [sourceId],
          scenarioIds: taskWorkItems.flatMap((workItem) => workItem.scenarioIds),
          workItemIds: taskWorkItems.map((workItem) => workItem.id),
          subtaskIds: subtasks.map((subtask) => subtask.id),
          verificationTaskIds: subtasks.flatMap((subtask) => subtask.verificationTaskIds)
        },
        subtasks,
        verificationTasks: subtasks.map((subtask) => ({
          id: subtask.verificationTaskIds[0] ?? createPlanId("verify", subtask.id, 0),
          title: `Verify ${subtask.title}`,
          summary: `Verify the user-visible outcome for ${subtask.title}.`,
          sourceIds: subtask.sourceIds,
          workItemIds: subtask.workItemIds
        }))
      };
    });

    return {
      workstream: {
        id: workstreamId,
        title: `Source workstream: ${sourceId}`,
        summary: `Deliver the reviewed intent in ${sourceId}.`,
        sourceIds: [sourceId],
        taskIds: tasks.map((entry) => entry.task.id)
      },
      tasks
    };
  });

  return {
    objectives: [
      {
        id: objectiveId,
        title: input.statement,
        summary: input.statement,
        desiredOutcome: input.desiredOutcome,
        workstreamIds: workstreams.map((entry) => entry.workstream.id)
      }
    ],
    workstreams: workstreams.map((entry) => entry.workstream),
    tasks: workstreams.flatMap((entry) => entry.tasks.map((taskEntry) => taskEntry.task)),
    subtasks: workstreams.flatMap((entry) => entry.tasks.flatMap((taskEntry) => taskEntry.subtasks)),
    verificationTasks: workstreams.flatMap((entry) => entry.tasks.flatMap((taskEntry) => taskEntry.verificationTasks))
  };
}

function buildWorkItems(input: {
  codeSurface: CodeSurfaceSelection;
  rawPrompt: string;
  scenarios: NormalizedIntent["businessIntent"]["scenarios"];
  acceptanceCriteria: NormalizedIntent["businessIntent"]["acceptanceCriteria"];
  sourcePlans: NormalizedIntent["executionPlan"]["sources"];
  sourceIds: string[];
  desiredOutcome: string;
  availableSources: Record<string, AvailableSourceDescriptor>;
}): WorkItemBuildResult {
  const warnings: string[] = [];
  const orchestratorVerificationMode = resolveOrchestratorBehaviorVerificationMode({
    codeSurface: input.codeSurface,
    sourceIds: input.sourceIds,
    rawPrompt: input.rawPrompt,
    desiredOutcome: input.desiredOutcome,
    acceptanceCriteria: input.acceptanceCriteria
  });

  if (orchestratorVerificationMode === "mocked-state-playwright") {
    const workItems: TDDWorkItem[] = input.sourceIds.map((sourceId, index) => {
        const scenarioIds = input.scenarios
          .filter((scenario) => scenario.applicableSourceIds.includes(sourceId))
          .map((scenario) => scenario.id);
        const sourcePlan = input.sourcePlans.find((candidate) => candidate.sourceId === sourceId);
        const captureScope = sourcePlan?.captureScope ?? {
          mode: "all",
          captureIds: []
        };
        const uiStateRequirements = sourcePlan?.uiStateRequirements ?? [];
        const id = createPlanId("work", `verify-lifecycle-behavior-${sourceId}`, index);
        const playwrightSpecs = buildPlaywrightSpecs({
          codeSurface: input.codeSurface,
          workItemId: id,
          title: `Verify lifecycle behavior for ${sourceId}`,
          promptText: input.rawPrompt,
          scenarioIds,
          sourceIds: [sourceId],
          desiredOutcome: `Lifecycle state and status handling remain reviewable in ${sourceId}.`,
          acceptanceCriteria: input.acceptanceCriteria.map((criterion) => criterion.description),
          captureScope,
          uiStateRequirements,
          availableSources: input.availableSources
        });
        warnings.push(...playwrightSpecs.warnings);

        return {
          id,
          type: "playwright-spec",
          verificationMode: derivePlaywrightVerificationMode(playwrightSpecs.specs),
          title: `Verify lifecycle behavior for ${sourceId}`,
          description: `Generate tracked lifecycle verification for ${sourceId}.`,
          scenarioIds,
          sourceIds: [sourceId],
          userVisibleOutcome: `Lifecycle state and status handling remain reviewable in ${sourceId}.`,
          verification: `A generated Playwright spec with mocked Studio app state validates lifecycle state handling through the Studio UI for ${sourceId}.`,
          execution: {
            order: index + 1,
            dependsOnWorkItemIds: []
          },
          playwright: {
            generatedBy: "rules",
            specs: playwrightSpecs.specs
          }
        };
      });

    return {
      workItems,
      decomposition: buildIntentDecomposition({
        statement: input.rawPrompt,
        desiredOutcome: input.desiredOutcome,
        sourceIds: input.sourceIds,
        workItems,
        scenarios: input.scenarios
      }),
      warnings: dedupeValues(warnings)
    };
  }

  if (orchestratorVerificationMode === "targeted-code-validation") {
    const workItems: TDDWorkItem[] = input.sourceIds.map((sourceId, index) => {
        const scenarioIds = input.scenarios
          .filter((scenario) => scenario.applicableSourceIds.includes(sourceId))
          .map((scenario) => scenario.id);

        return {
          id: createPlanId("work", `validate-behavior-change-${sourceId}`, index),
          type: "code-validation",
          verificationMode: "targeted-code-validation",
          title: `Validate behavior change for ${sourceId}`,
          description: `Apply and validate the requested behavior change for ${sourceId} through targeted code verification.`,
          scenarioIds,
          sourceIds: [sourceId],
          userVisibleOutcome: `The requested behavior change is validated in ${sourceId}.`,
          verification: `Typecheck and targeted source-scoped code tests validate the requested behavior change for ${sourceId}; no tracked Playwright spec is planned for this verification mode.`,
          execution: {
            order: index + 1,
            dependsOnWorkItemIds: []
          },
          playwright: {
            generatedBy: "rules",
            specs: []
          }
        };
      });

    return {
      workItems,
      decomposition: buildIntentDecomposition({
        statement: input.rawPrompt,
        desiredOutcome: input.desiredOutcome,
        sourceIds: input.sourceIds,
        workItems,
        scenarios: input.scenarios
      }),
      warnings: []
    };
  }

  const executableScenarios = input.scenarios.filter(isExecutableVisualScenario);

  const scenarioItems: TDDWorkItem[] = [];

  for (const scenario of executableScenarios) {
    for (const sourceId of scenario.applicableSourceIds) {
      const id = createPlanId("work", `${scenario.title}-${sourceId}`, scenarioItems.length);
      const userVisibleOutcome = scenario.then[0] ?? input.desiredOutcome;
      const verification = buildWorkItemVerification(scenario);
      const relevantAcceptanceCriteria = selectRelevantAcceptanceCriteria(scenario, input.acceptanceCriteria);
      warnings.push(...relevantAcceptanceCriteria.warnings);
      const sourcePlan = input.sourcePlans.find((candidate) => candidate.sourceId === sourceId);
      const captureScope = sourcePlan?.captureScope ?? {
        mode: "all",
        captureIds: []
      };
      const uiStateRequirements = sourcePlan?.uiStateRequirements ?? [];
      const playwrightSpecs = buildPlaywrightSpecs({
        codeSurface: input.codeSurface,
        scenario,
        workItemId: id,
        title: scenario.title,
        promptText: input.rawPrompt,
        scenarioIds: [scenario.id],
        sourceIds: [sourceId],
        desiredOutcome: userVisibleOutcome,
        acceptanceCriteria: relevantAcceptanceCriteria.descriptions,
        captureScope,
        uiStateRequirements,
        availableSources: input.availableSources
      });
      warnings.push(...playwrightSpecs.warnings);

      scenarioItems.push({
        id,
        type: "playwright-spec",
        verificationMode: derivePlaywrightVerificationMode(playwrightSpecs.specs),
        title: scenario.title,
        description: scenario.goal,
        scenarioIds: [scenario.id],
        sourceIds: [sourceId],
        userVisibleOutcome,
        verification,
        execution: {
          order: scenarioItems.length + 1,
          dependsOnWorkItemIds: []
        },
        playwright: {
          generatedBy: "rules",
          specs: playwrightSpecs.specs
        }
      });
    }
  }

  const fallbackSourceItems: TDDWorkItem[] = input.sourceIds.flatMap((sourceId, index) => {
    const hasExecutableScenario = scenarioItems.some((workItem) => workItem.sourceIds.includes(sourceId));
    if (hasExecutableScenario) {
      return [];
    }

    const id = createPlanId("work", `verify-behavior-visually-${sourceId}`, scenarioItems.length + index);
    const scenarioIds = input.scenarios
      .filter((scenario) => scenario.applicableSourceIds.includes(sourceId))
      .map((scenario) => scenario.id);
    if (scenarioIds.length > 0) {
      warnings.push(
        `Source "${sourceId}" did not have a confidently executable visual scenario, so the planner emitted a bounded visual verification flow.`
      );
    }
    const sourcePlan = input.sourcePlans.find((candidate) => candidate.sourceId === sourceId);
    const captureScope = sourcePlan?.captureScope ?? {
      mode: "all",
      captureIds: []
    };
    const uiStateRequirements = sourcePlan?.uiStateRequirements ?? [];
    const playwrightSpecs = buildPlaywrightSpecs({
      codeSurface: input.codeSurface,
      workItemId: id,
      title: `Verify behavior visually for ${sourceId}`,
      promptText: input.rawPrompt,
      scenarioIds,
      sourceIds: [sourceId],
      desiredOutcome: `QA can verify behavior through reviewable screenshots for ${sourceId}.`,
      acceptanceCriteria: [],
      captureScope,
      uiStateRequirements,
      availableSources: input.availableSources
    });
    warnings.push(...playwrightSpecs.warnings);

    return [
      {
        id,
        type: "playwright-spec",
        verificationMode: derivePlaywrightVerificationMode(playwrightSpecs.specs),
        title: `Verify behavior visually for ${sourceId}`,
        description: `Generate a QA-runnable Playwright visual verification flow for ${sourceId}.`,
        scenarioIds,
        sourceIds: [sourceId],
        userVisibleOutcome: `QA can verify behavior through reviewable screenshots for ${sourceId}.`,
        verification: `A generated Playwright spec verifies behavior for ${sourceId} through reviewable screenshots and can run in the QA stage.`,
        execution: {
          order: scenarioItems.length + index + 1,
          dependsOnWorkItemIds: []
        },
        playwright: {
          generatedBy: "rules",
          specs: playwrightSpecs.specs
        }
      }
    ];
  });

  const workItems = [...scenarioItems, ...fallbackSourceItems];

  return {
    workItems,
    decomposition: buildIntentDecomposition({
      statement: input.rawPrompt,
      desiredOutcome: input.desiredOutcome,
      sourceIds: input.sourceIds,
      workItems,
      scenarios: input.scenarios
    }),
    warnings: dedupeValues(warnings)
  };
}

function assertMinimumE2ECoverage(input: {
  sourceIds: string[];
  workItems: TDDWorkItem[];
}): void {
  const uncoveredSourceIds = input.sourceIds.filter((sourceId) => {
    const sourceWorkItems = input.workItems.filter((workItem) => workItem.sourceIds.includes(sourceId));
    const requiresPlaywrightCoverage = sourceWorkItems.some(
      (workItem) => workItem.verificationMode !== "targeted-code-validation"
    );

    if (!requiresPlaywrightCoverage) {
      return false;
    }

    return !input.workItems.some((workItem) => {
      if (!workItem.sourceIds.includes(sourceId)) {
        return false;
      }

      return workItem.playwright.specs.some((spec) => spec.sourceId === sourceId);
    });
  });

  if (uncoveredSourceIds.length > 0) {
    throw new Error(
      `Each selected source requires at least one E2E Playwright spec. Missing coverage for: ${uncoveredSourceIds.join(", ")}.`
    );
  }
}

function buildDestinationPlans(input: {
  prompt: string;
  linearEnabled: boolean;
  publishToSourceWorkspace: boolean;
}): NormalizedIntent["executionPlan"]["destinations"] {
  const prompt = input.prompt.toLowerCase();

  const destinations: NormalizedIntent["executionPlan"]["destinations"] = [
    {
      id: "controller-artifacts",
      type: "controller",
      label: "Controller artifacts",
      status: "active",
      reason: "Local evidence bundles are always written by the controller.",
      details: ["Stores plan, manifests, logs, captures, and summaries on disk."]
    }
  ];

  if (input.linearEnabled) {
    destinations.push({
      id: "linear-parent-issue",
      type: "linear",
      label: "Linear parent issue",
      status: "active",
      reason: "Linear is enabled and can receive the structured BDD/TDD output for this intent.",
      details: [
        "Carries the business intent, acceptance criteria, scenarios, work items, and execution updates.",
        "Publishing can happen during execution."
      ]
    });
  }

  destinations.push({
    id: "source-workspace",
    type: "source-workspace",
    label: "Source workspace publication",
    status: input.publishToSourceWorkspace ? "active" : "inactive",
    reason: input.publishToSourceWorkspace
      ? "Artifacts are configured to publish back into the source workspace."
      : "Workspace publishing is disabled until artifacts.storageMode is set to 'both'.",
    details: ["Useful when evidence should live beside the source repository."]
  });

  if (/\b(github|pull request|\bpr\b|repository|repo)\b/i.test(prompt)) {
    destinations.push({
      id: "github",
      type: "github",
      label: "GitHub workflow",
      status: "planned",
      reason: "The prompt references GitHub-facing workflow, but there is no GitHub destination publisher yet.",
      details: ["Future publisher: PR comments, check runs, or issue updates."]
    });
  }

  if (/\b(docs|documentation|doc space|confluence|wiki)\b/i.test(prompt)) {
    destinations.push({
      id: "documentation",
      type: "documentation",
      label: "Documentation space",
      status: "planned",
      reason: "The prompt references documentation outputs, but there is no docs publisher yet.",
      details: ["Future publisher: markdown docs, wiki pages, or knowledge-base updates."]
    });
  }

  if (/\b(process|policy|gate|approval|business process|workflow)\b/i.test(prompt)) {
    destinations.push({
      id: "business-process",
      type: "business-process",
      label: "Business process controls",
      status: "planned",
      reason: "The prompt references process-level rollout, which should become an explicit destination in the system.",
      details: ["Future publisher: approval gates, process checklists, or automation hooks."]
    });
  }

  return destinations;
}

function buildToolPlans(input: {
  linearEnabled: boolean;
  sourceIds: string[];
  planningDepth: PlanningDepth;
  agent?: AgentConfig;
}): NormalizedIntent["executionPlan"]["tools"] {
  const implementationEnabled = resolveAgentStageConfig(input.agent, "implementation").enabled;
  const qaVerificationEnabled = resolveAgentStageConfig(input.agent, "qaVerification").enabled;

  const tools: NormalizedIntent["executionPlan"]["tools"] = [];

  if (input.linearEnabled) {
    tools.push({
      id: "linear-scoping",
      type: "linear-scoping",
      label: "Linear-first scoping",
      enabled: true,
      reason:
        input.planningDepth === "scoping"
          ? "This pass is intentionally limited to creating resumable Linear business and source lanes first."
          : "The runner creates resumable Linear business and source lanes before the detailed planner pass expands BDD and TDD output.",
      details: [
        input.planningDepth === "scoping"
          ? "BDD and Playwright-first TDD planning are deferred until the detailed planner pass."
          : "Detailed planner output is written back onto the same parent and source-lane issues after scoping completes."
      ]
    });
  }

  tools.push(
    {
      id: "bdd-planning",
      type: "intent-planning",
      label: "BDD planning",
      enabled: input.planningDepth === "full",
      reason:
        input.planningDepth === "full"
          ? "The system converts the raw prompt into reviewable acceptance criteria and scenarios during the full reviewed plan pass."
          : SCOPING_BDD_DEFERRED_WARNING,
      details: [
        input.planningDepth === "full"
          ? "Deterministic by default, with optional Gemini refinement when configured."
          : "The full reviewed plan pass will add acceptance criteria and scenarios after the scoping draft is reviewed."
      ]
    },
    {
      id: "playwright-tdd",
      type: "playwright-tdd",
      label: "Playwright TDD generation",
      enabled: input.planningDepth === "full" && input.sourceIds.length > 0,
      reason:
        input.planningDepth !== "full"
          ? SCOPING_TDD_DEFERRED_WARNING
          : input.sourceIds.length > 0
            ? "Applicable sources now produce Playwright-first executable test plans and checkpoint screenshots."
            : "No sources were selected for Playwright-first test generation.",
      details: [
        input.planningDepth === "full"
          ? "Generated specs are intended for checked-in repo storage with overwrite semantics."
          : "The full reviewed plan pass will attach Playwright-first work items after the scoping draft is reviewed."
      ]
    },
    {
      id: "screenshot-evidence",
      type: "screenshot",
      label: "Visual verification",
      enabled: input.sourceIds.length > 0,
      reason: input.sourceIds.length > 0
        ? "Applicable sources currently expose visual checkpoints and capture definitions."
        : "No visual capture sources were selected.",
      details: ["Playwright screenshots remain one execution tool rather than the top-level product model."]
    },
    {
      id: "environment-deployment",
      type: "environment-deployment",
      label: "Environment deployment",
      enabled: false,
      reason: "A generic local or Kubernetes deployment stage is planned but not yet wired into the runner.",
      details: ["This will become the shared path for local, minikube, and k3s-backed execution."]
    },
    {
      id: "implementation",
      type: "implementation",
      label: "Implementation loop",
      enabled: implementationEnabled,
      reason: implementationEnabled
        ? "The runner can execute bounded implementation attempts against the prepared source workspace."
        : "Implementation retries are available, but the current config keeps this stage disabled.",
      details: [
        qaVerificationEnabled
          ? "QA failures can feed directly back into the next bounded implementation attempt."
          : "When QA is also enabled, failed verification can loop back into another implementation attempt."
      ]
    },
    {
      id: "qa-verification",
      type: "qa-verification",
      label: "QA verification",
      enabled: qaVerificationEnabled,
      reason: qaVerificationEnabled
        ? "The runner can now execute a bounded QA bundle before evidence capture completes the lane."
        : "QA verification is available, but the current config keeps this stage disabled.",
      details: [
        "The default QA bundle runs typecheck, the deterministic code test suite, and generated Playwright specs when a source enables them."
      ]
    },
    {
      id: "reporting",
      type: "reporting",
      label: "Evidence reporting",
      enabled: true,
      reason: "Every run produces summaries and machine-readable manifests.",
      details: ["Reports become distribution inputs for downstream review and publishing surfaces."]
    }
  );

  if (input.linearEnabled) {
    tools.push({
      id: "linear-publishing",
      type: "linear-publishing",
      label: "Linear publishing",
      enabled: true,
      reason: "Linear is enabled and can receive the plan plus execution updates.",
      details: ["Intended to carry the parent issue for BDD, AC, and TDD structure."]
    });
  }

  return tools;
}

function describeSelectionReason(
  reason: SourceSelection["selectionReason"],
  sourceId: string,
  promptMatchValue?: string
): string {
  switch (reason) {
    case "llm":
      return `Source ${sourceId} was selected by Gemini prompt normalization.`;
    case "requested-scope":
      return `Source ${sourceId} was selected in the requested source scope.`;
    case "prompt-match":
      if (promptMatchValue && promptMatchValue !== sourceId) {
        return `Source ${sourceId} matched the prompt alias '${promptMatchValue}'.`;
      }

      return `Source ${sourceId} was referenced directly in the prompt.`;
    case "business-wide":
      return `Source ${sourceId} is included because the prompt describes a business-wide or cross-system intent.`;
    case "default":
    default:
      return `Source ${sourceId} falls back to the configured default because the prompt did not name a specific source.`;
  }
}

function describeRepoSelectionReason(
  reason: SourceSelection["selectionReason"],
  repoId: string,
  sourceIds: string[],
  promptMatchValues: Record<string, string>
): string {
  if (sourceIds.length === 1) {
    return describeSelectionReason(reason, sourceIds[0], promptMatchValues[sourceIds[0]]);
  }

  switch (reason) {
    case "llm":
      return `Repo ${repoId} is in scope because Gemini selected sources ${sourceIds.join(", ")}.`;
    case "requested-scope":
      return `Repo ${repoId} is in scope because the requested source scope includes ${sourceIds.join(", ")}.`;
    case "prompt-match":
      return `Repo ${repoId} is in scope because the prompt referenced sources ${sourceIds.join(", ")}.`;
    case "business-wide":
      return `Repo ${repoId} is included because the prompt requests a business-wide or cross-system path.`;
    case "default":
    default:
      return `Repo ${repoId} remains in scope because the current plan falls back to the configured default sources ${sourceIds.join(", ")}.`;
  }
}

function buildRepoCandidates(input: {
  availableSources: Record<string, AvailableSourceDescriptor>;
  sourceSelection: SourceSelection;
}): NormalizedIntent["planning"]["repoCandidates"] {
  const repoEntries = new Map<
    string,
    {
      repoId: string;
      label: string;
      role?: string;
      summary?: string;
      sourceIds: string[];
      selectedSourceIds: string[];
      sourceTypes: Set<"local" | "git">;
      locations: Set<string>;
      refs: Set<string>;
      notes: Set<string>;
      captureCount: number;
    }
  >();

  for (const [sourceId, source] of Object.entries(input.availableSources)) {
    const repoId = source.planning.repoId ?? sourceId;
    const label = source.planning.repoLabel ?? repoId;
    const entry = repoEntries.get(repoId) ?? {
      repoId,
      label,
      role: source.planning.role,
      summary: source.planning.summary,
      sourceIds: [],
      selectedSourceIds: [],
      sourceTypes: new Set<"local" | "git">(),
      locations: new Set<string>(),
      refs: new Set<string>(),
      notes: new Set<string>(),
      captureCount: 0
    };

    entry.sourceIds.push(sourceId);
    entry.captureCount += source.capture.items.length;
    entry.sourceTypes.add(source.source.type);

    if (source.source.type === "local") {
      entry.locations.add(source.source.localPath);
    } else {
      entry.locations.add(source.source.gitUrl);
      entry.refs.add(source.source.ref);
      if (source.source.authTokenEnv) {
        entry.notes.add(`Uses ${source.source.authTokenEnv} when authenticated git access is required.`);
      }
    }

    for (const note of source.planning.notes) {
      entry.notes.add(note);
    }

    if (input.sourceSelection.sourceIds.includes(sourceId)) {
      entry.selectedSourceIds.push(sourceId);
    }

    repoEntries.set(repoId, entry);
  }

  return Array.from(repoEntries.values())
    .map((entry) => {
      const selectionStatus: NormalizedIntent["planning"]["repoCandidates"][number]["selectionStatus"] =
        entry.selectedSourceIds.length > 0 ? "selected" : "candidate";
      const notes = Array.from(entry.notes);
      notes.push(`Configured visual captures across linked sources: ${entry.captureCount}.`);

      return {
        repoId: entry.repoId,
        label: entry.label,
        role: entry.role,
        sourceIds: entry.sourceIds,
        selectionStatus,
        reason:
          selectionStatus === "selected"
            ? describeRepoSelectionReason(
                input.sourceSelection.selectionReason,
                entry.repoId,
                entry.selectedSourceIds,
                input.sourceSelection.promptMatchValues ?? {}
              )
            : `Repo ${entry.repoId} remains available in the configured shortlist for future plan expansion.`,
        summary: entry.summary,
        sourceTypes: Array.from(entry.sourceTypes),
        locations: Array.from(entry.locations),
        refs: Array.from(entry.refs),
        notes,
        captureCount: entry.captureCount
      };
    })
    .sort((left, right) => {
      if (left.selectionStatus !== right.selectionStatus) {
        return left.selectionStatus === "selected" ? -1 : 1;
      }

      return left.label.localeCompare(right.label);
    });
}

function buildPlannerSections(sourceIds: string[]): NormalizedIntent["planning"]["plannerSections"] {
  return [
    {
      id: "idd-plan",
      title: "IDD Plan",
      scope: "business",
      summary: "Planner-owned business plan with acceptance criteria, repo context, execution lanes, and delivery notes."
    },
    ...sourceIds.map((sourceId) => ({
      id: `idd-source-lane-${sanitizeFileSegment(sourceId)}`,
      title: `IDD Source Lane: ${sourceId}`,
      scope: "source" as const,
      sourceId,
      summary: `Planner-owned lane for ${sourceId}, intended for downstream implementation and verification handoff.`
    }))
  ];
}

function buildPlanningReviewNotes(input: {
  repoCandidates: NormalizedIntent["planning"]["repoCandidates"];
  sourceIds: string[];
  resumeIssue?: string;
}): string[] {
  const notes: string[] = [];
  const candidateRepoCount = input.repoCandidates.filter((repo) => repo.selectionStatus === "candidate").length;

  if (input.resumeIssue) {
    notes.push(`This plan is configured to resume Linear issue ${input.resumeIssue}.`);
  }

  if (candidateRepoCount > 0) {
    notes.push(`${candidateRepoCount} additional configured repo candidates remain available if the plan expands.`);
  }

  if (input.sourceIds.length > 1) {
    notes.push("The current executor still applies one shared verification workflow across all selected repos.");
  }

  return notes;
}

function ensurePrompt(trimmedPrompt: string): void {
  if (trimmedPrompt.length === 0) {
    throw new Error("A free-text intent is required. Pass --intent or set run.intent in the config.");
  }
}

function buildRulesResolution(trimmedPrompt: string, options: NormalizeIntentOptions): NormalizationResolution {
  const sourceSelection = pickApplicableSourceIds(trimmedPrompt, options);

  return {
    sourceIds: sourceSelection.sourceIds,
    selectionReason: sourceSelection.selectionReason,
    promptMatchValues: sourceSelection.promptMatchValues ?? {},
    desiredOutcome: extractDesiredOutcome(trimmedPrompt),
    captureIdsBySource: {},
    normalizationSource: "rules",
    normalizationWarnings: []
  };
}

function sanitizeText(value: string | undefined): string | undefined {
  const trimmedValue = value?.trim();
  return trimmedValue ? trimmedValue : undefined;
}

function sanitizeHintIds(candidateIds: string[] | undefined, validIds: Set<string>): SanitizedIdSelection {
  const uniqueIds = dedupeValues(candidateIds ?? []);

  return {
    validIds: uniqueIds.filter((candidateId) => validIds.has(candidateId)),
    invalidIds: uniqueIds.filter((candidateId) => !validIds.has(candidateId))
  };
}

function sanitizeHintWarnings(warnings: string[] | undefined): string[] {
  return dedupeValues(
    (warnings ?? [])
      .map((warning) => warning.trim())
      .filter((warning) => warning.length > 0)
  );
}

function sanitizeScopingDetails(scopingDetails: PlanningScopingDetails | undefined): PlanningScopingDetails | undefined {
  if (!scopingDetails) {
    return undefined;
  }

  const sectionNames: Array<keyof PlanningScopingDetails> = [
    "repoContext",
    "sourceScope",
    "adaptiveBoundaries",
    "minimumSuccess",
    "baseline",
    "verificationObligations"
  ];
  const sanitizedSections: Partial<PlanningScopingDetails> = {};

  for (const sectionName of sectionNames) {
    const sanitizedEntries = dedupeValues(
      (scopingDetails[sectionName] ?? [])
        .map((entry) => sanitizeText(entry))
        .filter((entry): entry is string => Boolean(entry))
    );

    if (sanitizedEntries.length > 0) {
      sanitizedSections[sectionName] = sanitizedEntries;
    }
  }

  return Object.keys(sanitizedSections).length > 0 ? sanitizedSections : undefined;
}

function buildStageMeta(
  stage: ResolvedAgentStageConfig,
  status: AgentStageMeta["status"],
  source: AgentStageMeta["source"],
  warnings: string[] = []
): AgentStageMeta {
  return {
    stageId: stage.id,
    label: stage.label,
    description: stage.description,
    provider: stage.provider,
    model: stage.model,
    status,
    source,
    warnings: dedupeValues(warnings)
  };
}

function buildSkippedStageMeta(stage: ResolvedAgentStageConfig): AgentStageMeta {
  return buildStageMeta(stage, "skipped", "skipped");
}

function buildRulesStageMeta(stage: ResolvedAgentStageConfig, warnings: string[] = []): AgentStageMeta {
  return buildStageMeta(stage, "completed", "rules", warnings);
}

function buildDeferredStageMeta(stage: ResolvedAgentStageConfig, warning: string): AgentStageMeta {
  return buildStageMeta(stage, "skipped", "skipped", [warning]);
}

function deriveNormalizationSource(
  resolutionSource: NormalizationSource,
  stageMetas: AgentStageMeta[]
): NormalizationSource {
  if (stageMetas.some((stageMeta) => stageMeta.source === "llm")) {
    return "llm";
  }

  if (stageMetas.some((stageMeta) => stageMeta.source === "fallback")) {
    return "fallback";
  }

  return resolutionSource;
}

function sanitizeListEntries(values: string[] | undefined): string[] {
  return dedupeValues((values ?? []).map((value) => value.trim()).filter((value) => value.length > 0));
}

function sanitizeCodeSurfaceIds(codeSurfaceIds: string[] | undefined): CodeSurfaceId[] {
  return Array.from(
    new Set((codeSurfaceIds ?? []).filter((codeSurfaceId): codeSurfaceId is CodeSurfaceId => isCodeSurfaceId(codeSurfaceId)))
  );
}

function classifyAcceptanceCriterionOrigin(
  prompt: string,
  description: string,
  draftAcceptanceCriteria: AcceptanceCriterion[]
): AcceptanceCriterion["origin"] {
  const normalizedDescription = description.trim().toLowerCase();

  if (
    draftAcceptanceCriteria.some(
      (criterion) => criterion.origin === "prompt" && criterion.description.trim().toLowerCase() === normalizedDescription
    )
  ) {
    return "prompt";
  }

  return prompt.toLowerCase().includes(normalizedDescription) ? "prompt" : "inferred";
}

function sanitizePlanningAcceptanceCriteria(input: {
  prompt: string;
  draftAcceptanceCriteria: AcceptanceCriterion[];
  acceptanceCriteria: GeminiIntentPlanningRefinement["acceptanceCriteria"];
}): { acceptanceCriteria?: AcceptanceCriterion[]; warnings: string[] } {
  if (!input.acceptanceCriteria) {
    return { warnings: [] };
  }

  const descriptions = dedupeValues(
    input.acceptanceCriteria
      .map((criterion) => criterion.description.trim())
      .filter((description) => description.length > 0)
  );

  if (descriptions.length === 0) {
    return {
      warnings: ["Gemini intent planning did not return any valid acceptance criteria, so the draft criteria were preserved."]
    };
  }

  return {
    acceptanceCriteria: descriptions.map((description, index) => ({
      id: createPlanId("ac", description, index),
      description,
      origin: classifyAcceptanceCriterionOrigin(input.prompt, description, input.draftAcceptanceCriteria)
    })),
    warnings: []
  };
}

function sanitizePlanningScenarios(input: {
  selectedSourceIds: string[];
  scenarios: GeminiIntentPlanningRefinement["scenarios"];
}): { scenarios?: BDDScenario[]; warnings: string[] } {
  if (!input.scenarios) {
    return { warnings: [] };
  }

  const validSourceIds = new Set(input.selectedSourceIds);
  const seenTitles = new Set<string>();
  const warnings: string[] = [];
  const scenarios: BDDScenario[] = [];

  for (const scenario of input.scenarios) {
    const title = scenario.title.trim();
    const goal = scenario.goal.trim();
    const given = sanitizeListEntries(scenario.given);
    const when = sanitizeListEntries(scenario.when);
    const then = sanitizeListEntries(scenario.then);

    if (!title || !goal || given.length === 0 || when.length === 0 || then.length === 0) {
      continue;
    }

    const normalizedTitle = title.toLowerCase();
    if (seenTitles.has(normalizedTitle)) {
      continue;
    }
    seenTitles.add(normalizedTitle);

    const sanitizedSourceIds = sanitizeHintIds(scenario.applicableSourceIds, validSourceIds);
    if (scenario.applicableSourceIds && sanitizedSourceIds.invalidIds.length > 0) {
      warnings.push(
        `Gemini intent planning returned unknown applicable source ids for scenario '${title}' and they were ignored: ${sanitizedSourceIds.invalidIds.join(", ")}.`
      );
    }

    scenarios.push({
      id: createPlanId("scenario", title, scenarios.length),
      title,
      goal,
      given,
      when,
      then,
      applicableSourceIds: sanitizedSourceIds.validIds.length > 0 ? sanitizedSourceIds.validIds : input.selectedSourceIds
    });
  }

  if (input.scenarios.length > 0 && scenarios.length === 0) {
    warnings.push("Gemini intent planning did not return any valid scenarios, so the draft scenarios were preserved.");
  }

  return {
    scenarios: scenarios.length > 0 ? scenarios : undefined,
    warnings: dedupeValues(warnings)
  };
}

function buildPlanningRefinement(
  trimmedPrompt: string,
  selectedSourceIds: string[],
  draft: IntentDraft,
  refinement: GeminiIntentPlanningRefinement
): IntentPlanningRefinement {
  const acceptanceCriteria = sanitizePlanningAcceptanceCriteria({
    prompt: trimmedPrompt,
    draftAcceptanceCriteria: draft.acceptanceCriteria,
    acceptanceCriteria: refinement.acceptanceCriteria
  });
  const scenarios = sanitizePlanningScenarios({
    selectedSourceIds,
    scenarios: refinement.scenarios
  });

  return {
    statement: sanitizeText(refinement.statement),
    desiredOutcome: sanitizeText(refinement.desiredOutcome),
    acceptanceCriteria: acceptanceCriteria.acceptanceCriteria,
    scenarios: scenarios.scenarios,
    warnings: dedupeValues([
      ...sanitizeHintWarnings(refinement.warnings),
      ...acceptanceCriteria.warnings,
      ...scenarios.warnings
    ])
  };
}

function buildAgentResolution(
  options: NormalizeIntentOptions,
  rulesResolution: NormalizationResolution,
  hints: PromptNormalizationHints
): NormalizationResolution {
  const requestedSourceIds = getRequestedSourceIds(options);
  const validSourceIds = new Set(Object.keys(options.availableSources));
  const sanitizedSourceIds = sanitizeHintIds(hints.sourceIds, validSourceIds);
  const sourceIds = requestedSourceIds
    ? requestedSourceIds
    : sanitizedSourceIds.validIds.length > 0
      ? sanitizedSourceIds.validIds
      : rulesResolution.sourceIds;
  const selectionReason: SourceSelectionReason = requestedSourceIds
    ? "requested-scope"
    : sanitizedSourceIds.validIds.length > 0
      ? "llm"
      : rulesResolution.selectionReason;
  const captureIdsBySource = Object.fromEntries(
    sourceIds.map((sourceId) => {
      const validCaptureIds = new Set(options.availableSources[sourceId]?.capture.items.map((item) => item.id) ?? []);
      const sanitizedCaptureIds = sanitizeHintIds(hints.captureIdsBySource?.[sourceId], validCaptureIds);

      return [sourceId, sanitizedCaptureIds.validIds.length > 0 ? sanitizedCaptureIds.validIds : undefined];
    })
  ) as Record<string, string[] | undefined>;
  const invalidCaptureWarnings = sourceIds.flatMap((sourceId) => {
    const validCaptureIds = new Set(options.availableSources[sourceId]?.capture.items.map((item) => item.id) ?? []);
    const sanitizedCaptureIds = sanitizeHintIds(hints.captureIdsBySource?.[sourceId], validCaptureIds);

    return sanitizedCaptureIds.invalidIds.length > 0
      ? [`Gemini returned unknown capture ids for ${sourceId} and they were ignored: ${sanitizedCaptureIds.invalidIds.join(", ")}.`]
      : [];
  });
  const normalizationWarnings = [
    ...sanitizeHintWarnings(hints.warnings),
    ...(sanitizedSourceIds.invalidIds.length > 0
      ? [`Gemini returned unknown source ids and they were ignored: ${sanitizedSourceIds.invalidIds.join(", ")}.`]
      : []),
    ...(hints.sourceIds && sanitizedSourceIds.validIds.length === 0
      ? ["Gemini did not return any valid source ids, so rules-based source selection was preserved."]
      : []),
    ...invalidCaptureWarnings
  ];

  return {
    sourceIds,
    selectionReason,
    promptMatchValues: selectionReason === rulesResolution.selectionReason ? rulesResolution.promptMatchValues : {},
    desiredOutcome: sanitizeText(hints.desiredOutcome) ?? rulesResolution.desiredOutcome,
    codeSurfaceId: hints.codeSurfaceId,
    codeSurfaceAlternatives: sanitizeCodeSurfaceIds(hints.codeSurfaceAlternatives),
    captureIdsBySource,
    scopingDetails: sanitizeScopingDetails(hints.scopingDetails),
    normalizationSource: "llm",
    normalizationWarnings
  };
}

function pickCaptureScopeForSource(
  prompt: string,
  sourceId: string,
  options: NormalizeIntentOptions,
  resolution: NormalizationResolution
): CaptureScopeSelection {
  const explicitCaptureScope = pickCaptureIds(prompt, options.availableSources[sourceId].capture.items);
  if (explicitCaptureScope.mode === "subset") {
    return {
      captureScope: explicitCaptureScope,
      warnings: []
    };
  }

  const promptMatchValue = resolution.promptMatchValues[sourceId];
  if (sourceId === "intent-poc-app" && (promptMatchValue === "surface library" || promptMatchValue === "surface-library" || promptMatchValue === "library")) {
    const defaultSurfaceLibraryCaptureIds = ["library-index", "component-button-primary", "page-analytics-overview"];
    const availableCaptureIds = new Set(options.availableSources[sourceId].capture.items.map((item) => item.id));
    const compatibleCaptureIds = defaultSurfaceLibraryCaptureIds.filter((captureId) => availableCaptureIds.has(captureId));

    if (compatibleCaptureIds.length > 0) {
      return {
        captureScope: {
          mode: "subset",
          captureIds: compatibleCaptureIds
        },
        warnings: []
      };
    }
  }

  const hintedCaptureIds = resolution.captureIdsBySource[sourceId];
  const totalCaptureCount = options.availableSources[sourceId].capture.items.length;
  if (hintedCaptureIds && hintedCaptureIds.length > 0 && hintedCaptureIds.length < totalCaptureCount) {
    return {
      captureScope: explicitCaptureScope,
      warnings: [describeIgnoredCaptureHint(sourceId, hintedCaptureIds)]
    };
  }

  return {
    captureScope: explicitCaptureScope,
    warnings: []
  };
}

function buildSourcePlans(input: {
  trimmedPrompt: string;
  desiredOutcome: string;
  acceptanceCriteriaDescriptions: string[];
  options: NormalizeIntentOptions;
  resolution: NormalizationResolution;
}): NormalizedIntent["executionPlan"]["sources"] {
  return input.resolution.sourceIds.map((sourceId) => {
    const captureSelection = pickCaptureScopeForSource(input.trimmedPrompt, sourceId, input.options, input.resolution);
    const uiStateRequirements = resolveUiStateRequirements({
      source: input.options.availableSources[sourceId],
      promptText: input.trimmedPrompt,
      desiredOutcome: input.desiredOutcome,
      acceptanceCriteria: input.acceptanceCriteriaDescriptions
    });

    return {
      sourceId,
      selectionReason: describeSelectionReason(
        input.resolution.selectionReason,
        sourceId,
        input.resolution.promptMatchValues[sourceId]
      ),
      captureScope: captureSelection.captureScope,
      warnings: [
        ...captureSelection.warnings,
        ...(uiStateRequirements.length > 0
          ? [
              `Requested UI states: ${uiStateRequirements
                .map((requirement) =>
                  requirement.requestedValue ? `${requirement.stateId}=${requirement.requestedValue}` : requirement.stateId
                )
                .join(", ")}.`
            ]
          : [])
      ],
      uiStateRequirements: uiStateRequirements.length > 0 ? uiStateRequirements : undefined
    };
  });
}

function buildScopingContextPack(input: {
  trimmedPrompt: string;
  options: NormalizeIntentOptions;
  resolution: NormalizationResolution;
  codeSurface: CodeSurfaceSelection;
  sourcePlans: NormalizedIntent["executionPlan"]["sources"];
}): ScopingContextPack {
  const normalizedPrompt = input.trimmedPrompt.toLowerCase();
  const promptTokens = tokenizePrompt(input.trimmedPrompt);
  const sourceMatches = input.sourcePlans.map((sourcePlan) => {
    const source = input.options.availableSources[sourcePlan.sourceId];
    const matchedTerms = dedupeValues([
      ...collectPromptPhraseMatches(normalizedPrompt, promptTokens, [sourcePlan.sourceId, ...source.aliases]),
      ...(input.resolution.promptMatchValues[sourcePlan.sourceId]
        ? [input.resolution.promptMatchValues[sourcePlan.sourceId]!]
        : [])
    ]);

    return {
      sourceId: sourcePlan.sourceId,
      matchedTerms,
      reason: sourcePlan.selectionReason
    };
  });

  const primaryImplementationHints = getCodeSurfaceImplementationHints(input.codeSurface.id);
  const primarySurfaceMatchedTerms = collectPromptPhraseMatches(normalizedPrompt, promptTokens, [
    input.codeSurface.label,
    input.codeSurface.id,
    ...primaryImplementationHints.keywords
  ]);
  const primarySurface = {
    sourceId: input.codeSurface.sourceId,
    id: input.codeSurface.id,
    label: input.codeSurface.label,
    confidence: input.codeSurface.confidence,
    rationale: input.codeSurface.rationale,
    matchedTerms: primarySurfaceMatchedTerms,
    primaryPaths: primaryImplementationHints.primaryPathPrefixes.slice(0, 2),
    adjacentPaths: primaryImplementationHints.adjacentPathPrefixes.slice(0, 2)
  };

  const alternativeSurfaces = input.codeSurface.alternatives.map((alternative) => {
    const implementationHints = getCodeSurfaceImplementationHints(alternative.id);
    return {
      sourceId: input.codeSurface.sourceId,
      id: alternative.id,
      label: alternative.label,
      confidence: "low" as const,
      rationale: alternative.reason,
      matchedTerms: collectPromptPhraseMatches(normalizedPrompt, promptTokens, [
        alternative.label,
        alternative.id,
        ...implementationHints.keywords
      ]),
      primaryPaths: implementationHints.primaryPathPrefixes.slice(0, 2),
      adjacentPaths: implementationHints.adjacentPathPrefixes.slice(0, 2)
    };
  });

  const pathHints = dedupeValues([
    ...primarySurface.primaryPaths,
    ...(input.codeSurface.confidence === "high" ? [] : primarySurface.adjacentPaths)
  ]).map((path) => ({
    sourceId: input.codeSurface.sourceId,
    path,
    reason: primarySurface.primaryPaths.includes(path)
      ? `Primary implementation path for ${input.codeSurface.label}.`
      : `Adjacent path to confirm ownership for ${input.codeSurface.label}.`
  }));

  const uiStateHints = input.sourcePlans.flatMap((sourcePlan) =>
    (sourcePlan.uiStateRequirements ?? []).map((requirement) => ({
      sourceId: sourcePlan.sourceId,
      stateId: requirement.stateId,
      label: requirement.label,
      reason: requirement.reason,
      verificationStrategies: requirement.verificationStrategies,
      notes: requirement.notes
    }))
  );

  const captureHints = input.sourcePlans.flatMap((sourcePlan) =>
    sourcePlan.captureScope.mode === "subset" && sourcePlan.captureScope.captureIds.length > 0
      ? [
          {
            sourceId: sourcePlan.sourceId,
            captureIds: sourcePlan.captureScope.captureIds,
            reason: `Prompt already narrows verification to ${sourcePlan.captureScope.captureIds.join(", ")}.`
          }
        ]
      : []
  );

  const verificationHints = input.sourcePlans.flatMap((sourcePlan) => {
    const source = input.options.availableSources[sourcePlan.sourceId];
    const relevantUiStates = uiStateHints.filter((hint) => hint.sourceId === sourcePlan.sourceId);

    return source.planning.verificationNotes.flatMap((note) => {
      const matchedTerms = dedupeValues([
        ...collectPromptTokenMatches(promptTokens, note),
        ...relevantUiStates.flatMap((hint) => collectPromptPhraseMatches(normalizedPrompt, promptTokens, [hint.stateId, hint.label ?? ""])),
        ...primarySurfaceMatchedTerms
      ]);

      if (matchedTerms.length === 0 && relevantUiStates.length === 0 && captureHints.every((hint) => hint.sourceId !== sourcePlan.sourceId)) {
        return [];
      }

      return [
        {
          sourceId: sourcePlan.sourceId,
          note,
          reason:
            relevantUiStates.length > 0
              ? `Supports verification for requested UI state context in ${sourcePlan.sourceId}.`
              : `Matched prompt terms: ${matchedTerms.join(", ")}.`
        }
      ];
    });
  });

  const repoNoteHints = input.sourcePlans.flatMap((sourcePlan) => {
    const source = input.options.availableSources[sourcePlan.sourceId];
    return source.planning.notes.flatMap((note) => {
      const matchedTerms = dedupeValues([
        ...collectPromptTokenMatches(promptTokens, note),
        ...primarySurfaceMatchedTerms
      ]);

      if (matchedTerms.length === 0) {
        return [];
      }

      return [
        {
          sourceId: sourcePlan.sourceId,
          note,
          reason: `Matched prompt terms: ${matchedTerms.join(", ")}.`
        }
      ];
    });
  });

  const repoMemoryHints = buildRepoMemoryHints({
    normalizedPrompt,
    promptTokens,
    sourcePlans: input.sourcePlans,
    codeSurface: input.codeSurface
  });

  const unresolvedQuestions = dedupeValues([
    ...(input.codeSurface.confidence !== "high" ? [input.codeSurface.rationale] : []),
    ...(primarySurface.primaryPaths.length === 0 && input.codeSurface.confidence === "low"
      ? ["No concrete owning file was identified from the prompt yet."]
      : [])
  ]);

  return {
    matchedPromptTerms: dedupeValues([
      ...sourceMatches.flatMap((match) => match.matchedTerms),
      ...primarySurfaceMatchedTerms,
      ...alternativeSurfaces.flatMap((surface) => surface.matchedTerms),
      ...uiStateHints.flatMap((hint) => collectPromptPhraseMatches(normalizedPrompt, promptTokens, [hint.stateId, hint.label ?? ""]))
    ]),
    sourceMatches,
    primarySurface,
    alternativeSurfaces,
    pathHints,
    uiStateHints,
    verificationHints,
    repoNoteHints,
    repoMemoryHints,
    captureHints,
    unresolvedQuestions
  };
}

function buildIntentDraft(
  trimmedPrompt: string,
  options: NormalizeIntentOptions,
  resolution: NormalizationResolution,
  codeSurface: CodeSurfaceSelection,
  planningRefinement?: IntentPlanningRefinement,
  tddWorkItemPlan?: WorkItemBuildResult
): IntentDraft {
  const planningDepth = options.planningDepth ?? "full";
  const primarySourceId = resolution.sourceIds[0] ?? options.defaultSourceId;
  const statement = planningRefinement?.statement ?? trimmedPrompt;
  const desiredOutcome = planningRefinement?.desiredOutcome ?? resolution.desiredOutcome;
  const acceptanceCriteria =
    planningDepth === "scoping"
      ? []
      : planningRefinement?.acceptanceCriteria ??
        buildAcceptanceCriteria(trimmedPrompt, desiredOutcome, resolution.sourceIds, codeSurface);
  const scenarios =
    planningDepth === "scoping"
      ? []
      : planningRefinement?.scenarios ??
        buildScenarios({
          statement,
          desiredOutcome,
          sourceIds: resolution.sourceIds,
          acceptanceCriteria,
          codeSurface
        });
  const sourcePlans = buildSourcePlans({
    trimmedPrompt,
    desiredOutcome,
    acceptanceCriteriaDescriptions: acceptanceCriteria.map((criterion) => criterion.description),
    options,
    resolution
  });
  const primaryCaptureScope =
    sourcePlans[0]?.captureScope ?? pickCaptureIds(trimmedPrompt, options.availableSources[primarySourceId].capture.items);
  const workItemPlan =
    planningDepth === "scoping"
      ? { workItems: [], decomposition: buildEmptyIntentDecomposition(), warnings: [] }
      : tddWorkItemPlan
        ? tddWorkItemPlan
        : buildWorkItems({
            codeSurface,
            rawPrompt: trimmedPrompt,
            scenarios,
            acceptanceCriteria,
            sourcePlans,
            sourceIds: resolution.sourceIds,
            desiredOutcome,
            availableSources: options.availableSources
          });
  const workItems = workItemPlan.workItems;

  if (planningDepth === "full") {
    assertMinimumE2ECoverage({
      sourceIds: resolution.sourceIds,
      workItems
    });
  }

  const destinations = buildDestinationPlans({
    prompt: trimmedPrompt,
    linearEnabled: options.linearEnabled ?? false,
    publishToSourceWorkspace: options.publishToSourceWorkspace ?? false
  });
  const tools = buildToolPlans({
    linearEnabled: options.linearEnabled ?? false,
    sourceIds: resolution.sourceIds,
    planningDepth,
    agent: options.agent
  });
  const repoCandidates = buildRepoCandidates({
    availableSources: options.availableSources,
    sourceSelection: {
      sourceIds: resolution.sourceIds,
      selectionReason: resolution.selectionReason,
      promptMatchValues: resolution.promptMatchValues
    }
  });
  const planningReviewNotes = buildPlanningReviewNotes({
    repoCandidates,
    sourceIds: resolution.sourceIds,
    resumeIssue: options.resumeIssue
  });
  const reviewNotes: string[] = [...workItemPlan.warnings];

  for (const sourcePlan of sourcePlans) {
    for (const requirement of sourcePlan.uiStateRequirements ?? []) {
      for (const note of requirement.notes) {
        reviewNotes.push(`Source ${sourcePlan.sourceId}: ${note}`);
      }
    }
  }

  if (resolution.sourceIds.length > 1) {
    reviewNotes.push("This intent will execute as one business run with a separate evidence lane for each applicable source.");
  }

  if (planningDepth === "scoping") {
    reviewNotes.push("BDD and Playwright-first TDD planning are deferred until the full reviewed plan pass.");
  }

  return {
    statement,
    primarySourceId,
    sourcePlans,
    primaryCaptureScope,
    desiredOutcome,
    acceptanceCriteria,
    scenarios,
    workItems,
    decomposition: workItemPlan.decomposition,
    destinations,
    tools,
    repoCandidates,
    planningReviewNotes,
    reviewNotes,
    summary: summarizeIntent(resolution.sourceIds)
  };
}

function buildNormalizedIntent(
  trimmedPrompt: string,
  options: NormalizeIntentOptions,
  resolution: NormalizationResolution,
  input: BuildNormalizedIntentInput = {}
): NormalizedIntent {
  const stageMetas =
    input.stageMetas ??
    AGENT_STAGE_SEQUENCE.map((stageId) => buildSkippedStageMeta(resolveAgentStageConfig(options.agent, stageId)));
  const primarySourceId = resolution.sourceIds[0] ?? options.defaultSourceId;
  const codeSurface = inferCodeSurface({
    prompt: trimmedPrompt,
    primarySourceId,
    sourceIds: resolution.sourceIds,
    hintedCodeSurfaceId: resolution.codeSurfaceId,
    hintedAlternativeIds: resolution.codeSurfaceAlternatives
  });
  const draft = buildIntentDraft(
    trimmedPrompt,
    options,
    resolution,
    codeSurface,
    input.planningRefinement,
    input.tddWorkItemPlan
  );
  const scopingContext = buildScopingContextPack({
    trimmedPrompt,
    options,
    resolution,
    codeSurface,
    sourcePlans: draft.sourcePlans
  });
  const intentId = `${new Date().toISOString().replace(/[.:]/g, "-")}-${sanitizeFileSegment(draft.summary)}`;
  const requestedPlanningDepth = options.planningDepth ?? "full";
  const normalizationWarnings = dedupeValues([
    ...draft.reviewNotes,
    ...draft.planningReviewNotes,
    ...resolution.normalizationWarnings,
    ...(input.planningRefinement?.warnings ?? [])
  ]);

  return {
    intentId,
    receivedAt: new Date().toISOString(),
    rawPrompt: trimmedPrompt,
    summary: draft.summary,
    intentType: "change-behavior",
    codeSurface,
    businessIntent: {
      statement: draft.statement,
      desiredOutcome: draft.desiredOutcome,
      acceptanceCriteria: draft.acceptanceCriteria,
      scenarios: draft.scenarios,
      workItems: draft.workItems,
      decomposition: draft.decomposition
    },
    planning: {
      repoCandidates: draft.repoCandidates,
      scopingContext,
      scopingDetails: resolution.scopingDetails,
      plannerSections: buildPlannerSections(resolution.sourceIds),
      reviewNotes: draft.planningReviewNotes,
      linearPlan: options.resumeIssue
        ? {
            mode: "resume-explicit",
            issueReference: options.resumeIssue
          }
        : {
            mode: "new"
          }
    },
    executionPlan: {
      primarySourceId: draft.primarySourceId,
      sources: draft.sourcePlans,
      destinations: draft.destinations,
      tools: draft.tools,
      orchestrationStrategy: draft.sourcePlans.length > 1 ? "multi-source" : "single-source",
      reviewNotes: draft.reviewNotes
    },
    sourceId: draft.primarySourceId,
    captureScope: draft.primaryCaptureScope,
    artifacts: {
      requireScreenshots: true,
      requireManifest: true,
      requireHashes: true
    },
    linear: {
      createIssue: true,
      issueTitle: `IDD: ${trimmedPrompt.slice(0, 96)}`
    },
    execution: {
      continueOnCaptureError: options.continueOnCaptureError
    },
    normalizationMeta: {
      source: deriveNormalizationSource(resolution.normalizationSource, stageMetas),
      warnings: normalizationWarnings,
      requestedPlanningDepth,
      effectivePlanningDepth: requestedPlanningDepth,
      ambiguity: buildNormalizationAmbiguityMeta(codeSurface, normalizationWarnings),
      stages: stageMetas
    }
  };
}

function buildFallbackResolution(rulesResolution: NormalizationResolution, message: string): NormalizationResolution {
  return {
    ...rulesResolution,
    normalizationSource: "fallback",
    normalizationWarnings: dedupeValues([...rulesResolution.normalizationWarnings, message])
  };
}

function buildTddWorkItemPlanFromGemini(input: {
  refinement: GeminiTddPlanningRefinement;
  rawPrompt: string;
  desiredOutcome: string;
  codeSurface: CodeSurfaceSelection;
  scenarios: BDDScenario[];
  sourcePlans: NormalizedIntent["executionPlan"]["sources"];
  sourceIds: string[];
}): WorkItemBuildResult {
  const validScenarioIds = new Set(input.scenarios.map((scenario) => scenario.id));
  const sourcePlanMap = new Map(input.sourcePlans.map((sourcePlan) => [sourcePlan.sourceId, sourcePlan]));
  const disallowMockedState = requiresLiveIntentStudioIndicatorVerification({
    codeSurface: input.codeSurface,
    rawPrompt: input.rawPrompt,
    desiredOutcome: input.desiredOutcome
  });

  const workItems: TDDWorkItem[] = input.refinement.workItems.map((workItem, index) => {
    const sourceIds = dedupeValues(workItem.sourceIds).filter((sourceId) => input.sourceIds.includes(sourceId));

    if (sourceIds.length === 0) {
      throw new Error(`Gemini TDD planning returned a work item outside the selected source scope: ${workItem.title}`);
    }

    const scenarioIds = dedupeValues((workItem.scenarioIds ?? []).filter((scenarioId) => validScenarioIds.has(scenarioId)));
    const type: TDDWorkItem["type"] =
      workItem.verificationMode === "targeted-code-validation" ? "code-validation" : "playwright-spec";
    const id = createPlanId("work", `${workItem.title}-${sourceIds.join("-")}`, index);

    const specs = workItem.specs.map((spec) => {
      if (!sourceIds.includes(spec.sourceId)) {
        throw new Error(`Gemini TDD planning returned spec '${spec.relativeSpecPath}' for unsupported source '${spec.sourceId}'.`);
      }

      const uiStateRequirements = sourcePlanMap.get(spec.sourceId)?.uiStateRequirements ?? [];
      const specScenarioIds = dedupeValues((spec.scenarioIds ?? scenarioIds).filter((scenarioId) => validScenarioIds.has(scenarioId)));

      if (disallowMockedState && spec.checkpoints.some((checkpoint) => checkpoint.action === "mock-studio-state")) {
        throw new Error(
          "Gemini TDD planning must use live tracked Playwright verification for Intent Studio run-indicator workflows; mocked Studio state is not allowed."
        );
      }

      return {
        framework: "playwright" as const,
        sourceId: spec.sourceId,
        relativeSpecPath: spec.relativeSpecPath,
        suiteName: spec.suiteName,
        testName: spec.testName,
        scenarioIds: specScenarioIds,
        checkpoints: spec.checkpoints.map((checkpoint, checkpointIndex) => ({
          id: createPlanId("checkpoint", `${spec.testName}-${checkpoint.label}`, checkpointIndex),
          label: checkpoint.label,
          action: checkpoint.action,
          assertion: checkpoint.assertion,
          screenshotId: checkpoint.screenshotId,
          ...(checkpoint.path ? { path: checkpoint.path } : {}),
          ...(checkpoint.target ? { target: checkpoint.target } : {}),
          ...(checkpoint.value ? { value: checkpoint.value } : {}),
          ...(checkpoint.captureId ? { captureId: checkpoint.captureId } : {}),
          ...(checkpoint.locator ? { locator: checkpoint.locator } : {}),
          ...(checkpoint.referenceTarget ? { referenceTarget: checkpoint.referenceTarget } : {}),
          ...(checkpoint.attributeName ? { attributeName: checkpoint.attributeName } : {}),
          ...(checkpoint.expectedSubstring ? { expectedSubstring: checkpoint.expectedSubstring } : {}),
          ...(checkpoint.waitForSelector ? { waitForSelector: checkpoint.waitForSelector } : {}),
          ...(checkpoint.waitUntil ? { waitUntil: checkpoint.waitUntil } : {}),
          ...(checkpoint.mockStudioState ? { mockStudioState: checkpoint.mockStudioState } : {}),
          ...(uiStateRequirements.length > 0 ? { requiredUiStates: uiStateRequirements } : {})
        })),
        ...(uiStateRequirements.length > 0 ? { requiredUiStates: uiStateRequirements } : {})
      };
    });

    const verificationMode = type === "code-validation"
      ? "targeted-code-validation"
      : derivePlaywrightVerificationMode(specs);

    if (disallowMockedState && verificationMode === "mocked-state-playwright") {
      throw new Error(
        "Gemini TDD planning must use live tracked Playwright verification for Intent Studio run-indicator workflows; mocked Studio state is not allowed."
      );
    }

    return {
      id,
      type,
      verificationMode,
      title: workItem.title,
      description: workItem.description,
      scenarioIds,
      sourceIds,
      userVisibleOutcome: workItem.userVisibleOutcome,
      verification: workItem.verification,
      execution: {
        order: index + 1,
        dependsOnWorkItemIds: []
      },
      playwright: {
        generatedBy: "llm" as const,
        specs
      }
    };
  });

  return {
    workItems,
    decomposition: buildIntentDecomposition({
      statement: input.rawPrompt,
      desiredOutcome: input.desiredOutcome,
      sourceIds: input.sourceIds,
      workItems,
      scenarios: input.scenarios
    }),
    warnings: dedupeValues(input.refinement.warnings ?? [])
  };
}

function requiresAIWorkflow(agent?: AgentConfig): boolean {
  return agent?.requireAIWorkflow ?? false;
}

function assertAIWorkflowStage(stage: ResolvedAgentStageConfig, modeLabel: string): void {
  if (!stage.enabled) {
    throw new Error(`AI-first workflow requires ${stage.label} to stay enabled for ${modeLabel}.`);
  }

  if (!stage.provider) {
    throw new Error(
      `AI-first workflow requires ${stage.label} to use a provider-backed stage for ${modeLabel}. Configure agent.provider or agent.stages.${stage.id}.provider.`
    );
  }

  if (stage.provider !== "gemini") {
    throw new Error(
      `AI-first workflow requires ${stage.label} to use a supported provider for ${modeLabel}. Supported providers: gemini.`
    );
  }

  if (stage.fallbackToRules) {
    throw new Error(`AI-first workflow requires rules fallback to stay disabled for ${stage.label}.`);
  }
}

export function normalizeIntent(options: NormalizeIntentOptions): NormalizedIntent {
  const trimmedPrompt = options.rawPrompt.trim();
  ensurePrompt(trimmedPrompt);
  const planningDepth = options.planningDepth ?? "full";

  if (requiresAIWorkflow(options.agent)) {
    throw new Error("AI-first workflow requires provider-backed planning via normalizeIntentWithAgent; rules-only normalizeIntent is disabled.");
  }

  const rulesResolution = buildRulesResolution(trimmedPrompt, options);
  const promptStage = resolveAgentStageConfig(options.agent, "promptNormalization");
  const linearStage = resolveAgentStageConfig(options.agent, "linearScoping");
  const bddStage = resolveAgentStageConfig(options.agent, "bddPlanning");
  const tddStage = resolveAgentStageConfig(options.agent, "tddPlanning");
  const implementationStage = resolveAgentStageConfig(options.agent, "implementation");
  const qaStage = resolveAgentStageConfig(options.agent, "qaVerification");

  return buildNormalizedIntent(trimmedPrompt, options, rulesResolution, {
    stageMetas: [
      promptStage.enabled ? buildRulesStageMeta(promptStage) : buildSkippedStageMeta(promptStage),
      options.linearEnabled
        ? linearStage.enabled
          ? buildRulesStageMeta(linearStage)
          : buildSkippedStageMeta(linearStage)
        : buildStageMeta(linearStage, "skipped", "skipped", [POC_LINEAR_DISABLED_WARNING]),
      planningDepth === "full"
        ? bddStage.enabled
          ? buildRulesStageMeta(bddStage)
          : buildSkippedStageMeta(bddStage)
        : buildStageMeta(
            bddStage,
            "skipped",
            "skipped",
            [SCOPING_BDD_DEFERRED_WARNING]
          ),
      planningDepth === "full"
        ? tddStage.enabled
          ? buildRulesStageMeta(tddStage)
          : buildSkippedStageMeta(tddStage)
        : buildStageMeta(
            tddStage,
            "skipped",
            "skipped",
            [SCOPING_TDD_DEFERRED_WARNING]
          ),
      implementationStage.enabled
        ? buildDeferredStageMeta(
            implementationStage,
            "Implementation stage configuration is recorded and executes during source runs before QA verification."
          )
        : buildSkippedStageMeta(implementationStage),
      qaStage.enabled
        ? buildDeferredStageMeta(
            qaStage,
            "QA verification configuration is recorded and executes during source runs after implementation completes."
          )
        : buildSkippedStageMeta(qaStage)
    ]
  });
}

export async function normalizeIntentWithAgent(
  options: NormalizeIntentOptions,
  dependencies: Partial<NormalizeIntentDependencies> = {}
): Promise<NormalizedIntent> {
  const activeDependencies: NormalizeIntentDependencies = {
    ...defaultNormalizeIntentDependencies,
    ...dependencies
  };
  const trimmedPrompt = options.rawPrompt.trim();
  ensurePrompt(trimmedPrompt);
  const planningDepth = options.planningDepth ?? "full";

  const rulesResolution = buildRulesResolution(trimmedPrompt, options);
  const requestedSourceIds = getRequestedSourceIds(options);
  const promptStageSources = requestedSourceIds
    ? Object.fromEntries(requestedSourceIds.map((sourceId) => [sourceId, options.availableSources[sourceId]]))
    : options.availableSources;
  const rulesCodeSurface = inferCodeSurface({
    prompt: trimmedPrompt,
    primarySourceId: rulesResolution.sourceIds[0] ?? options.defaultSourceId,
    sourceIds: rulesResolution.sourceIds,
    hintedCodeSurfaceId: rulesResolution.codeSurfaceId,
    hintedAlternativeIds: rulesResolution.codeSurfaceAlternatives
  });
  const promptStageScopingContext = buildScopingContextPack({
    trimmedPrompt,
    options,
    resolution: rulesResolution,
    codeSurface: rulesCodeSurface,
    sourcePlans: buildSourcePlans({
      trimmedPrompt,
      desiredOutcome: rulesResolution.desiredOutcome,
      acceptanceCriteriaDescriptions: [],
      options,
      resolution: rulesResolution
    })
  });

  let resolution = rulesResolution;
  const stageMetas: AgentStageMeta[] = [];

  const promptStage = resolveAgentStageConfig(options.agent, "promptNormalization");
  if (requiresAIWorkflow(options.agent)) {
    assertAIWorkflowStage(promptStage, planningDepth === "scoping" ? "the scoping draft" : "the reviewed plan");
  }

  if (!promptStage.enabled || !promptStage.provider) {
    stageMetas.push(buildSkippedStageMeta(promptStage));
  } else if (promptStage.provider !== "gemini") {
    const message = `Agent provider '${promptStage.provider}' is not supported for ${promptStage.label}. Supported providers: gemini.`;
    if (promptStage.fallbackToRules) {
      resolution = buildFallbackResolution(rulesResolution, message);
      stageMetas.push(buildStageMeta(promptStage, "fallback", "fallback", [message]));
    } else {
      throw new Error(message);
    }
  } else {
    try {
      const hints = await activeDependencies.normalizePromptWithGemini({
        rawPrompt: trimmedPrompt,
        defaultSourceId: options.defaultSourceId,
        availableSources: promptStageSources,
        requestedSourceIds,
        scopingContext: promptStageScopingContext,
        stage: promptStage
      });

      resolution = buildAgentResolution(options, rulesResolution, hints);
      stageMetas.push(buildStageMeta(promptStage, "completed", "llm", resolution.normalizationWarnings));
    } catch (error) {
      const message = `Gemini prompt normalization failed: ${error instanceof Error ? error.message : String(error)}`;
      if (promptStage.fallbackToRules) {
        resolution = buildFallbackResolution(rulesResolution, message);
        stageMetas.push(buildStageMeta(promptStage, "fallback", "fallback", [message]));
      } else {
        throw new Error(message);
      }
    }
  }

  const linearStage = resolveAgentStageConfig(options.agent, "linearScoping");
  stageMetas.push(
    options.linearEnabled
      ? !linearStage.enabled
        ? buildSkippedStageMeta(linearStage)
        : !linearStage.provider
          ? buildRulesStageMeta(linearStage)
          : (() => {
              const message = `${linearStage.label} does not yet support provider-backed execution, so deterministic Linear lane scoping was used.`;
              if (linearStage.fallbackToRules) {
                return buildRulesStageMeta(linearStage, [message]);
              }

              throw new Error(message);
            })()
      : buildStageMeta(linearStage, "skipped", "skipped", [POC_LINEAR_DISABLED_WARNING])
  );

  if (planningDepth === "scoping") {
    const bddStage = resolveAgentStageConfig(options.agent, "bddPlanning");
    stageMetas.push(
      buildStageMeta(bddStage, "skipped", "skipped", [SCOPING_BDD_DEFERRED_WARNING])
    );

    const tddStage = resolveAgentStageConfig(options.agent, "tddPlanning");
    stageMetas.push(
      buildStageMeta(tddStage, "skipped", "skipped", [SCOPING_TDD_DEFERRED_WARNING])
    );

    const implementationStage = resolveAgentStageConfig(options.agent, "implementation");
    stageMetas.push(
      implementationStage.enabled
        ? buildDeferredStageMeta(
            implementationStage,
            "Implementation stage configuration is recorded and executes during source runs before QA verification."
          )
        : buildSkippedStageMeta(implementationStage)
    );

    const qaStage = resolveAgentStageConfig(options.agent, "qaVerification");
    stageMetas.push(
      qaStage.enabled
        ? buildDeferredStageMeta(
            qaStage,
            "QA verification configuration is recorded and executes during source runs after implementation completes."
          )
        : buildSkippedStageMeta(qaStage)
    );

    return buildNormalizedIntent(trimmedPrompt, options, resolution, {
      stageMetas
    });
  }

  const draftCodeSurface = inferCodeSurface({
    prompt: trimmedPrompt,
    primarySourceId: resolution.sourceIds[0] ?? options.defaultSourceId,
    sourceIds: resolution.sourceIds,
    hintedCodeSurfaceId: resolution.codeSurfaceId,
    hintedAlternativeIds: resolution.codeSurfaceAlternatives
  });
  const draft = buildIntentDraft(trimmedPrompt, options, resolution, draftCodeSurface);
  const planningStage = resolveAgentStageConfig(options.agent, "bddPlanning");
  if (requiresAIWorkflow(options.agent)) {
    assertAIWorkflowStage(planningStage, "the reviewed plan");
  }

  let planningRefinement: IntentPlanningRefinement | undefined;
  let tddWorkItemPlan: WorkItemBuildResult | undefined;
  const planningStageSources = Object.fromEntries(
    resolution.sourceIds.map((sourceId) => [sourceId, options.availableSources[sourceId]])
  );

  if (!planningStage.enabled) {
    stageMetas.push(buildSkippedStageMeta(planningStage));
  } else if (!planningStage.provider) {
    stageMetas.push(buildRulesStageMeta(planningStage));
  } else if (planningStage.provider !== "gemini") {
    const message = `Agent provider '${planningStage.provider}' is not supported for ${planningStage.label}. Supported providers: gemini.`;
    if (planningStage.fallbackToRules) {
      stageMetas.push(buildRulesStageMeta(planningStage, [message]));
    } else {
      throw new Error(message);
    }
  } else {
    try {
      const refinement = await activeDependencies.refineIntentPlanWithGemini({
        rawPrompt: trimmedPrompt,
        sourceIds: resolution.sourceIds,
        requestedSourceIds,
        availableSources: planningStageSources,
        draftPlan: {
          statement: draft.statement,
          desiredOutcome: draft.desiredOutcome,
          acceptanceCriteria: draft.acceptanceCriteria.map((criterion) => ({
            description: criterion.description,
            origin: criterion.origin
          })),
          scenarios: draft.scenarios.map((scenario) => ({
            title: scenario.title,
            goal: scenario.goal,
            given: scenario.given,
            when: scenario.when,
            then: scenario.then,
            applicableSourceIds: scenario.applicableSourceIds
          }))
        },
        stage: planningStage
      });

      planningRefinement = buildPlanningRefinement(trimmedPrompt, resolution.sourceIds, draft, refinement);
      stageMetas.push(buildStageMeta(planningStage, "completed", "llm", planningRefinement.warnings));
    } catch (error) {
      const message = `Gemini intent planning failed: ${error instanceof Error ? error.message : String(error)}`;
      if (planningStage.fallbackToRules) {
        stageMetas.push(buildStageMeta(planningStage, "fallback", "fallback", [message]));
      } else {
        throw new Error(message);
      }
    }
  }

  const tddStage = resolveAgentStageConfig(options.agent, "tddPlanning");
  if (requiresAIWorkflow(options.agent)) {
    assertAIWorkflowStage(tddStage, "the reviewed plan");
  }

  if (!tddStage.enabled) {
    stageMetas.push(buildSkippedStageMeta(tddStage));
  } else if (!tddStage.provider) {
    stageMetas.push(buildRulesStageMeta(tddStage));
  } else if (!requiresAIWorkflow(options.agent)) {
    const message = `${tddStage.label} uses deterministic Playwright spec generation unless AI-first workflow is required.`;
    stageMetas.push(buildRulesStageMeta(tddStage, [message]));
  } else if (tddStage.provider !== "gemini") {
    const message = `Agent provider '${tddStage.provider}' is not supported for ${tddStage.label}. Supported providers: gemini.`;
    if (tddStage.fallbackToRules) {
      stageMetas.push(buildRulesStageMeta(tddStage, [message]));
    } else {
      throw new Error(message);
    }
  } else {
    const tddDraft = buildIntentDraft(
      trimmedPrompt,
      options,
      resolution,
      draftCodeSurface,
      planningRefinement
    );

    try {
      const refinement = await activeDependencies.refineIntentTddWithGemini({
        rawPrompt: trimmedPrompt,
        sourceIds: resolution.sourceIds,
        availableSources: planningStageSources,
        codeSurface: draftCodeSurface,
        desiredOutcome: tddDraft.desiredOutcome,
        acceptanceCriteria: tddDraft.acceptanceCriteria.map((criterion) => ({
          description: criterion.description,
          origin: criterion.origin
        })),
        scenarios: tddDraft.scenarios.map((scenario) => ({
          id: scenario.id,
          title: scenario.title,
          goal: scenario.goal,
          given: scenario.given,
          when: scenario.when,
          then: scenario.then,
          applicableSourceIds: scenario.applicableSourceIds
        })),
        sourcePlans: tddDraft.sourcePlans.map((sourcePlan) => ({
          sourceId: sourcePlan.sourceId,
          captureScope: sourcePlan.captureScope,
          uiStateRequirements: (sourcePlan.uiStateRequirements ?? []).map((requirement) => ({
            stateId: requirement.stateId,
            requestedValue: requirement.requestedValue,
            label: requirement.label,
            reason: requirement.reason
          }))
        })),
        draftWorkItems: tddDraft.workItems.map((workItem) => ({
          title: workItem.title,
          description: workItem.description,
          verificationMode: workItem.verificationMode,
          sourceIds: workItem.sourceIds,
          scenarioIds: workItem.scenarioIds,
          userVisibleOutcome: workItem.userVisibleOutcome,
          verification: workItem.verification,
          specs: workItem.playwright.specs
        })),
        stage: tddStage
      });

      tddWorkItemPlan = buildTddWorkItemPlanFromGemini({
        refinement,
        rawPrompt: trimmedPrompt,
        desiredOutcome: tddDraft.desiredOutcome,
        codeSurface: draftCodeSurface,
        scenarios: tddDraft.scenarios,
        sourcePlans: tddDraft.sourcePlans,
        sourceIds: resolution.sourceIds
      });
      stageMetas.push(buildStageMeta(tddStage, "completed", "llm", tddWorkItemPlan.warnings));
    } catch (error) {
      const message = `Gemini TDD planning failed: ${error instanceof Error ? error.message : String(error)}`;
      if (tddStage.fallbackToRules) {
        stageMetas.push(buildRulesStageMeta(tddStage, [message]));
      } else {
        throw new Error(message);
      }
    }
  }

  const implementationStage = resolveAgentStageConfig(options.agent, "implementation");
  stageMetas.push(
    implementationStage.enabled
      ? buildDeferredStageMeta(
          implementationStage,
          "Implementation stage configuration is recorded and executes during source runs before QA verification."
        )
      : buildSkippedStageMeta(implementationStage)
  );

  const qaStage = resolveAgentStageConfig(options.agent, "qaVerification");
  stageMetas.push(
    qaStage.enabled
      ? buildDeferredStageMeta(
          qaStage,
          "QA verification configuration is recorded and executes during source runs after implementation completes."
        )
      : buildSkippedStageMeta(qaStage)
  );

  return buildNormalizedIntent(trimmedPrompt, options, resolution, {
    planningRefinement,
    tddWorkItemPlan,
    stageMetas
  });
}