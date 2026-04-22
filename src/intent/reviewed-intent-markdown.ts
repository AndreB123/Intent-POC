import { NormalizedIntent, PlanningScopingDetails } from "./intent-types";

type ScopingDetailsSectionName = keyof PlanningScopingDetails;

export interface ReviewedIntentDraftPreview {
  intent: string;
  outcome: string;
  repoContext: string[];
  sourceScope: string[];
  adaptiveBoundaries: string[];
  nonGoals: string[];
  minimumSuccess: string[];
  baseline: string[];
  verificationObligations: string[];
  deliveryObligations: string[];
  reviewNotes: string[];
}

export interface ParsedReviewedIntentMarkdown {
  isReviewedIntentMarkdown: boolean;
  intent?: string;
  desiredOutcome?: string;
  rawIntent?: string;
}

function isScopingPreview(normalizedIntent: NormalizedIntent): boolean {
  return normalizedIntent.normalizationMeta.effectivePlanningDepth === "scoping";
}

function joinList(values: string[]): string {
  if (values.length <= 1) {
    return values[0] ?? "";
  }

  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }

  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function buildHeuristicScopingNote(normalizedIntent: NormalizedIntent): string | undefined {
  if (normalizedIntent.normalizationMeta.source === "llm") {
    return undefined;
  }

  if (normalizedIntent.normalizationMeta.source === "fallback") {
    return "Scaffolded repo context from repo heuristics after Gemini prompt normalization fell back. Review and tighten before approval.";
  }

  return "Scaffolded repo context from repo heuristics. Review and tighten before approval.";
}

function mergeScopingPreviewItems(
  normalizedIntent: NormalizedIntent,
  sectionName: ScopingDetailsSectionName,
  fallbackItems: string[]
): string[] {
  const aiItems = uniqueValues(normalizedIntent.planning.scopingDetails?.[sectionName] ?? []);
  return aiItems.length > 0 ? uniqueValues([...aiItems, ...fallbackItems]) : fallbackItems;
}

function formatPathHints(pathPrefixes: string[]): string | undefined {
  const relevantPaths = uniqueValues(pathPrefixes).slice(0, 2);
  return relevantPaths.length > 0 ? joinList(relevantPaths) : undefined;
}

function formatSurfaceInspectionHint(surface: NonNullable<NormalizedIntent["planning"]["scopingContext"]>["alternativeSurfaces"][number]): string {
  const primaryPaths = formatPathHints(surface.primaryPaths);
  const adjacentPaths = formatPathHints(surface.adjacentPaths);

  if (primaryPaths && adjacentPaths) {
    return `${surface.label} via ${primaryPaths}; adjacent check ${adjacentPaths}`;
  }

  if (primaryPaths) {
    return `${surface.label} via ${primaryPaths}`;
  }

  if (adjacentPaths) {
    return `${surface.label} via ${adjacentPaths}`;
  }

  return surface.label;
}

function inferCurrentBehaviorObservation(prompt: string): string | undefined {
  const observationMatch = prompt.match(/\b(?:right now|currently)\b([^.!?]+)/i)
    ?? prompt.match(/\bit looks like\b([^.!?]+)/i);

  if (!observationMatch?.[1]) {
    return undefined;
  }

  const normalized = observationMatch[1]
    .replace(/^\s*(?:it looks like|that)\s*/i, "")
    .replace(/\bbut\b.*$/i, "")
    .replace(/^[,.;:\s]+|[,.;:\s]+$/g, "")
    .trim();

  if (normalized.length < 8) {
    return undefined;
  }

  const sentence = /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

function buildScopingRepoContextItems(normalizedIntent: NormalizedIntent): string[] {
  const scopingContext = getScopingContext(normalizedIntent);
  const heuristicNote = !normalizedIntent.planning.scopingDetails?.repoContext?.length
    ? buildHeuristicScopingNote(normalizedIntent)
    : undefined;
  const items: string[] = heuristicNote ? [heuristicNote] : [];
  const selectedRepo = normalizedIntent.planning.repoCandidates.find((repo) => repo.selectionStatus === "selected");

  if (
    selectedRepo?.summary
    && (!scopingContext.primarySurface || scopingContext.primarySurface.id === "shared-source")
  ) {
    items.push(`${selectedRepo.label}: ${selectedRepo.summary}`);
  }

  if (scopingContext.primarySurface?.primaryPaths.length) {
    items.push(`Start in ${scopingContext.primarySurface.label}: ${formatPathHints(scopingContext.primarySurface.primaryPaths)}.`);
  }

  if (
    scopingContext.primarySurface?.id === "shared-source"
    && scopingContext.primarySurface.confidence === "low"
    && scopingContext.alternativeSurfaces.length > 0
  ) {
    items.push(
      `Candidate surfaces to inspect first: ${joinList(scopingContext.alternativeSurfaces.slice(0, 2).map(formatSurfaceInspectionHint))}.`
    );
  }

  if (scopingContext.pathHints.length > 0 && scopingContext.primarySurface?.confidence !== "high") {
    const adjacentPaths = scopingContext.pathHints
      .filter((hint) => !scopingContext.primarySurface?.primaryPaths.includes(hint.path))
      .map((hint) => hint.path);

    if (adjacentPaths.length > 0) {
      items.push(`If the owner is adjacent, check ${formatPathHints(adjacentPaths)} next.`);
    }
  }

  if (scopingContext.uiStateHints.length > 0) {
    items.push(
      ...scopingContext.uiStateHints.map((hint) =>
        `Relevant UI state context: ${hint.reason}`
      )
    );
  }

  if (scopingContext.verificationHints.length > 0) {
    items.push(
      ...scopingContext.verificationHints.map((hint) => `${hint.sourceId} verification note: ${hint.note}`)
    );
  }

  if (scopingContext.repoNoteHints.length > 0) {
    items.push(
      ...scopingContext.repoNoteHints.map((hint) => `${hint.sourceId} repo note: ${hint.note}`)
    );
  }

  if (scopingContext.repoMemoryHints.length > 0) {
    items.push(
      ...scopingContext.repoMemoryHints.map((hint) => `${hint.title}: ${hint.note}`)
    );
  }

  if (scopingContext.unresolvedQuestions.length > 0) {
    items.push(`Open routing question: ${scopingContext.unresolvedQuestions[0]}`);
  }

  const fallbackItems = items.length > 0
    ? items
    : ["No prompt-specific repo context was identified yet. The next refinement pass needs a clearer owning surface or UI target."];

  return mergeScopingPreviewItems(normalizedIntent, "repoContext", fallbackItems);
}

function formatCaptureScope(normalizedIntent: NormalizedIntent): string {
  return normalizedIntent.captureScope.mode === "subset"
    ? normalizedIntent.captureScope.captureIds.join(", ")
    : "all configured captures";
}

function getScopingContext(normalizedIntent: NormalizedIntent): NonNullable<NormalizedIntent["planning"]["scopingContext"]> {
  if (normalizedIntent.planning.scopingContext) {
    return normalizedIntent.planning.scopingContext;
  }

  return {
    matchedPromptTerms: [],
    sourceMatches: normalizedIntent.executionPlan.sources.map((source) => ({
      sourceId: source.sourceId,
      matchedTerms: [],
      reason: source.selectionReason
    })),
    primarySurface: normalizedIntent.codeSurface
      ? {
          sourceId: normalizedIntent.codeSurface.sourceId,
          id: normalizedIntent.codeSurface.id,
          label: normalizedIntent.codeSurface.label,
          confidence: normalizedIntent.codeSurface.confidence,
          rationale: normalizedIntent.codeSurface.rationale,
          matchedTerms: [],
          primaryPaths: [],
          adjacentPaths: []
        }
      : undefined,
    alternativeSurfaces: normalizedIntent.codeSurface?.alternatives.map((item) => ({
      sourceId: normalizedIntent.codeSurface?.sourceId ?? normalizedIntent.sourceId,
      id: item.id,
      label: item.label,
      confidence: "low",
      rationale: item.reason,
      matchedTerms: [],
      primaryPaths: [],
      adjacentPaths: []
    })) ?? [],
    pathHints: [],
    uiStateHints: normalizedIntent.executionPlan.sources.flatMap((source) =>
      (source.uiStateRequirements ?? []).map((requirement) => ({
        sourceId: source.sourceId,
        stateId: requirement.stateId,
        label: requirement.label,
        reason: requirement.reason,
        verificationStrategies: requirement.verificationStrategies,
        notes: requirement.notes
      }))
    ),
    verificationHints: [],
    repoNoteHints: [],
    repoMemoryHints: [],
    captureHints: normalizedIntent.executionPlan.sources.flatMap((source) =>
      source.captureScope.mode === "subset" && source.captureScope.captureIds.length > 0
        ? [{ sourceId: source.sourceId, captureIds: source.captureScope.captureIds, reason: "Prompt narrowed capture scope." }]
        : []
    ),
    unresolvedQuestions: normalizedIntent.normalizationMeta.ambiguity.reasons
  };
}

function buildRepoContextItems(normalizedIntent: NormalizedIntent): string[] {
  if (isScopingPreview(normalizedIntent)) {
    return buildScopingRepoContextItems(normalizedIntent);
  }

  const repoItems = normalizedIntent.planning.repoCandidates
    .filter((repo) => repo.selectionStatus === "selected")
    .flatMap((repo) => {
      const summary = `${repo.label}: ${repo.reason}`;
      const details = [
        repo.role ? `${repo.label} role: ${repo.role}.` : undefined,
        repo.summary ? `${repo.label} summary: ${repo.summary}` : undefined,
        repo.sourceIds.length > 0 ? `${repo.label} sources: ${repo.sourceIds.join(", ")}.` : undefined,
        ...repo.notes.map((note) => `${repo.label} note: ${note}`)
      ];

      return [summary, ...details].filter((entry): entry is string => Boolean(entry));
    });

  return repoItems.length > 0 ? repoItems : ["Use the selected repo and source metadata as the planning context for this intent."];
}

function buildSourceScopeItems(normalizedIntent: NormalizedIntent): string[] {
  if (isScopingPreview(normalizedIntent)) {
    const scopingContext = getScopingContext(normalizedIntent);
    const sourceItems = scopingContext.sourceMatches.map((sourceMatch) => {
      const sourcePlan = normalizedIntent.executionPlan.sources.find((source) => source.sourceId === sourceMatch.sourceId);
      const captureScope = sourcePlan?.captureScope.mode === "subset"
        ? ` Prompt-matched captures: ${sourcePlan.captureScope.captureIds.join(", ")}.`
        : "";
      return sourceMatch.matchedTerms.length > 0
        ? `Selected source: ${sourceMatch.sourceId} via ${joinList(sourceMatch.matchedTerms)}.${captureScope}`
        : `Selected source: ${sourceMatch.sourceId}.${captureScope}`;
    });

    if (scopingContext.primarySurface) {
      sourceItems.push(
        scopingContext.primarySurface.id === "shared-source" && scopingContext.primarySurface.confidence === "low"
          ? "Owning surface is not identified yet inside the selected source."
          : `Likely owning surface: ${scopingContext.primarySurface.label} (${scopingContext.primarySurface.confidence} confidence).`
      );

      if (scopingContext.alternativeSurfaces.length > 0) {
        sourceItems.push(
          `Fallback surfaces to inspect next: ${joinList(scopingContext.alternativeSurfaces.map((item) => item.label))}.`
        );

        if (scopingContext.primarySurface.id === "shared-source" && scopingContext.primarySurface.confidence === "low") {
          sourceItems.push(
            ...scopingContext.alternativeSurfaces.slice(0, 2).map((surface, index) =>
              index === 0
                ? `Inspect first: ${formatSurfaceInspectionHint(surface)}.`
                : `Inspect next if needed: ${formatSurfaceInspectionHint(surface)}.`
            )
          );
        }
      }
    }

    return mergeScopingPreviewItems(normalizedIntent, "sourceScope", sourceItems);
  }

  const sourceItems = normalizedIntent.executionPlan.sources.map((source) => {
    const captureScope = source.captureScope.mode === "subset"
      ? source.captureScope.captureIds.join(", ")
      : "all configured captures";
    return `${source.sourceId}: ${source.selectionReason} Capture scope: ${captureScope}.`;
  });

  if (normalizedIntent.codeSurface) {
    sourceItems.push(
      `Primary code surface: ${normalizedIntent.codeSurface.label} (${normalizedIntent.codeSurface.confidence} confidence). ${normalizedIntent.codeSurface.rationale}`
    );
  }

  return sourceItems;
}

function buildAdaptiveBoundaryItems(normalizedIntent: NormalizedIntent): string[] {
  if (isScopingPreview(normalizedIntent)) {
    const scopingContext = getScopingContext(normalizedIntent);
    const sourceScope = joinList(normalizedIntent.executionPlan.sources.map((source) => source.sourceId));
    const items = [`Keep this draft inside ${sourceScope} until the owning surface is confirmed.`];

    if (scopingContext.primarySurface) {
      const adjacentPaths = formatPathHints(scopingContext.primarySurface.adjacentPaths);

      if (scopingContext.primarySurface.id !== "shared-source") {
        items.push(`Start with ${scopingContext.primarySurface.label} before widening into adjacent surfaces.`);
      }

      if (scopingContext.alternativeSurfaces.length > 0) {
        items.push(
          `Resolve whether the change belongs to ${joinList(scopingContext.alternativeSurfaces.map((item) => item.label))} before touching multiple UI surfaces.`
        );
      } else if (adjacentPaths) {
        items.push(`Only widen into ${adjacentPaths} if the primary surface does not own the behavior.`);
      }
    }

    return mergeScopingPreviewItems(normalizedIntent, "adaptiveBoundaries", uniqueValues(items));
  }

  const items = [
    `Keep the work inside the approved source scope: ${normalizedIntent.executionPlan.sources.map((source) => source.sourceId).join(", ")}.`,
    normalizedIntent.codeSurface
      ? `Bias implementation toward ${normalizedIntent.codeSurface.label} and only step outside that surface when the reviewed intent requires it.`
      : "Keep implementation inside the selected repo surface and avoid unrelated code paths.",
    "Follow the repo screenshot and artifact contract instead of creating new durable output paths.",
    "Prefer refactor-first changes over additive parallel legacy flows.",
    "Use configured source metadata, UI-state notes, and verification hints as the boundary for planning decisions."
  ];

  return items;
}

function buildNonGoalItems(normalizedIntent: NormalizedIntent): string[] {
  if (isScopingPreview(normalizedIntent)) {
    return [];
  }

  return [
    "Do not start implementation before this reviewed intent is explicitly approved.",
    `Do not expand into unselected sources beyond ${normalizedIntent.executionPlan.sources.map((source) => source.sourceId).join(", ")}.`,
    "Do not create parallel workflows or duplicate artifact pipelines to satisfy this change."
  ];
}

function buildMinimumSuccessItems(normalizedIntent: NormalizedIntent): string[] {
  if (isScopingPreview(normalizedIntent)) {
    const scopingContext = getScopingContext(normalizedIntent);
    const items = [normalizedIntent.businessIntent.desiredOutcome];

    if (normalizedIntent.codeSurface) {
      items.push(
        normalizedIntent.codeSurface.confidence === "low"
          ? "The draft names the most likely owning surface and what to inspect next before implementation starts."
          : `The draft keeps the change centered on ${normalizedIntent.codeSurface.label} instead of the whole repo.`
      );
    }

    items.push(
      normalizedIntent.codeSurface?.id === "orchestrator-and-planning"
        ? "The final plan names the narrow code validation that proves the requested behavior."
        : scopingContext.captureHints.length > 0
          ? `The final plan reuses existing verification around ${joinList(scopingContext.captureHints.flatMap((hint) => hint.captureIds))}.`
          : "The final plan names one existing UI verification path instead of inventing a new workflow."
    );

    return mergeScopingPreviewItems(normalizedIntent, "minimumSuccess", items);
  }

  const items = [normalizedIntent.businessIntent.desiredOutcome];

  if (normalizedIntent.codeSurface?.id === "orchestrator-and-planning") {
    items.push("Targeted code validation passes for the affected planning or orchestration surface.");
  } else {
    items.push("UI-affecting behavior has executable Playwright or screenshot verification in the selected source scope.");
  }

  items.push("Documentation is updated when the reviewed intent changes behavior, workflow, or user-facing functionality.");
  items.push("The final change fits the existing repo structure and reuses current runtime and artifact contracts.");

  return items;
}

function buildBaselineItems(normalizedIntent: NormalizedIntent): string[] {
  if (isScopingPreview(normalizedIntent)) {
    const scopingContext = getScopingContext(normalizedIntent);
    const items: string[] = [];
    const currentBehaviorObservation = inferCurrentBehaviorObservation(normalizedIntent.rawPrompt);

    if (currentBehaviorObservation) {
      items.push(`Current behavior to confirm: ${currentBehaviorObservation}`);
    }

    items.push(
      scopingContext.primarySurface && !(scopingContext.primarySurface.id === "shared-source" && scopingContext.primarySurface.confidence === "low")
        ? `Capture the current baseline in ${scopingContext.primarySurface.label} before changing behavior.`
        : `Capture the current baseline in ${joinList(normalizedIntent.executionPlan.sources.map((source) => source.sourceId))} before changing behavior.`
    );

    if (normalizedIntent.captureScope.mode === "subset") {
      items.push(`Stay inside the prompt-matched capture scope: ${formatCaptureScope(normalizedIntent)}.`);
    }

    return mergeScopingPreviewItems(normalizedIntent, "baseline", items);
  }

  const items = [
    normalizedIntent.codeSurface
      ? `Baseline reference surface: ${normalizedIntent.codeSurface.label}.`
      : `Baseline reference sources: ${normalizedIntent.executionPlan.sources.map((source) => source.sourceId).join(", ")}.`,
    `Baseline capture scope starts from ${formatCaptureScope(normalizedIntent)}.`,
    "Confirm the current behavior in the selected source scope before applying changes so review compares against the real starting state."
  ];

  return items;
}

function buildVerificationItems(normalizedIntent: NormalizedIntent): string[] {
  if (isScopingPreview(normalizedIntent)) {
    const scopingContext = getScopingContext(normalizedIntent);
    const fallbackItems = normalizedIntent.codeSurface?.id === "orchestrator-and-planning"
      ? ["Name the narrow code validation that proves the behavior change before implementation starts."]
      : [
          scopingContext.captureHints.length > 0
            ? `Start from existing capture coverage: ${joinList(scopingContext.captureHints.flatMap((hint) => hint.captureIds))}.`
            : scopingContext.uiStateHints.length > 0
              ? `Verification must activate ${joinList(scopingContext.uiStateHints.map((hint) => hint.label ?? hint.stateId))} before trusting evidence.`
              : normalizedIntent.codeSurface?.id === "shared-source" && normalizedIntent.codeSurface.confidence === "low"
                ? scopingContext.alternativeSurfaces.length > 0
                  ? `Identify the existing Playwright or screenshot check closest to ${joinList(scopingContext.alternativeSurfaces.slice(0, 2).map((surface) => surface.label))} before planning implementation.`
                  : "Identify the existing Playwright or screenshot check closest to the affected screen before planning implementation."
                : "Name the existing Playwright or screenshot check that will prove the behavior change."
        ];

    return mergeScopingPreviewItems(normalizedIntent, "verificationObligations", fallbackItems);
  }

  const items = ["Typecheck and source-appropriate automated tests must pass before delivery."];

  if (normalizedIntent.codeSurface?.id === "orchestrator-and-planning") {
    items.push("Add targeted code tests for new planning or orchestration behavior.");
  } else {
    items.push("Create or update Playwright verification that follows the repo screenshot pattern.");
    items.push("UI changes must produce reviewable screenshot evidence for the affected surface.");
  }

  return items;
}

function buildDeliveryItems(normalizedIntent: NormalizedIntent): string[] {
  if (isScopingPreview(normalizedIntent)) {
    return [];
  }

  const activeDestinations = normalizedIntent.executionPlan.destinations
    .filter((destination) => destination.status !== "inactive")
    .map((destination) => `${destination.label}: ${destination.reason}`);

  return [
    "Publish the final summary and evidence bundle through the existing business artifact outputs.",
    ...activeDestinations,
    "Document the delivered outcome after verification passes."
  ];
}

export function buildReviewedIntentDraftPreview(input: { normalizedIntent: NormalizedIntent }): ReviewedIntentDraftPreview {
  const { normalizedIntent } = input;
  const scopingPreview = isScopingPreview(normalizedIntent);

  return {
    intent: normalizedIntent.businessIntent.statement,
    outcome: normalizedIntent.businessIntent.desiredOutcome,
    repoContext: buildRepoContextItems(normalizedIntent),
    sourceScope: buildSourceScopeItems(normalizedIntent),
    adaptiveBoundaries: buildAdaptiveBoundaryItems(normalizedIntent),
    nonGoals: buildNonGoalItems(normalizedIntent),
    minimumSuccess: buildMinimumSuccessItems(normalizedIntent),
    baseline: buildBaselineItems(normalizedIntent),
    verificationObligations: buildVerificationItems(normalizedIntent),
    deliveryObligations: buildDeliveryItems(normalizedIntent),
    reviewNotes: scopingPreview
      ? normalizedIntent.normalizationMeta.ambiguity.reasons
      : normalizedIntent.planning.reviewNotes.length > 0
        ? normalizedIntent.planning.reviewNotes
        : normalizedIntent.executionPlan.reviewNotes
  };
}

function buildMarkdownSection(title: string, items: string[] | string): string[] {
  const lines = Array.isArray(items)
    ? items.length > 0
      ? items.map((item) => `- ${item}`)
      : ["- None"]
    : [items];

  return [title, "", ...lines, ""];
}

function extractMarkdownSectionText(lines: string[]): string | undefined {
  const trimmedLines = lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (trimmedLines.length === 0) {
    return undefined;
  }

  const normalizedLines = trimmedLines
    .map((line) => line.replace(/^-\s+/, ""))
    .filter((line) => line !== "None");

  if (normalizedLines.length === 0) {
    return undefined;
  }

  return normalizedLines.join("\n").trim();
}

export function parseReviewedIntentMarkdown(markdown: string): ParsedReviewedIntentMarkdown {
  const sectionMap = new Map<string, string[]>();
  let currentSection: string | null = null;

  for (const line of markdown.split(/\r?\n/)) {
    const headingMatch = line.match(/^##\s+(.+)$/);
    if (headingMatch) {
      currentSection = headingMatch[1].trim();
      sectionMap.set(currentSection, []);
      continue;
    }

    if (!currentSection) {
      continue;
    }

    sectionMap.get(currentSection)?.push(line);
  }

  const intent = extractMarkdownSectionText(sectionMap.get("Intent") ?? []);
  const desiredOutcome = extractMarkdownSectionText(sectionMap.get("Desired Outcome") ?? []);
  const rawIntent = extractMarkdownSectionText(sectionMap.get("Raw Intent") ?? []);

  return {
    isReviewedIntentMarkdown: sectionMap.size > 0 && (sectionMap.has("Intent") || sectionMap.has("Raw Intent")),
    intent,
    desiredOutcome,
    rawIntent
  };
}

export function buildReviewedIntentPlanningPrompt(input: {
  prompt: string;
  fallbackPrompt?: string;
}): string {
  const parsed = parseReviewedIntentMarkdown(input.prompt);

  if (!parsed.isReviewedIntentMarkdown) {
    return input.prompt;
  }

  const primaryIntent = parsed.intent ?? parsed.rawIntent ?? input.fallbackPrompt ?? input.prompt;
  const sections = [primaryIntent.trim()];

  if (parsed.desiredOutcome && parsed.desiredOutcome !== primaryIntent) {
    sections.push(`Desired outcome: ${parsed.desiredOutcome}`);
  }

  if (parsed.rawIntent && parsed.rawIntent !== primaryIntent) {
    sections.push(`Original request context: ${parsed.rawIntent}`);
  }

  return sections.filter((section) => section.trim().length > 0).join("\n\n");
}

export function buildReviewedIntentMarkdown(input: {
  rawPrompt: string;
  normalizedIntent: NormalizedIntent;
}): string {
  const preview = buildReviewedIntentDraftPreview({ normalizedIntent: input.normalizedIntent });
  const scopingPreview = isScopingPreview(input.normalizedIntent);
  const sections: Array<{ title: string; items: string[] | string }> = [
    { title: "## Intent", items: preview.intent },
    { title: "## Desired Outcome", items: preview.outcome },
    { title: "## Repo Context", items: preview.repoContext },
    { title: "## Source Scope", items: preview.sourceScope },
    { title: "## Adaptive Boundaries", items: preview.adaptiveBoundaries },
    { title: "## Minimum Success", items: preview.minimumSuccess },
    { title: "## Baseline", items: preview.baseline }
  ];

  if (preview.nonGoals.length > 0 && !scopingPreview) {
    sections.push({ title: "## Non-Goals", items: preview.nonGoals });
  }

  if (preview.verificationObligations.length > 0) {
    sections.push({ title: "## Verification Obligations", items: preview.verificationObligations });
  }

  if (!scopingPreview && preview.deliveryObligations.length > 0) {
    sections.push({ title: "## Delivery Obligations", items: preview.deliveryObligations });
  }

  if (!scopingPreview && preview.reviewNotes.length > 0) {
    sections.push({ title: "## Review Notes", items: preview.reviewNotes });
  }

  return [
    ...sections.flatMap((section) => buildMarkdownSection(section.title, section.items)),
    "## Raw Intent",
    "",
    input.rawPrompt,
    ""
  ].join("\n");
}