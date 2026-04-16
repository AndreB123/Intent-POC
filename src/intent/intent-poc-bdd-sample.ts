import { ExecutionDestinationStatus, IntentType, NormalizedIntent, RepoContextStatus } from "./intent-types";

interface IntentPocBddSampleExpectation {
  intentType: IntentType;
  sourceId: string;
  summary: string;
  desiredOutcome: string;
  selectionReason: string;
  orchestrationStrategy: NormalizedIntent["executionPlan"]["orchestrationStrategy"];
  captureScope: NormalizedIntent["captureScope"];
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
  "Create a baseline screenshot library for the demo-catalog source.",
  "The plan must turn the request into acceptance-ready work for the built-in catalog experience.",
  "It should publish a reviewable evidence package for GitHub and documentation stakeholders.",
  "It needs to leave a visible business process gate for baseline review.",
  "Do this so that product and engineering leads can inspect the baseline without reading implementation details."
].join(" ");

const desiredOutcome = "product and engineering leads can inspect the baseline without reading implementation details";

const acceptanceCriteria = [
  "turn the request into acceptance-ready work for the built-in catalog experience",
  "publish a reviewable evidence package for GitHub and documentation stakeholders",
  "leave a visible business process gate for baseline review",
  desiredOutcome,
  "Intent is translated into executable work for demo-catalog.",
  "Evidence is captured and packaged for review.",
  `Results are packaged so they can be distributed consistently, with the desired outcome of: ${desiredOutcome}.`
];

const scenarioTitles = [
  "Intent is translated into acceptance-ready work",
  "Executable evidence is prepared for applicable sources",
  "Results are distributed consistently"
];

const workItemTitles = [...scenarioTitles, "Produce visible evidence for demo-catalog"];

const destinationStatuses: IntentPocBddSampleExpectation["destinationStatuses"] = [
  { label: "Controller artifacts", status: "active" },
  { label: "Linear parent issue", status: "planned" },
  { label: "Source workspace publication", status: "inactive" },
  { label: "GitHub workflow", status: "planned" },
  { label: "Documentation space", status: "planned" },
  { label: "Business process controls", status: "planned" }
];

const toolStates: IntentPocBddSampleExpectation["toolStates"] = [
  { label: "Linear-first scoping", enabled: true },
  { label: "BDD planning", enabled: true },
  { label: "Playwright TDD generation", enabled: true },
  { label: "Visual evidence capture", enabled: true },
  { label: "Environment deployment", enabled: false },
  { label: "Implementation loop", enabled: false },
  { label: "QA verification", enabled: false },
  { label: "Evidence reporting", enabled: true },
  { label: "Linear publishing", enabled: false }
];

export const INTENT_POC_BDD_SAMPLE = {
  id: "intent-poc-canonical-bdd-sample",
  title: "Intent POC canonical BDD sample",
  prompt,
  expected: {
    intentType: "capture-evidence",
    sourceId: "demo-catalog",
    summary: "capture evidence for demo-catalog",
    desiredOutcome,
    selectionReason: "Source demo-catalog was referenced directly in the prompt.",
    orchestrationStrategy: "single-source",
    captureScope: {
      mode: "all",
      captureIds: []
    },
    executionReviewNotes: [
      "Linear publishing is part of the plan, but it is inactive until config.linear.enabled is turned on."
    ],
    planningReviewNotes: [],
    repoCandidates: [{ repoId: "intent-poc", selectionStatus: "selected", sourceIds: ["demo-catalog"] }],
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
      "- Sources: demo-catalog",
      `- Given A business intent has been captured: ${prompt}`,
      "## TDD Work Items",
      "- Produce visible evidence for demo-catalog",
      "  - Playwright specs: 1",
      "  - Checkpoints: 3",
      "- Destinations: Controller artifacts [active], Linear parent issue [planned], Source workspace publication [inactive], GitHub workflow [planned], Documentation space [planned], Business process controls [planned]",
      "- Tools: Linear-first scoping [enabled], BDD planning [enabled], Playwright TDD generation [enabled], Visual evidence capture [enabled], Environment deployment [planned], Implementation loop [planned], QA verification [planned], Evidence reporting [enabled], Linear publishing [planned]"
    ]
  }
} satisfies IntentPocBddSampleContract;