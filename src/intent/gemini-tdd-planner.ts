import { z } from "zod";
import { ResolvedAgentStageConfig } from "./agent-stage-config";
import { createGeminiClient, runGeminiModelFailover } from "./gemini-client";
import { CodeSurfaceSelection } from "./code-surface";
import { PromptNormalizerSourceDescriptor } from "./gemini-prompt-normalizer";
import { buildGeminiSourceSummary } from "./gemini-source-summary";
import { TDDWorkItem, WorkItemVerificationMode } from "./intent-types";

const checkpointActionSchema = z.enum([
  "goto",
  "click",
  "fill",
  "assert-visible",
  "assert-hidden",
  "assert-below",
  "mock-studio-state",
  "assert-attribute-contains"
]);

const waitUntilSchema = z.enum(["load", "domcontentloaded", "networkidle"]);

const checkpointSchema = z.object({
  label: z.string().min(1),
  action: checkpointActionSchema,
  assertion: z.string().min(1),
  screenshotId: z.string().min(1),
  path: z.string().min(1).optional(),
  target: z.string().min(1).optional(),
  value: z.string().min(1).optional(),
  captureId: z.string().min(1).optional(),
  locator: z.string().min(1).optional(),
  referenceTarget: z.string().min(1).optional(),
  attributeName: z.string().min(1).optional(),
  expectedSubstring: z.string().min(1).optional(),
  waitForSelector: z.string().min(1).optional(),
  waitUntil: waitUntilSchema.optional(),
  mockStudioState: z.record(z.unknown()).optional()
});

const specSchema = z.object({
  sourceId: z.string().min(1),
  relativeSpecPath: z.string().min(1),
  suiteName: z.string().min(1),
  testName: z.string().min(1),
  scenarioIds: z.array(z.string().min(1)).optional(),
  checkpoints: z.array(checkpointSchema).min(1)
});

const verificationModeSchema = z.enum(["tracked-playwright", "mocked-state-playwright", "targeted-code-validation"]);

const workItemSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  verificationMode: verificationModeSchema,
  sourceIds: z.array(z.string().min(1)).min(1),
  scenarioIds: z.array(z.string().min(1)).optional(),
  userVisibleOutcome: z.string().min(1),
  verification: z.string().min(1),
  specs: z.array(specSchema)
});

export interface GeminiTddPlanningInput {
  rawPrompt: string;
  sourceIds: string[];
  availableSources: Record<string, PromptNormalizerSourceDescriptor>;
  codeSurface: CodeSurfaceSelection;
  desiredOutcome: string;
  acceptanceCriteria: Array<{
    description: string;
    origin: "prompt" | "inferred";
  }>;
  scenarios: Array<{
    id: string;
    title: string;
    goal: string;
    given: string[];
    when: string[];
    then: string[];
    applicableSourceIds: string[];
  }>;
  sourcePlans: Array<{
    sourceId: string;
    captureScope: {
      mode: "all" | "subset";
      captureIds: string[];
    };
    uiStateRequirements?: Array<{
      stateId: string;
      requestedValue?: string;
      label?: string;
      reason: string;
    }>;
  }>;
  draftWorkItems: Array<{
    title: string;
    description: string;
    verificationMode: WorkItemVerificationMode;
    sourceIds: string[];
    scenarioIds: string[];
    userVisibleOutcome: string;
    verification: string;
    specs: TDDWorkItem["playwright"]["specs"];
  }>;
  stage: ResolvedAgentStageConfig;
}

export interface GeminiTddPlanningRefinement {
  workItems: Array<z.infer<typeof workItemSchema>>;
  warnings?: string[];
}

const refinementSchema: z.ZodType<GeminiTddPlanningRefinement> = z.object({
  workItems: z.array(workItemSchema).min(1),
  warnings: z.array(z.string().min(1)).optional()
});

const tddPlanningResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["workItems"],
  properties: {
    workItems: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "title",
          "description",
          "verificationMode",
          "sourceIds",
          "userVisibleOutcome",
          "verification",
          "specs"
        ],
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          verificationMode: {
            type: "string",
            enum: ["tracked-playwright", "mocked-state-playwright", "targeted-code-validation"]
          },
          sourceIds: {
            type: "array",
            minItems: 1,
            items: { type: "string" }
          },
          scenarioIds: {
            type: "array",
            items: { type: "string" }
          },
          userVisibleOutcome: { type: "string" },
          verification: { type: "string" },
          specs: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["sourceId", "relativeSpecPath", "suiteName", "testName", "checkpoints"],
              properties: {
                sourceId: { type: "string" },
                relativeSpecPath: { type: "string" },
                suiteName: { type: "string" },
                testName: { type: "string" },
                scenarioIds: {
                  type: "array",
                  items: { type: "string" }
                },
                checkpoints: {
                  type: "array",
                  minItems: 1,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["label", "action", "assertion", "screenshotId"],
                    properties: {
                      label: { type: "string" },
                      action: {
                        type: "string",
                        enum: [
                          "goto",
                          "click",
                          "fill",
                          "assert-visible",
                          "assert-hidden",
                          "assert-below",
                          "mock-studio-state",
                          "assert-attribute-contains"
                        ]
                      },
                      assertion: { type: "string" },
                      screenshotId: { type: "string" },
                      path: { type: "string" },
                      target: { type: "string" },
                      value: { type: "string" },
                      captureId: { type: "string" },
                      locator: { type: "string" },
                      referenceTarget: { type: "string" },
                      attributeName: { type: "string" },
                      expectedSubstring: { type: "string" },
                      waitForSelector: { type: "string" },
                      waitUntil: {
                        type: "string",
                        enum: ["load", "domcontentloaded", "networkidle"]
                      },
                      mockStudioState: {
                        type: "object"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    warnings: {
      type: "array",
      items: { type: "string" }
    }
  }
} as const;

function buildTddPlanningPrompt(input: GeminiTddPlanningInput): string {
  const isIntentStudioRunIndicatorFlow = input.codeSurface.id === "intent-studio"
    && /(visual test run indicator|test run indicator|run status|test status|qa status|verification status|tests are run)/i.test(
      [input.rawPrompt, input.desiredOutcome].join(" ")
    );

  return [
    "You are generating the final Playwright-first TDD artifacts for an AI-first intent workflow.",
    "Return only JSON that matches the provided schema.",
    "You must author the final verification artifact content. The system will only validate ids, bounds, and persistence.",
    "Do not invent source ids outside the provided source scope.",
    "Use only the provided source ids, scenario ids, and capture ids when you reference them.",
    "Each Playwright spec path must stay relative to the configured output root and should normally look like '<sourceId>/<slug>.spec.ts'.",
    "Every non-code-validation work item must include at least one Playwright spec with concrete checkpoints.",
    "Mocked-state lifecycle verification is allowed when the behavior needs Studio lifecycle state or run-state rendering.",
    ...(isIntentStudioRunIndicatorFlow
      ? [
          "For Intent Studio run-indicator workflows, do not use 'mocked-state-playwright' or 'mock-studio-state'.",
          "Use live 'tracked-playwright' verification against the running Studio and assert the real indicator state from the active session.",
          "Intent Studio keeps a live event stream open, so Studio goto checkpoints must not wait for 'networkidle'; prefer 'domcontentloaded' unless a stronger route-specific wait is required.",
          "Before clicking the Intent Studio submit control, fill '#prompt-input' with a non-empty prompt because the real 'Run intent' button stays disabled until prompt text is present.",
          "Intent Studio uses a reviewed-draft gate: the first Run intent click generates the scoping draft, then execution starts only after the next Run intent click approves that reviewed draft. Model that real two-step flow in your checkpoints.",
          "Stable Intent Studio selector contracts currently include '#submit-button' and '[data-testid=\"run-tests-button\"]' for the same submit control, '[data-testid=\"test-status-indicator\"]', '#current-status-pill', '#prompt-input', and '#dark-mode-toggle'. Reuse them instead of inventing new selectors.",
          "When verifying the live Intent Studio run indicator state code, assert a running-stage code that contains 'RUNNING'; live runs can surface 'IMPLEMENTATION_RUNNING' before 'QA_GENERATED_PLAYWRIGHT_RUNNING'."
        ]
      : []),
    "Prefer executable, bounded verification over placeholder checks.",
    `Code surface: ${input.codeSurface.label} (${input.codeSurface.id})`,
    `Desired outcome: ${input.desiredOutcome}`,
    `Selected source ids: ${input.sourceIds.join(", ")}`,
    "Available sources:",
    buildGeminiSourceSummary(input.availableSources),
    "Acceptance criteria:",
    JSON.stringify(input.acceptanceCriteria, null, 2),
    "Scenarios:",
    JSON.stringify(input.scenarios, null, 2),
    "Source execution context:",
    JSON.stringify(input.sourcePlans, null, 2),
    "Current deterministic draft work items for reference only. Rewrite them as needed; they are not authoritative output:",
    JSON.stringify(input.draftWorkItems, null, 2),
    "User prompt:",
    input.rawPrompt
  ].join("\n\n");
}

export async function refineIntentTddWithGemini(
  input: GeminiTddPlanningInput
): Promise<GeminiTddPlanningRefinement> {
  const ai = createGeminiClient({
    apiKeyEnv: input.stage.apiKeyEnv,
    apiVersion: input.stage.apiVersion
  });

  const failoverResult = await runGeminiModelFailover({
    contextLabel: "Gemini TDD planning",
    primaryModel: input.stage.model,
    modelFailover: input.stage.modelFailover,
    invoke: async (model) =>
      ai.models.generateContent({
        model,
        contents: buildTddPlanningPrompt(input),
        config: {
          temperature: input.stage.temperature,
          maxOutputTokens: input.stage.maxTokens,
          responseMimeType: "application/json",
          responseJsonSchema: tddPlanningResponseJsonSchema
        }
      })
  });

  const response = failoverResult.value;

  const text = response.text?.trim();
  if (!text) {
    throw new Error("Gemini TDD planning returned an empty response.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Gemini TDD planning returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  const refinement = refinementSchema.parse(parsed);
  if (failoverResult.selectedModel === input.stage.model) {
    return refinement;
  }

  const failoverWarning = `Gemini TDD planning used failover model '${failoverResult.selectedModel}' after transient provider saturation on ${failoverResult.failedAttempts.map((attempt) => `'${attempt.model}'`).join(", ")}.`;

  return {
    ...refinement,
    warnings: [...(refinement.warnings ?? []), failoverWarning]
  };
}