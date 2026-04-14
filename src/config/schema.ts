import { z } from "zod";

const viewportSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive()
});

const clipSchema = z.object({
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  width: z.number().positive(),
  height: z.number().positive()
});

const localSourceSchema = z.object({
  type: z.literal("local"),
  localPath: z.string().min(1)
});

const gitSourceSchema = z.object({
  type: z.literal("git"),
  gitUrl: z.string().min(1),
  ref: z.string().min(1).default("main"),
  authTokenEnv: z.string().optional()
});

const readinessSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("http"),
    url: z.string().min(1).optional(),
    expectedStatus: z.number().int().positive().default(200),
    timeoutMs: z.number().int().positive().default(120_000),
    intervalMs: z.number().int().positive().default(2_000)
  }),
  z.object({
    type: z.literal("selector"),
    path: z.string().min(1),
    selector: z.string().min(1),
    timeoutMs: z.number().int().positive().default(120_000),
    intervalMs: z.number().int().positive().default(2_000)
  })
]);

const captureItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  path: z.string().min(1),
  relativeOutputPath: z.string().min(1).optional(),
  locator: z.string().optional(),
  waitForSelector: z.string().optional(),
  fullPage: z.boolean().optional(),
  viewport: viewportSchema.optional(),
  clip: clipSchema.optional(),
  maskSelectors: z.array(z.string()).default([]),
  delayMs: z.number().int().nonnegative().default(0)
});

const captureCatalogSchema = z.enum(["demo-surface-catalog"]);

const captureSchema = z
  .object({
    catalog: captureCatalogSchema.optional(),
    trackedRoot: z.string().min(1).optional(),
    basePathPrefix: z.string().default(""),
    waitAfterLoadMs: z.number().int().nonnegative().default(500),
    injectCss: z.array(z.string()).default([]),
    defaultFullPage: z.boolean().default(false),
    items: z.array(captureItemSchema).default([])
  })
  .superRefine((capture, context) => {
    if (!capture.catalog && capture.items.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one capture item or a built-in catalog is required.",
        path: ["items"]
      });
    }
  });

const sourcePlanningSchema = z.object({
  repoId: z.string().min(1).optional(),
  repoLabel: z.string().min(1).optional(),
  role: z.string().min(1).optional(),
  summary: z.string().min(1).optional(),
  notes: z.array(z.string()).default([])
});

const sourceStudioSchema = z.object({
  displayName: z.string().min(1).optional(),
  visible: z.boolean().default(true)
});

const sourceSchema = z.object({
  aliases: z.array(z.string()).default([]),
  source: z.discriminatedUnion("type", [localSourceSchema, gitSourceSchema]),
  planning: sourcePlanningSchema.default({}),
  studio: sourceStudioSchema.default({}),
  workspace: z.object({
    checkoutMode: z.enum(["existing", "clone-if-missing", "fresh-clone"]).default("existing"),
    cloneRoot: z.string().default("./.workdirs"),
    installCommand: z.string().optional(),
    installTimeoutMs: z.number().int().positive().default(600_000),
    env: z.record(z.string()).default({})
  }),
  app: z.object({
    workdir: z.string().default("."),
    startCommand: z.string().min(1),
    baseUrl: z.string().min(1),
    startTimeoutMs: z.number().int().positive().default(120_000),
    stopCommand: z.string().optional(),
    env: z.record(z.string()).default({}),
    readiness: readinessSchema
  }),
  capture: captureSchema
});

const sourceRecordSchema = z.record(z.string().min(1), sourceSchema);

const agentStageSchema = z.object({
  enabled: z.boolean().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  temperature: z.number().min(0).max(1).optional(),
  maxTokens: z.number().int().positive().optional(),
  apiKeyEnv: z.string().optional(),
  apiVersion: z.string().optional(),
  fallbackToRules: z.boolean().optional()
});

const artifactsSchema = z.object({
  storageMode: z.enum(["controller", "both"]).default("controller"),
  runRoot: z.string().min(1),
  libraryRoot: z.string().min(1).default("./artifacts/library"),
  baselineRoot: z.string().min(1),
  copyToSourcePath: z.string().optional(),
  writeMarkdownSummary: z.boolean().default(true),
  writeJsonSummary: z.boolean().default(true),
  retainRuns: z.number().int().positive().default(20),
  cleanBeforeRun: z.boolean().default(false)
});

const runSchema = z.object({
  sourceId: z.string().min(1),
  mode: z.enum(["baseline", "compare", "approve-baseline"]).default("compare"),
  intent: z.string().optional(),
  resumeIssue: z.string().min(1).optional(),
  trackedBaseline: z.boolean().default(false),
  captureIds: z.array(z.string()).default([]),
  continueOnCaptureError: z.boolean().default(false),
  allowBaselinePromotion: z.boolean().default(false),
  metadata: z.record(z.string()).default({}),
  dryRun: z.boolean().default(false)
});

export const configSchema = z
  .object({
    version: z.union([z.number().int().positive(), z.string().min(1)]),
    linear: z.object({
      enabled: z.boolean().default(true),
      apiKeyEnv: z.string().min(1).default("LINEAR_API_KEY"),
      teamId: z.string().min(1),
      projectId: z.string().min(1).optional(),
      labelIds: z.array(z.string()).default([]),
      createIssueOnStart: z.boolean().default(true),
      commentOnProgress: z.boolean().default(true),
      commentOnCompletion: z.boolean().default(true),
      defaultStateIds: z
        .object({
          started: z.string().optional(),
          completed: z.string().optional(),
          failed: z.string().optional()
        })
        .default({})
    }),
    agent: z.object({
      mode: z.literal("bounded-runner").default("bounded-runner"),
      provider: z.string().optional(),
      model: z.string().optional(),
      temperature: z.number().min(0).max(1).default(0.1),
      maxTokens: z.number().int().positive().optional(),
      apiKeyEnv: z.string().optional(),
      apiVersion: z.string().optional(),
      allowPromptNormalization: z.boolean().default(true),
      allowIntentPlanning: z.boolean().default(true),
      fallbackToRules: z.boolean().default(true),
      stages: z
        .object({
          promptNormalization: agentStageSchema.default({}),
          intentPlanning: agentStageSchema.default({})
        })
        .default({})
    }),
    sources: sourceRecordSchema,
    playwright: z.object({
      browser: z.enum(["chromium", "firefox", "webkit"]).default("chromium"),
      headless: z.boolean().default(true),
      viewport: viewportSchema.default({ width: 1440, height: 900 }),
      deviceScaleFactor: z.number().positive().default(1),
      locale: z.string().default("en-US"),
      timezoneId: z.string().default("UTC"),
      colorScheme: z.enum(["light", "dark", "no-preference"]).default("light"),
      disableAnimations: z.boolean().default(true),
      extraHTTPHeaders: z.record(z.string()).default({})
    }),
    artifacts: artifactsSchema,
    comparison: z.object({
      enabled: z.boolean().default(true),
      hashAlgorithm: z.literal("sha256").default("sha256"),
      diffMethod: z.literal("pixelmatch").default("pixelmatch"),
      pixelThreshold: z.number().min(0).max(1).default(0.01),
      failOnChange: z.boolean().default(false),
      onMissingBaseline: z.enum(["error", "bootstrap"]).default("error"),
      writeDiffImages: z.boolean().default(true)
    }),
    run: runSchema
  })
  .superRefine((config, context) => {
    if (Object.keys(config.sources).length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one source profile is required.",
        path: ["sources"]
      });
      return;
    }

    if (!config.sources[config.run.sourceId]) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `run.sourceId '${config.run.sourceId}' does not match a configured source.`,
        path: ["run", "sourceId"]
      });
    }
  });

export type AppConfig = z.infer<typeof configSchema>;
export type AgentConfig = AppConfig["agent"];
export type SourceConfig = AppConfig["sources"][string];
export type TargetConfig = SourceConfig;
export type CaptureItemConfig = SourceConfig["capture"]["items"][number];
export type CaptureCatalogName = z.infer<typeof captureCatalogSchema>;
export type RunMode = AppConfig["run"]["mode"];