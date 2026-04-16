import { AgentConfig, CaptureItemConfig, SourceConfig } from "../config/schema";
import { sanitizeFileSegment } from "../shared/fs";
import {
  AGENT_STAGE_SEQUENCE,
  ResolvedAgentStageConfig,
  resolveAgentStageConfig
} from "./agent-stage-config";
import { CodeSurfaceId, CodeSurfaceSelection, inferCodeSurface, isCodeSurfaceId } from "./code-surface";
import {
  normalizePromptWithGemini,
  PromptNormalizationHints,
  PromptNormalizerSourceDescriptor
} from "./gemini-prompt-normalizer";
import { refineIntentPlanWithGemini, GeminiIntentPlanningRefinement } from "./gemini-intent-planner";
import {
  AcceptanceCriterion,
  AgentStageMeta,
  BDDScenario,
  NormalizedIntent,
  NormalizationSource,
  PlaywrightCheckpoint,
  PlaywrightSpecArtifact,
  TDDWorkItem
} from "./intent-types";

export type AvailableSourceDescriptor = PromptNormalizerSourceDescriptor;

export type PlanningDepth = "scoping" | "full";

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
  intentType: NormalizedIntent["intentType"];
  sourceIds: string[];
  selectionReason: SourceSelectionReason;
  promptMatchValues: Record<string, string>;
  desiredOutcome: string;
  codeSurfaceId?: CodeSurfaceId;
  codeSurfaceAlternatives?: CodeSurfaceId[];
  captureIdsBySource: Record<string, string[] | undefined>;
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

interface BuildNormalizedIntentInput {
  planningRefinement?: IntentPlanningRefinement;
  stageMetas?: AgentStageMeta[];
}

export interface NormalizeIntentDependencies {
  normalizePromptWithGemini: typeof normalizePromptWithGemini;
  refineIntentPlanWithGemini: typeof refineIntentPlanWithGemini;
}

const defaultNormalizeIntentDependencies: NormalizeIntentDependencies = {
  normalizePromptWithGemini,
  refineIntentPlanWithGemini
};

interface SanitizedIdSelection {
  validIds: string[];
  invalidIds: string[];
}

const businessWideIntentPattern =
  /\b(all targets|all systems|all sources|multiple targets|multiple systems|across\b|business[- ]wide|organization[- ]wide|org[- ]wide|everywhere|cross[- ]target|cross[- ]system)\b/i;

function inferIntentType(prompt: string): NormalizedIntent["intentType"] {
  if (/refresh|rebuild|maintain|update.+library/i.test(prompt)) {
    return "refresh-library";
  }

  return "capture-evidence";
}

function dedupeValues(values: string[]): string[] {
  return Array.from(new Set(values));
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

function summarizeIntent(intentType: NormalizedIntent["intentType"], sourceIds: string[]): string {
  const scope = sourceIds.length === 1 ? sourceIds[0] : `${sourceIds.length} sources`;

  switch (intentType) {
    case "refresh-library":
      return `refresh evidence library for ${scope}`;
    default:
      return `capture evidence for ${scope}`;
  }
}

function createPlanId(prefix: string, input: string, index: number): string {
  const segment = sanitizeFileSegment(input) || `${prefix}-${index + 1}`;
  return `${prefix}-${index + 1}-${segment}`;
}

function extractDesiredOutcome(prompt: string): string {
  const desiredOutcomeMatch = prompt.match(/\bso that\b(.+)/i);
  if (desiredOutcomeMatch) {
    return desiredOutcomeMatch[1].trim().replace(/^[,.;:\s]+/, "").replace(/[.\s]+$/, "");
  }

  const mustMatch = prompt.match(/\b(?:must|should|needs to|need to)\b(.+)/i);
  if (mustMatch) {
    return mustMatch[1].trim().replace(/^[,.;:\s]+/, "").replace(/[.\s]+$/, "");
  }

  return "Produce consistent, reviewable outputs that make the intent visible to users and stakeholders.";
}

function extractPromptCriteria(prompt: string): string[] {
  const matches = Array.from(prompt.matchAll(/\b(?:must|should|needs to|need to|so that)\b([^.;]+)/gi))
    .map((match) => match[1].trim().replace(/^[,\s]+/, ""))
    .filter((entry) => entry.length > 0);

  return dedupeValues(matches);
}

function buildAcceptanceCriteria(
  prompt: string,
  desiredOutcome: string,
  sourceIds: string[],
  intentType: NormalizedIntent["intentType"]
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
    intentType === "refresh-library"
      ? "Tracked screenshot library artifacts are refreshed and ready for Git review."
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
    {
      title: "QA-runnable visual evidence is defined for applicable sources",
      goal: "Define Playwright screenshot verification that QA can execute for each source involved in the intent.",
      given: [
        input.sourceIds.length === 1
          ? `Source ${input.sourceIds[0]} is available for execution.`
          : `${input.sourceIds.length} sources are applicable to the intent.`
      ],
      when: [
        "TDD planning prepares Playwright screenshot verification for the applicable sources.",
        "The runner maps the configured capture surfaces into QA-runnable checkpoints."
      ],
      then: [
        input.sourceIds.length === 1
          ? `QA can run a Playwright screenshot flow for ${input.sourceIds[0]}.`
          : `QA can run Playwright screenshot flows for ${input.sourceIds.join(", ")}.`,
        "Each applicable source has executable visual evidence coverage that captures reviewable screenshots."
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

function buildPlaywrightSpecRelativePath(sourceId: string, workItemId: string): string {
  const sourceSegment = sanitizeFileSegment(sourceId) || "source";
  const workItemSegment = sanitizeFileSegment(workItemId) || "work-item";
  return `${sourceSegment}/${workItemSegment}.spec.ts`;
}

function buildPlaywrightCheckpoints(input: {
  codeSurface: CodeSurfaceSelection;
  scenario?: BDDScenario;
  captureItems: CaptureItemConfig[];
  workItemTitle: string;
  desiredOutcome: string;
  acceptanceCriteria: string[];
}): PlaywrightCheckpoint[] {
  if (input.codeSurface.id === "intent-studio") {
    return buildIntentStudioPlaywrightCheckpoints({
      scenario: input.scenario,
      workItemTitle: input.workItemTitle,
      desiredOutcome: input.desiredOutcome,
      acceptanceCriteria: input.acceptanceCriteria
    });
  }

  if (input.captureItems.length === 0) {
    const label = `Open the primary flow for ${input.workItemTitle}`;
    return [
      {
        id: createPlanId("checkpoint", label, 0),
        label,
        action: "goto",
        assertion: input.desiredOutcome,
        screenshotId: createPlanId("shot", input.workItemTitle, 0),
        path: "/"
      }
    ];
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
    waitUntil: item.waitForSelector ? "load" : "networkidle"
  }));
}

function buildIntentStudioPlaywrightCheckpoints(input: {
  scenario?: BDDScenario;
  workItemTitle: string;
  desiredOutcome: string;
  acceptanceCriteria: string[];
}): PlaywrightCheckpoint[] {
  const scenarioText = [
    input.workItemTitle,
    ...input.acceptanceCriteria,
    ...(input.scenario?.given ?? []),
    ...(input.scenario?.when ?? []),
    ...(input.scenario?.then ?? [])
  ]
    .join(" ")
    .toLowerCase();
  const isCollapseFlow = /\bcollapse|collapsed|collapsable|collapsible|hide\b/i.test(scenarioText);
  const isExpandFlow = /\bexpand|expanded|show|restore\b/i.test(scenarioText);
  const mentionsPromptInput = /\b(prompt|input|textarea|text area|input box|prompt box)\b/i.test(scenarioText);
  const mentionsRunButton = /\b(run intent|submit|button)\b/i.test(scenarioText);
  const mentionsBelowRelationship = /\b(under|below|beneath)\b/i.test(scenarioText);
  const isLayoutFlow = /\blayout|placement|position\b/i.test(scenarioText) || (mentionsPromptInput && mentionsRunButton);
  const shouldAssertPromptButtonPlacement = isLayoutFlow && mentionsPromptInput && mentionsRunButton && mentionsBelowRelationship;
  const includesWorkScopeSection = /\b(work scope|source scope)\b/i.test(scenarioText);
  const includesStepsSection = /\b(steps|stages|optional config|optional configuration|configuration section|orchestration stages)\b/i.test(
    scenarioText
  );
  const checkpoints: PlaywrightCheckpoint[] = [
    {
      id: createPlanId("checkpoint", `${input.workItemTitle}-open-intent-studio`, 0),
      label: "Intent Studio Prompt Run",
      action: "goto",
      assertion: "The Intent Studio prompt input is visible and ready for interaction.",
      screenshotId: createPlanId("shot", `${input.workItemTitle}-intent-studio`, 0),
      path: "/",
      waitForSelector: "#prompt-input",
      waitUntil: "domcontentloaded"
    }
  ];

  if (shouldAssertPromptButtonPlacement) {
    checkpoints.push({
      id: createPlanId("checkpoint", `${input.workItemTitle}-submit-button-visible`, checkpoints.length),
      label: "Run Intent Button Visible",
      action: "assert-visible",
      assertion: "The run intent button is visible on the prompt run form.",
      screenshotId: createPlanId("shot", `${input.workItemTitle}-submit-button-visible`, checkpoints.length),
      target: "#submit-button",
      waitForSelector: "#submit-button"
    });
    checkpoints.push({
      id: createPlanId("checkpoint", `${input.workItemTitle}-submit-button-below-input`, checkpoints.length),
      label: "Run Intent Button Below Prompt Input",
      action: "assert-below",
      assertion: input.desiredOutcome,
      screenshotId: createPlanId("shot", `${input.workItemTitle}-submit-button-below-input`, checkpoints.length),
      target: "#submit-button",
      referenceTarget: "#prompt-input",
      waitForSelector: "#submit-button"
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
      waitForSelector: section.collapsedTarget
    });

    if (isCollapseFlow || isExpandFlow) {
      checkpoints.push({
        id: createPlanId("checkpoint", `${input.workItemTitle}-${section.key}-collapse-toggle`, checkpoints.length),
        label: `Collapse ${section.label}`,
        action: "click",
        assertion: `The collapse toggle is available for the ${section.label.toLowerCase()}.`,
        screenshotId: createPlanId("shot", `${input.workItemTitle}-${section.key}-collapse-toggle`, checkpoints.length),
        target: section.toggleTarget,
        waitForSelector: section.toggleTarget
      });
      checkpoints.push({
        id: createPlanId("checkpoint", `${input.workItemTitle}-${section.key}-collapsed`, checkpoints.length),
        label: `${section.label} Collapsed`,
        action: "assert-hidden",
        assertion: section.collapsedAssertion,
        screenshotId: createPlanId("shot", `${input.workItemTitle}-${section.key}-collapsed`, checkpoints.length),
        target: section.collapsedTarget,
        waitForSelector: section.collapsedTarget
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
        waitForSelector: section.toggleTarget
      });
      checkpoints.push({
        id: createPlanId("checkpoint", `${input.workItemTitle}-${section.key}-expanded`, checkpoints.length),
        label: `${section.label} Expanded`,
        action: "assert-visible",
        assertion: section.expandedAssertion,
        screenshotId: createPlanId("shot", `${input.workItemTitle}-${section.key}-expanded`, checkpoints.length),
        target: section.expandedTarget,
        waitForSelector: section.expandedTarget
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
      waitForSelector: "#agent-stages-grid"
    });
  }

  return checkpoints;
}

function buildPlaywrightSpecs(input: {
  codeSurface: CodeSurfaceSelection;
  scenario?: BDDScenario;
  workItemId: string;
  title: string;
  scenarioIds: string[];
  sourceIds: string[];
  desiredOutcome: string;
  acceptanceCriteria: string[];
  captureScope: NormalizedIntent["captureScope"];
  availableSources: Record<string, AvailableSourceDescriptor>;
}): PlaywrightSpecArtifact[] {
  return input.sourceIds.map((sourceId) => {
    const source = input.availableSources[sourceId];
    const captureItems = selectRelevantCaptureItemsForScenario({
      scenario: input.scenario,
      captureItems: source?.capture.items ?? [],
      captureScope: input.captureScope
    });

    return {
      framework: "playwright",
      sourceId,
      relativeSpecPath: buildPlaywrightSpecRelativePath(sourceId, input.workItemId),
      suiteName: `Intent-driven flow for ${sourceId}`,
      testName: input.title,
      scenarioIds: input.scenarioIds,
      checkpoints: buildPlaywrightCheckpoints({
        codeSurface: input.codeSurface,
        scenario: input.scenario,
        captureItems,
        workItemTitle: input.title,
        desiredOutcome: input.desiredOutcome,
        acceptanceCriteria: input.acceptanceCriteria
      })
    };
  });
}

function buildScenarioNarrativeText(scenario: BDDScenario): string {
  return [scenario.title, scenario.goal, ...scenario.when, ...scenario.then].join(" ").toLowerCase();
}

function tokenizeCaptureMatchText(text: string): string[] {
  const stopWords = new Set([
    "again",
    "catalog",
    "component",
    "components",
    "demo",
    "evidence",
    "image",
    "images",
    "library",
    "page",
    "pages",
    "review",
    "screen",
    "screens",
    "shot",
    "shots",
    "source",
    "sources",
    "surface",
    "surfaces",
    "view",
    "views",
    "visual"
  ]);

  return (text.match(/[a-z0-9]+/g) ?? []).filter((token) => token.length > 2 && !stopWords.has(token));
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
}): CaptureItemConfig[] {
  const scopedCaptureItems = filterCaptureItemsByScope(input.captureItems, input.captureScope);

  if (!input.scenario || scopedCaptureItems.length <= 1) {
    return scopedCaptureItems;
  }

  const scenarioText = buildScenarioNarrativeText(input.scenario);
  const exactMatches = scopedCaptureItems.filter((item) => {
    const normalizedId = item.id.toLowerCase();
    const normalizedName = item.name?.toLowerCase();

    return scenarioText.includes(normalizedId) || (normalizedName ? scenarioText.includes(normalizedName) : false);
  });

  if (exactMatches.length > 0) {
    return exactMatches;
  }

  const scenarioTokens = new Set(tokenizeCaptureMatchText(scenarioText));
  const scoredCaptureItems = scopedCaptureItems
    .map((item) => {
      const itemTokens = tokenizeCaptureMatchText(buildCaptureItemSearchText(item));
      const overlapCount = itemTokens.filter((token) => scenarioTokens.has(token)).length;
      const pathBonus = scenarioText.includes(item.path.toLowerCase()) ? 2 : 0;

      return {
        item,
        score: overlapCount + pathBonus
      };
    })
    .filter((entry) => entry.score > 0);

  if (scoredCaptureItems.length === 0) {
    return scopedCaptureItems;
  }

  const bestScore = Math.max(...scoredCaptureItems.map((entry) => entry.score));
  if (bestScore < 2) {
    return scopedCaptureItems;
  }

  return scoredCaptureItems.filter((entry) => entry.score === bestScore).map((entry) => entry.item);
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
): string[] {
  const scenarioTokens = new Set(
    tokenizeScenarioText([scenario.title, scenario.goal, ...scenario.when, ...scenario.then].join(" ").toLowerCase())
  );
  const matchingCriteria = acceptanceCriteria.filter((criterion) =>
    tokenizeScenarioText(criterion.description.toLowerCase()).filter((token) => scenarioTokens.has(token)).length >= 2
  );

  return (matchingCriteria.length > 0 ? matchingCriteria : acceptanceCriteria).map((criterion) => criterion.description);
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

function buildWorkItems(input: {
  codeSurface: CodeSurfaceSelection;
  scenarios: NormalizedIntent["businessIntent"]["scenarios"];
  acceptanceCriteria: NormalizedIntent["businessIntent"]["acceptanceCriteria"];
  sourcePlans: NormalizedIntent["executionPlan"]["sources"];
  sourceIds: string[];
  desiredOutcome: string;
  availableSources: Record<string, AvailableSourceDescriptor>;
}): NormalizedIntent["businessIntent"]["workItems"] {
  const executableScenarios = input.scenarios.filter(isExecutableVisualScenario);

  const scenarioItems: TDDWorkItem[] = [];

  for (const scenario of executableScenarios) {
    for (const sourceId of scenario.applicableSourceIds) {
      const id = createPlanId("work", `${scenario.title}-${sourceId}`, scenarioItems.length);
      const userVisibleOutcome = scenario.then[0] ?? input.desiredOutcome;
      const verification = buildWorkItemVerification(scenario);
      const relevantAcceptanceCriteria = selectRelevantAcceptanceCriteria(scenario, input.acceptanceCriteria);
      const captureScope = input.sourcePlans.find((sourcePlan) => sourcePlan.sourceId === sourceId)?.captureScope ?? {
        mode: "all",
        captureIds: []
      };

      scenarioItems.push({
        id,
        type: "playwright-spec",
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
          specs: buildPlaywrightSpecs({
            codeSurface: input.codeSurface,
            scenario,
            workItemId: id,
            title: scenario.title,
            scenarioIds: [scenario.id],
            sourceIds: [sourceId],
            desiredOutcome: userVisibleOutcome,
            acceptanceCriteria: relevantAcceptanceCriteria,
            captureScope,
            availableSources: input.availableSources
          })
        }
      });
    }
  }

  const fallbackSourceItems: TDDWorkItem[] = input.sourceIds.flatMap((sourceId, index) => {
    const hasExecutableScenario = scenarioItems.some((workItem) => workItem.sourceIds.includes(sourceId));
    if (hasExecutableScenario) {
      return [];
    }

    const id = createPlanId("work", `capture-reviewable-evidence-${sourceId}`, scenarioItems.length + index);
    const scenarioIds = input.scenarios
      .filter((scenario) => scenario.applicableSourceIds.includes(sourceId))
      .map((scenario) => scenario.id);
    const captureScope = input.sourcePlans.find((sourcePlan) => sourcePlan.sourceId === sourceId)?.captureScope ?? {
      mode: "all",
      captureIds: []
    };

    return [
      {
        id,
        type: "playwright-spec",
        title: `Capture reviewable evidence for ${sourceId}`,
        description: `Generate a QA-runnable Playwright screenshot flow for ${sourceId}.`,
        scenarioIds,
        sourceIds: [sourceId],
        userVisibleOutcome: `QA can inspect reviewable screenshots for ${sourceId}.`,
        verification: `A generated Playwright spec captures screenshots for ${sourceId} and can run in the QA stage.`,
        execution: {
          order: scenarioItems.length + index + 1,
          dependsOnWorkItemIds: []
        },
        playwright: {
          generatedBy: "rules",
          specs: buildPlaywrightSpecs({
            codeSurface: input.codeSurface,
            workItemId: id,
            title: `Capture reviewable evidence for ${sourceId}`,
            scenarioIds,
            sourceIds: [sourceId],
            desiredOutcome: `QA can inspect reviewable screenshots for ${sourceId}.`,
            acceptanceCriteria: [],
            captureScope,
            availableSources: input.availableSources
          })
        }
      }
    ];
  });

  return [...scenarioItems, ...fallbackSourceItems];
}

function assertMinimumE2ECoverage(input: {
  sourceIds: string[];
  workItems: TDDWorkItem[];
}): void {
  const uncoveredSourceIds = input.sourceIds.filter((sourceId) => {
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
    },
    {
      id: "linear-parent-issue",
      type: "linear",
      label: "Linear parent issue",
      status: input.linearEnabled ? "active" : "planned",
      reason: input.linearEnabled
        ? "Linear is enabled and can receive the structured BDD/TDD output for this intent."
        : "Linear is the preferred destination for the BDD/TDD plan, but it is currently disabled in config.",
      details: [
        "Carries the business intent, acceptance criteria, scenarios, work items, and execution updates.",
        input.linearEnabled ? "Publishing can happen during execution." : "Enable config.linear.enabled to publish automatically."
      ]
    }
  ];

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
  intentType: NormalizedIntent["intentType"];
  linearEnabled: boolean;
  sourceIds: string[];
  planningDepth: PlanningDepth;
  agent?: AgentConfig;
}): NormalizedIntent["executionPlan"]["tools"] {
  const implementationEnabled = resolveAgentStageConfig(input.agent, "implementation").enabled;
  const qaVerificationEnabled = resolveAgentStageConfig(input.agent, "qaVerification").enabled;

  return [
    {
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
    },
    {
      id: "bdd-planning",
      type: "intent-planning",
      label: "BDD planning",
      enabled: input.planningDepth === "full",
      reason:
        input.planningDepth === "full"
          ? "The system converts the raw prompt into reviewable acceptance criteria and scenarios after Linear scoping completes."
          : "BDD planning is deferred until Linear scoping completes.",
      details: [
        input.planningDepth === "full"
          ? "Deterministic by default, with optional Gemini refinement when configured."
          : "The detailed planner pass will write acceptance criteria and scenarios back onto the scoped Linear lanes."
      ]
    },
    {
      id: "playwright-tdd",
      type: "playwright-tdd",
      label: "Playwright TDD generation",
      enabled: input.planningDepth === "full" && input.sourceIds.length > 0,
      reason:
        input.planningDepth !== "full"
          ? "Playwright-first TDD generation waits for the scoped Linear lanes."
          : input.sourceIds.length > 0
            ? "Applicable sources now produce Playwright-first executable test plans and checkpoint screenshots."
            : "No sources were selected for Playwright-first test generation.",
      details: [
        input.planningDepth === "full"
          ? "Generated specs are intended for checked-in repo storage with overwrite semantics."
          : "The detailed planner pass will attach Playwright-first work items after scoping completes."
      ]
    },
    {
      id: "screenshot-evidence",
      type: "screenshot",
      label: "Visual evidence capture",
      enabled: input.sourceIds.length > 0,
      reason: input.sourceIds.length > 0
        ? "Applicable sources currently expose visual capture definitions."
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
      details: ["Reports become distribution inputs for destinations like Linear and GitHub."]
    },
    {
      id: "linear-publishing",
      type: "linear-publishing",
      label: "Linear publishing",
      enabled: input.linearEnabled,
      reason: input.linearEnabled
        ? "Linear is enabled and can receive the plan plus execution updates."
        : "Linear publishing is planned, but config currently disables it.",
      details: ["Intended to carry the parent issue for BDD, AC, and TDD structure."]
    }
  ];
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
    notes.push("The current executor still applies one capture workflow across all selected repos.");
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
    intentType: inferIntentType(trimmedPrompt),
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
    intentType: hints.intentType ?? rulesResolution.intentType,
    sourceIds,
    selectionReason,
    promptMatchValues: selectionReason === rulesResolution.selectionReason ? rulesResolution.promptMatchValues : {},
    desiredOutcome: sanitizeText(hints.desiredOutcome) ?? rulesResolution.desiredOutcome,
    codeSurfaceId: hints.codeSurfaceId,
    codeSurfaceAlternatives: sanitizeCodeSurfaceIds(hints.codeSurfaceAlternatives),
    captureIdsBySource,
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
  if (sourceId === "intent-poc-app" && promptMatchValue === "demo-catalog") {
    const legacyDemoCatalogCaptureIds = ["library-index", "component-button-primary", "page-analytics-overview"];
    const availableCaptureIds = new Set(options.availableSources[sourceId].capture.items.map((item) => item.id));
    const compatibleCaptureIds = legacyDemoCatalogCaptureIds.filter((captureId) => availableCaptureIds.has(captureId));

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

function buildIntentDraft(
  trimmedPrompt: string,
  options: NormalizeIntentOptions,
  resolution: NormalizationResolution,
  codeSurface: CodeSurfaceSelection,
  planningRefinement?: IntentPlanningRefinement
): IntentDraft {
  const planningDepth = options.planningDepth ?? "full";
  const primarySourceId = resolution.sourceIds[0] ?? options.defaultSourceId;
  const sourcePlans = resolution.sourceIds.map((sourceId) => {
    const captureSelection = pickCaptureScopeForSource(trimmedPrompt, sourceId, options, resolution);

    return {
      sourceId,
      selectionReason: describeSelectionReason(resolution.selectionReason, sourceId, resolution.promptMatchValues[sourceId]),
      captureScope: captureSelection.captureScope,
      warnings: captureSelection.warnings
    };
  });
  const primaryCaptureScope =
    sourcePlans[0]?.captureScope ?? pickCaptureIds(trimmedPrompt, options.availableSources[primarySourceId].capture.items);
  const statement = planningRefinement?.statement ?? trimmedPrompt;
  const desiredOutcome = planningRefinement?.desiredOutcome ?? resolution.desiredOutcome;
  const acceptanceCriteria =
    planningDepth === "scoping"
      ? []
      : planningRefinement?.acceptanceCriteria ??
        buildAcceptanceCriteria(trimmedPrompt, desiredOutcome, resolution.sourceIds, resolution.intentType);
  const scenarios =
    planningDepth === "scoping"
      ? []
      : planningRefinement?.scenarios ??
        buildScenarios({
          statement,
          desiredOutcome,
          sourceIds: resolution.sourceIds,
          acceptanceCriteria
        });
  const workItems =
    planningDepth === "scoping"
      ? []
      : buildWorkItems({
          codeSurface,
          scenarios,
          acceptanceCriteria,
          sourcePlans,
          sourceIds: resolution.sourceIds,
          desiredOutcome,
          availableSources: options.availableSources
        });

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
    intentType: resolution.intentType,
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
  const reviewNotes: string[] = [];

  if (resolution.sourceIds.length > 1) {
    reviewNotes.push("This intent will execute as one business run with a separate evidence lane for each applicable source.");
  }

  if (!options.linearEnabled) {
    reviewNotes.push("Linear publishing is part of the plan, but it is inactive until config.linear.enabled is turned on.");
  }

  if (planningDepth === "scoping") {
    reviewNotes.push("BDD and Playwright-first TDD planning are deferred until Linear scoping creates the reusable business and source lanes.");
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
    destinations,
    tools,
    repoCandidates,
    planningReviewNotes,
    reviewNotes,
    summary: summarizeIntent(resolution.intentType, resolution.sourceIds)
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
  const draft = buildIntentDraft(trimmedPrompt, options, resolution, codeSurface, input.planningRefinement);
  const intentId = `${new Date().toISOString().replace(/[.:]/g, "-")}-${sanitizeFileSegment(draft.summary)}`;

  return {
    intentId,
    receivedAt: new Date().toISOString(),
    rawPrompt: trimmedPrompt,
    summary: draft.summary,
    intentType: resolution.intentType,
    codeSurface,
    businessIntent: {
      statement: draft.statement,
      desiredOutcome: draft.desiredOutcome,
      acceptanceCriteria: draft.acceptanceCriteria,
      scenarios: draft.scenarios,
      workItems: draft.workItems
    },
    planning: {
      repoCandidates: draft.repoCandidates,
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
      warnings: dedupeValues([
        ...draft.reviewNotes,
        ...draft.planningReviewNotes,
        ...resolution.normalizationWarnings,
        ...(input.planningRefinement?.warnings ?? [])
      ]),
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

export function normalizeIntent(options: NormalizeIntentOptions): NormalizedIntent {
  const trimmedPrompt = options.rawPrompt.trim();
  ensurePrompt(trimmedPrompt);
  const planningDepth = options.planningDepth ?? "full";

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
      linearStage.enabled ? buildRulesStageMeta(linearStage) : buildSkippedStageMeta(linearStage),
      planningDepth === "full"
        ? bddStage.enabled
          ? buildRulesStageMeta(bddStage)
          : buildSkippedStageMeta(bddStage)
        : buildStageMeta(
            bddStage,
            "skipped",
            "skipped",
            ["BDD planning is deferred until Linear scoping completes."]
          ),
      planningDepth === "full"
        ? tddStage.enabled
          ? buildRulesStageMeta(tddStage)
          : buildSkippedStageMeta(tddStage)
        : buildStageMeta(
            tddStage,
            "skipped",
            "skipped",
            ["Playwright-first TDD planning is deferred until Linear scoping completes."]
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

  let resolution = rulesResolution;
  const stageMetas: AgentStageMeta[] = [];

  const promptStage = resolveAgentStageConfig(options.agent, "promptNormalization");
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
  if (!linearStage.enabled) {
    stageMetas.push(buildSkippedStageMeta(linearStage));
  } else if (!linearStage.provider) {
    stageMetas.push(buildRulesStageMeta(linearStage));
  } else {
    const message = `${linearStage.label} does not yet support provider-backed execution, so deterministic Linear lane scoping was used.`;
    if (linearStage.fallbackToRules) {
      stageMetas.push(buildRulesStageMeta(linearStage, [message]));
    } else {
      throw new Error(message);
    }
  }

  if (planningDepth === "scoping") {
    const bddStage = resolveAgentStageConfig(options.agent, "bddPlanning");
    stageMetas.push(
      buildStageMeta(bddStage, "skipped", "skipped", ["BDD planning is deferred until Linear scoping completes."])
    );

    const tddStage = resolveAgentStageConfig(options.agent, "tddPlanning");
    stageMetas.push(
      buildStageMeta(tddStage, "skipped", "skipped", ["Playwright-first TDD planning is deferred until Linear scoping completes."])
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
  let planningRefinement: IntentPlanningRefinement | undefined;
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
        intentType: resolution.intentType,
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
  if (!tddStage.enabled) {
    stageMetas.push(buildSkippedStageMeta(tddStage));
  } else if (!tddStage.provider) {
    stageMetas.push(buildRulesStageMeta(tddStage));
  } else {
    const message = `${tddStage.label} does not yet support provider-backed execution, so deterministic Playwright spec generation was used.`;
    if (tddStage.fallbackToRules) {
      stageMetas.push(buildRulesStageMeta(tddStage, [message]));
    } else {
      throw new Error(message);
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
    stageMetas
  });
}