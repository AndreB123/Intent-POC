import { ExecutionDestinationStatus, IntentType, NormalizedIntent, RepoContextStatus } from "./intent-types";

interface IntentPocBddSampleExpectation {
  intentType: IntentType;
  sourceId: string;
  summary: string;
  desiredOutcome: string;
  selectionReason: string;
  orchestrationStrategy: NormalizedIntent["executionPlan"]["orchestrationStrategy"];
  captureScope: NormalizedIntent["captureScope"];
  uiStateRequirements: Array<{
    stateId: string;
    requestedValue?: string;
  }>;
  executionReviewNotes: string[];
  planningReviewNotes: string[];
  repoCandidates: Array<{
    repoId: string;
    selectionStatus: RepoContextStatus;
    sourceIds: string[];
  }>;
  acceptanceCriteria: string[];
  scenarioTitles: string[];
  workItemTitles: string[];
  destinationStatuses: Array<{
    label: string;
    status: ExecutionDestinationStatus;
  }>;
  toolStates: Array<{
    label: string;
    enabled: boolean;
  }>;
  businessSummaryFragments: string[];
}

export interface IntentPocBddSampleContract {
  id: string;
  title: string;
  prompt: string;
  expected: IntentPocBddSampleExpectation;
}

const prompt = [
  "Create a baseline screenshot library for the surface library source.",
  "The plan must turn the request into acceptance-ready work for the built-in surface library.",
  "The captured evidence should reflect dark mode during verification.",
  "It should publish a reviewable evidence package for GitHub and documentation stakeholders.",
  "It needs to leave a visible business process gate for baseline review.",
  "Do this so that product and engineering leads can inspect the baseline without reading implementation details."
].join(" ");

const desiredOutcome = "product and engineering leads can inspect the baseline without reading implementation details";

const acceptanceCriteria = [
  "turn the request into acceptance-ready work for the built-in surface library",
  "reflect dark mode during verification",
  "publish a reviewable evidence package for GitHub and documentation stakeholders",
  "leave a visible business process gate for baseline review",
  desiredOutcome,
  "Intent is translated into executable work for intent-poc-app.",
  "Evidence is captured and packaged for review.",
  `Results are packaged so they can be distributed consistently, with the desired outcome of: ${desiredOutcome}.`
];

const scenarioTitles = [
  "Intent is translated into acceptance-ready work",
  "Behavior is verified visually for applicable sources",
  "Results are distributed consistently"
];

const workItemTitles = ["Behavior is verified visually for applicable sources"];

const destinationStatuses: IntentPocBddSampleExpectation["destinationStatuses"] = [
  { label: "Controller artifacts", status: "active" },
  { label: "Source workspace publication", status: "inactive" },
  { label: "GitHub workflow", status: "planned" },
  { label: "Documentation space", status: "planned" },
  { label: "Business process controls", status: "planned" }
];

const toolStates: IntentPocBddSampleExpectation["toolStates"] = [
  { label: "BDD planning", enabled: true },
  { label: "Playwright TDD generation", enabled: true },
  { label: "Visual verification", enabled: true },
  { label: "Environment deployment", enabled: false },
  { label: "Implementation loop", enabled: false },
  { label: "QA verification", enabled: false },
  { label: "Evidence reporting", enabled: true }
];

export const INTENT_POC_BDD_SAMPLE = {
  id: "intent-poc-canonical-bdd-sample",
  title: "Intent POC canonical BDD sample",
  prompt,
  expected: {
    intentType: "change-behavior",
    sourceId: "intent-poc-app",
    summary: "change behavior for intent-poc-app",
    desiredOutcome,
    selectionReason: "Source intent-poc-app matched the prompt alias 'surface library'.",
    orchestrationStrategy: "single-source",
    captureScope: {
      mode: "subset",
      captureIds: ["library-index", "component-button-primary", "page-analytics-overview"]
    },
    uiStateRequirements: [{ stateId: "theme-mode", requestedValue: "dark" }],
    executionReviewNotes: [
      "Source intent-poc-app: The surface library supports a dark mode toggle that should be activated explicitly when requested.",
      "Source intent-poc-app: The toggle updates the surface library query state before screenshots are captured."
    ],
    planningReviewNotes: [],
    repoCandidates: [{ repoId: "intent-poc", selectionStatus: "selected", sourceIds: ["intent-poc-app"] }],
    acceptanceCriteria,
    scenarioTitles,
    workItemTitles,
    destinationStatuses,
    toolStates,
    businessSummaryFragments: [
      "# Intent POC Business Run Summary",
      `- Intent: ${prompt}`,
      "## Acceptance Criteria",
      `- ${acceptanceCriteria[0]}`,
      "## BDD Scenarios",
      `### ${scenarioTitles[0]}`,
      "- Sources: intent-poc-app",
      `- Given A business intent has been captured: ${prompt}`,
      "## IDD Decomposition",
      "### Objective: Create a baseline screenshot library for the surface library source. The plan must turn the request into acceptance-ready work for the built-in surface library. The captured evidence should reflect dark mode during verification. It should publish a reviewable evidence package for GitHub and documentation stakeholders. It needs to leave a visible business process gate for baseline review. Do this so that product and engineering leads can inspect the baseline without reading implementation details.",
      "#### Workstream: Source workstream: intent-poc-app",
      "##### Task: Behavior is verified visually for applicable sources",
      "###### Subtask: Behavior is verified visually for applicable sources",
      "## TDD Work Items",
      "- Behavior is verified visually for applicable sources",
      "  - Type: QA-runnable Playwright screenshot spec",
      "  - Outcome: QA can run a Playwright screenshot flow to verify behavior for intent-poc-app.",
      "  - Verification: QA can run a Playwright screenshot flow to verify behavior for intent-poc-app.",
      "  - Playwright specs: 1",
      "  - Checkpoints: 3",
      "- Destinations: Controller artifacts [active], Source workspace publication [inactive], GitHub workflow [planned], Documentation space [planned], Business process controls [planned]",
      "- Tools: BDD planning [enabled], Playwright TDD generation [enabled], Visual verification [enabled], Environment deployment [planned], Implementation loop [planned], QA verification [planned], Evidence reporting [enabled]"
    ]
  }
} satisfies IntentPocBddSampleContract;