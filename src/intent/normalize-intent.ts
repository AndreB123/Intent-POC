import { CaptureItemConfig, RunMode, SourceConfig } from "../config/schema";
import { sanitizeFileSegment } from "../shared/fs";
import { NormalizedIntent } from "./intent-types";

type AvailableSourceDescriptor = Pick<SourceConfig, "aliases" | "capture" | "planning" | "source">;

interface NormalizeIntentOptions {
  rawPrompt: string;
  runMode: RunMode;
  defaultSourceId: string;
  continueOnCaptureError: boolean;
  availableSources: Record<string, AvailableSourceDescriptor>;
  linearEnabled?: boolean;
  publishToSourceWorkspace?: boolean;
  resumeIssue?: string;
  sourceIdOverride?: string;
  modeOverride?: RunMode;
}

interface SourceSelection {
  sourceIds: string[];
  selectionReason: "operator-override" | "prompt-match" | "business-wide" | "default";
}

const businessWideIntentPattern =
  /\b(all targets|all systems|all sources|multiple targets|multiple systems|across\b|business[- ]wide|organization[- ]wide|org[- ]wide|everywhere|cross[- ]target|cross[- ]system)\b/i;

function inferIntentType(prompt: string, fallback: RunMode): NormalizedIntent["intentType"] {
  if (/approve|promote.+baseline|bless.+baseline/i.test(prompt)) {
    return "approve-baseline";
  }

  if (/create.+baseline|initialize.+baseline|bootstrap.+baseline/i.test(prompt)) {
    return "baseline";
  }

  if (/refresh|rebuild|maintain|update.+library/i.test(prompt)) {
    return "refresh-library";
  }

  if (/compare|drift|changed|diff/i.test(prompt)) {
    return "compare";
  }

  return fallback;
}

function dedupeValues(values: string[]): string[] {
  return Array.from(new Set(values));
}

function pickMentionedSourceIds(prompt: string, options: NormalizeIntentOptions): string[] {
  const loweredPrompt = prompt.toLowerCase();
  const matches: string[] = [];

  for (const [sourceId, source] of Object.entries(options.availableSources)) {
    if (loweredPrompt.includes(sourceId.toLowerCase())) {
      matches.push(sourceId);
      continue;
    }

    if (source.aliases.some((alias) => loweredPrompt.includes(alias.toLowerCase()))) {
      matches.push(sourceId);
    }
  }

  return dedupeValues(matches);
}

function pickApplicableSourceIds(prompt: string, options: NormalizeIntentOptions): SourceSelection {
  if (options.sourceIdOverride) {
    return {
      sourceIds: [options.sourceIdOverride],
      selectionReason: "operator-override"
    };
  }

  const matchedSourceIds = pickMentionedSourceIds(prompt, options);
  if (matchedSourceIds.length > 0) {
    return {
      sourceIds: matchedSourceIds,
      selectionReason: "prompt-match"
    };
  }

  if (businessWideIntentPattern.test(prompt)) {
    return {
      sourceIds: Object.keys(options.availableSources),
      selectionReason: "business-wide"
    };
  }

  return {
    sourceIds: [options.defaultSourceId],
    selectionReason: "default"
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

function summarizeIntent(intentType: NormalizedIntent["intentType"], sourceIds: string[]): string {
  const scope = sourceIds.length === 1 ? sourceIds[0] : `${sourceIds.length} sources`;

  switch (intentType) {
    case "baseline":
      return `create baseline evidence for ${scope}`;
    case "approve-baseline":
      return `approve latest evidence as baseline for ${scope}`;
    case "refresh-library":
      return `refresh evidence library for ${scope}`;
    case "compare":
    default:
      return `compare evidence drift for ${scope}`;
  }
}

function mapIntentTypeToRunMode(intentType: NormalizedIntent["intentType"], fallback: RunMode): RunMode {
  if (intentType === "baseline") {
    return "baseline";
  }

  if (intentType === "approve-baseline") {
    return "approve-baseline";
  }

  if (intentType === "compare") {
    return "compare";
  }

  return fallback;
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
    intentType === "baseline"
      ? "Evidence is captured and stored as a baseline that can be reviewed later."
      : intentType === "approve-baseline"
        ? "Latest evidence is promoted as the approved baseline for future verification."
        : intentType === "refresh-library"
          ? "Evidence artifacts are refreshed and ready for review."
          : "Evidence is compared against the current baseline and drift is made visible.",
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
  runMode: RunMode;
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
      title: "Executable evidence is prepared for applicable sources",
      goal: "Define what visible verification should happen for each source involved in the intent.",
      given: [
        input.sourceIds.length === 1
          ? `Source ${input.sourceIds[0]} is available for execution.`
          : `${input.sourceIds.length} sources are applicable to the intent.`
      ],
      when: [
        `Execution is prepared in ${input.runMode} mode.`,
        "Visible evidence tooling is assigned to each applicable source."
      ],
      then: [
        input.sourceIds.length === 1
          ? `Evidence is ready to be gathered from ${input.sourceIds[0]}.`
          : `Evidence lanes are defined for ${input.sourceIds.join(", ")}.`,
        "The resulting work remains understandable without a specific agent implementation."
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

function buildWorkItems(input: {
  scenarios: NormalizedIntent["businessIntent"]["scenarios"];
  sourceIds: string[];
  desiredOutcome: string;
}): NormalizedIntent["businessIntent"]["workItems"] {
  const scenarioItems = input.scenarios.map((scenario, index) => ({
    id: createPlanId("work", scenario.title, index),
    title: scenario.title,
    description: scenario.goal,
    scenarioIds: [scenario.id],
    sourceIds: scenario.applicableSourceIds,
    userVisibleOutcome: scenario.then[0] ?? input.desiredOutcome,
    verification: scenario.then[scenario.then.length - 1] ?? input.desiredOutcome
  }));

  const perSourceItems = input.sourceIds.map((sourceId, index) => ({
    id: createPlanId("work", `visible-evidence-${sourceId}`, input.scenarios.length + index),
    title: `Produce visible evidence for ${sourceId}`,
    description: `Make the outcome of the intent inspectable through the evidence tools configured for ${sourceId}.`,
    scenarioIds: input.scenarios
      .filter((scenario) => scenario.applicableSourceIds.includes(sourceId))
      .map((scenario) => scenario.id),
    sourceIds: [sourceId],
    userVisibleOutcome: `Users can verify the outcome for ${sourceId} without reading implementation details.`,
    verification: `Evidence for ${sourceId} is linked back to the intent and its scenarios.`
  }));

  return [...scenarioItems, ...perSourceItems];
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
}): NormalizedIntent["executionPlan"]["tools"] {
  return [
    {
      id: "intent-planning",
      type: "intent-planning",
      label: "Intent planning",
      enabled: true,
      reason: "The system converts the raw prompt into reviewable BDD and TDD structure before execution.",
      details: ["Deterministic and human-reviewable until a real agent is introduced."]
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
      id: "evidence-comparison",
      type: "comparison",
      label: "Evidence comparison",
      enabled: input.intentType === "compare" || input.intentType === "approve-baseline",
      reason:
        input.intentType === "compare" || input.intentType === "approve-baseline"
          ? "The intent requires comparing current evidence against a baseline."
          : "Comparison is not required for a baseline-only execution.",
      details: ["Uses pixel diff today; future tools can add non-visual verification."]
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

function describeSelectionReason(reason: SourceSelection["selectionReason"], sourceId: string): string {
  switch (reason) {
    case "operator-override":
      return `Source ${sourceId} was selected explicitly by the operator override.`;
    case "prompt-match":
      return `Source ${sourceId} was referenced directly in the prompt.`;
    case "business-wide":
      return `Source ${sourceId} is included because the prompt describes a business-wide or cross-system intent.`;
    case "default":
    default:
      return `Source ${sourceId} falls back to the configured default because the prompt did not name a specific source.`;
  }
}

function describeRepoSelectionReason(reason: SourceSelection["selectionReason"], repoId: string, sourceIds: string[]): string {
  if (sourceIds.length === 1) {
    return describeSelectionReason(reason, sourceIds[0]);
  }

  switch (reason) {
    case "operator-override":
      return `Repo ${repoId} is in scope because the operator explicitly selected sources ${sourceIds.join(", ")}.`;
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
            ? describeRepoSelectionReason(input.sourceSelection.selectionReason, entry.repoId, entry.selectedSourceIds)
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
    notes.push("The current executor still applies a single run mode across all selected repos; mixed per-repo modes are not yet supported.");
  }

  return notes;
}

export function normalizeIntent(options: NormalizeIntentOptions): NormalizedIntent {
  const trimmedPrompt = options.rawPrompt.trim();
  const sourceSelection = pickApplicableSourceIds(trimmedPrompt, options);
  const intentType = inferIntentType(trimmedPrompt, options.runMode);
  const effectiveRunMode = mapIntentTypeToRunMode(intentType, options.runMode);
  const primarySourceId = sourceSelection.sourceIds[0] ?? options.defaultSourceId;
  const primarySource = options.availableSources[primarySourceId];
  const captureScope = pickCaptureIds(trimmedPrompt, primarySource.capture.items);
  const sourcePlans = sourceSelection.sourceIds.map((sourceId) => {
    const source = options.availableSources[sourceId];

    return {
      sourceId,
      selectionReason: describeSelectionReason(sourceSelection.selectionReason, sourceId),
      runMode: effectiveRunMode,
      captureScope: pickCaptureIds(trimmedPrompt, source.capture.items),
      warnings: []
    };
  });
  const desiredOutcome = extractDesiredOutcome(trimmedPrompt);
  const acceptanceCriteria = buildAcceptanceCriteria(trimmedPrompt, desiredOutcome, sourceSelection.sourceIds, intentType);
  const scenarios = buildScenarios({
    statement: trimmedPrompt,
    desiredOutcome,
    sourceIds: sourceSelection.sourceIds,
    acceptanceCriteria,
    runMode: effectiveRunMode
  });
  const workItems = buildWorkItems({
    scenarios,
    sourceIds: sourceSelection.sourceIds,
    desiredOutcome
  });
  const destinations = buildDestinationPlans({
    prompt: trimmedPrompt,
    linearEnabled: options.linearEnabled ?? false,
    publishToSourceWorkspace: options.publishToSourceWorkspace ?? false
  });
  const tools = buildToolPlans({
    intentType,
    linearEnabled: options.linearEnabled ?? false,
    sourceIds: sourceSelection.sourceIds
  });
  const repoCandidates = buildRepoCandidates({
    availableSources: options.availableSources,
    sourceSelection
  });
  const planningReviewNotes = buildPlanningReviewNotes({
    repoCandidates,
    sourceIds: sourceSelection.sourceIds,
    resumeIssue: options.resumeIssue
  });
  const reviewNotes: string[] = [];

  if (sourceSelection.sourceIds.length > 1) {
    reviewNotes.push("This intent will execute as one business run with a separate evidence lane for each applicable source.");
  }

  if (!options.linearEnabled) {
    reviewNotes.push("Linear publishing is part of the plan, but it is inactive until config.linear.enabled is turned on.");
  }

  const summary = summarizeIntent(intentType, sourceSelection.sourceIds);
  const intentId = `${new Date().toISOString().replace(/[.:]/g, "-")}-${sanitizeFileSegment(summary)}`;

  return {
    intentId,
    receivedAt: new Date().toISOString(),
    rawPrompt: trimmedPrompt,
    summary,
    intentType,
    businessIntent: {
      statement: trimmedPrompt,
      desiredOutcome,
      acceptanceCriteria,
      scenarios,
      workItems
    },
    planning: {
      repoCandidates,
      plannerSections: buildPlannerSections(sourceSelection.sourceIds),
      reviewNotes: planningReviewNotes,
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
      primarySourceId,
      sources: sourcePlans,
      destinations,
      tools,
      orchestrationStrategy: sourcePlans.length > 1 ? "multi-source" : "single-source",
      reviewNotes
    },
    sourceId: primarySourceId,
    captureScope,
    artifacts: {
      requireScreenshots: true,
      requireManifest: true,
      requireHashes: true,
      requireComparison: effectiveRunMode === "compare"
    },
    linear: {
      createIssue: true,
      issueTitle: `IDD: ${trimmedPrompt.slice(0, 96)}`
    },
    execution: {
      runMode: effectiveRunMode,
      continueOnCaptureError: options.continueOnCaptureError
    },
    normalizationMeta: {
      source: "rules",
      warnings: [...reviewNotes, ...planningReviewNotes]
    }
  };
}