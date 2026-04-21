import path from "node:path";
import { NormalizedIntent, PlaywrightCheckpoint, PlaywrightSpecArtifact } from "../intent/intent-types";
import { ensureDirectory, sanitizeFileSegment, writeTextFile } from "../shared/fs";
import { ResolvedSourceWorkspace } from "../target/resolve-target";

export interface GeneratedPlaywrightSpecBundle {
  outputDir: string;
  sourceDir: string;
  files: string[];
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function sanitizeOutputFileName(input: string, fallback: string): string {
  return `${sanitizeFileSegment(input) || fallback}.png`;
}

function stripLegacyScreenshotPrefix(value: string): string {
  return value.replace(/^shot-\d+-/, "").replace(/^checkpoint-\d+-/, "");
}

function inferScreenshotCategory(spec: PlaywrightSpecArtifact): "components" | "views" | "pages" | "bdd" | "userflows" {
  const checkpointCaptureIds = spec.checkpoints
    .map((checkpoint) => checkpoint.captureId?.toLowerCase() ?? "")
    .filter((value) => value.length > 0);

  if (checkpointCaptureIds.length > 0 && checkpointCaptureIds.every((value) => value.startsWith("component-"))) {
    return "components";
  }

  if (checkpointCaptureIds.length > 0 && checkpointCaptureIds.every((value) => value.startsWith("view-"))) {
    return "views";
  }

  if (checkpointCaptureIds.length > 0 && checkpointCaptureIds.every((value) => value.startsWith("page-"))) {
    return "pages";
  }

  return spec.scenarioIds.length > 0 ? "bdd" : "userflows";
}

function buildSpecScreenshotDirectory(spec: PlaywrightSpecArtifact): string {
  const parsed = path.parse(spec.relativeSpecPath);
  return sanitizeFileSegment(parsed.name) || sanitizeFileSegment(spec.testName) || "generated-spec";
}

function buildCheckpointScreenshotStemCandidates(checkpoint: PlaywrightCheckpoint): string[] {
  const labelSegment = sanitizeFileSegment(checkpoint.label);
  const captureSegment = sanitizeFileSegment(checkpoint.captureId ?? "");
  const targetSegment = sanitizeFileSegment(checkpoint.target ?? checkpoint.locator ?? checkpoint.referenceTarget ?? "");
  const attributeSegment = sanitizeFileSegment(checkpoint.attributeName ?? "");
  const expectedSubstringSegment = sanitizeFileSegment(checkpoint.expectedSubstring ?? "");
  const screenshotSegment = sanitizeFileSegment(stripLegacyScreenshotPrefix(checkpoint.screenshotId));
  const idSegment = sanitizeFileSegment(checkpoint.id.replace(/^checkpoint-/, ""));
  const candidates = [
    labelSegment,
    captureSegment && labelSegment && !labelSegment.includes(captureSegment) ? `${captureSegment}-${labelSegment}` : "",
    labelSegment && targetSegment && !labelSegment.includes(targetSegment) ? `${labelSegment}-${targetSegment}` : "",
    labelSegment && attributeSegment && !labelSegment.includes(attributeSegment) ? `${labelSegment}-${attributeSegment}` : "",
    labelSegment && expectedSubstringSegment && !labelSegment.includes(expectedSubstringSegment)
      ? `${labelSegment}-${expectedSubstringSegment}`
      : "",
    screenshotSegment,
    captureSegment,
    targetSegment,
    idSegment
  ];

  return Array.from(new Set(candidates.filter((candidate) => candidate.length > 0)));
}

function buildCheckpointScreenshotStems(spec: PlaywrightSpecArtifact): string[] {
  const usedStems = new Set<string>();

  return spec.checkpoints.map((checkpoint, index) => {
    const candidates = buildCheckpointScreenshotStemCandidates(checkpoint);

    for (const candidate of candidates) {
      if (!usedStems.has(candidate)) {
        usedStems.add(candidate);
        return candidate;
      }
    }

    const fallbackBase = sanitizeFileSegment(stripLegacyScreenshotPrefix(checkpoint.screenshotId))
      || sanitizeFileSegment(checkpoint.id)
      || sanitizeFileSegment(checkpoint.action)
      || `checkpoint-${index + 1}`;
    let uniqueStem = fallbackBase;
    let collisionIndex = 2;

    while (usedStems.has(uniqueStem)) {
      uniqueStem = `${fallbackBase}-${collisionIndex}`;
      collisionIndex += 1;
    }

    usedStems.add(uniqueStem);
    return uniqueStem;
  });
}

function collectRequiredUiStates(spec: PlaywrightSpecArtifact): NonNullable<PlaywrightSpecArtifact["requiredUiStates"]> {
  const requirements = [
    ...(spec.requiredUiStates ?? []),
    ...spec.checkpoints.flatMap((checkpoint) => checkpoint.requiredUiStates ?? [])
  ];
  const dedupedRequirements = new Map<string, (typeof requirements)[number]>();

  for (const requirement of requirements) {
    const dedupeKey = `${requirement.stateId}:${requirement.requestedValue ?? ""}`;
    if (!dedupedRequirements.has(dedupeKey)) {
      dedupedRequirements.set(dedupeKey, requirement);
    }
  }

  return Array.from(dedupedRequirements.values());
}

function supportsPairedThemeEvidence(
  requirements: NonNullable<PlaywrightSpecArtifact["requiredUiStates"]>
): boolean {
  return requirements.some((requirement) => requirement.stateId === "theme-mode" && requirement.requestedValue === "dark");
}

function buildCheckpointLines(
  checkpoint: PlaywrightCheckpoint,
  screenshotName: string,
  screenshotDirectory: string,
  input: {
    hasRequiredUiStates: boolean;
    uiStateVariableName?: string;
    labelSuffix?: string;
  }
): string[] {
  const screenshotPathExpression = `path.join(screenshotRoot, ${quote(screenshotDirectory)}, ${quote(screenshotName)})`;
  const stepLabel = input.labelSuffix ? `${checkpoint.label} (${input.labelSuffix})` : checkpoint.label;
  const uiStateVariableName = input.uiStateVariableName ?? "requiredUiStates";
  const lines = [
    `    await test.step(${quote(stepLabel)}, async () => {`
  ];
  const urlExpression = input.hasRequiredUiStates
    ? `buildUrlWithUiStates(${quote(checkpoint.path ?? "/")}, ${uiStateVariableName})`
    : `new URL(${quote(checkpoint.path ?? "/")}, baseUrl).toString()`;

  if (checkpoint.action === "mock-studio-state") {
    lines.push(
      `      await page.route("**/api/state", async (route) => {`,
      `        await route.fulfill({`,
      `          status: 200,`,
      `          contentType: "application/json; charset=utf-8",`,
      `          body: ${quote(JSON.stringify(checkpoint.mockStudioState ?? {}))}`, 
      `        });`,
      `      });`,
      `      await page.route("**/api/events", async (route) => {`,
      `        await route.fulfill({`,
      `          status: 200,`,
      `          contentType: "text/event-stream",`,
      `          body: ""`,
      `        });`,
      `      });`
    );

    if (checkpoint.path) {
      lines.push(
        `      await page.goto(${input.hasRequiredUiStates ? `buildUrlWithUiStates(${quote(checkpoint.path)}, ${uiStateVariableName})` : `new URL(${quote(checkpoint.path)}, baseUrl).toString()`}, { waitUntil: ${quote(checkpoint.waitUntil ?? "domcontentloaded")} });`
      );
    }

    if (checkpoint.waitForSelector) {
      lines.push(`      await page.waitForSelector(${quote(checkpoint.waitForSelector)});`);
    }

    if (input.hasRequiredUiStates && checkpoint.path) {
      lines.push(`      await applyUiStateRequirements(page, ${uiStateVariableName});`);
    }

    lines.push(`      const screenshotPath = ${screenshotPathExpression};`);
    lines.push("      await mkdir(path.dirname(screenshotPath), { recursive: true });");
    lines.push("      await page.screenshot({ path: screenshotPath, fullPage: true });");
    lines.push(`    });`);
    return lines;
  }

  if (checkpoint.action === "goto") {
    lines.push(
      `      await page.goto(${urlExpression}, { waitUntil: ${quote(checkpoint.waitUntil ?? "networkidle")} });`
    );
  }

  if (checkpoint.waitForSelector) {
    if (checkpoint.action === "assert-hidden") {
      lines.push(`      await page.waitForSelector(${quote(checkpoint.waitForSelector)}, { state: "hidden" });`);
    } else {
      lines.push(`      await page.waitForSelector(${quote(checkpoint.waitForSelector)});`);
    }
  }

  if (input.hasRequiredUiStates && checkpoint.action === "goto") {
    lines.push(`      await applyUiStateRequirements(page, ${uiStateVariableName});`);
  }

  if (checkpoint.action === "assert-below") {
    lines.push(
      `      await assertLocatorBelow(page, ${quote(checkpoint.target ?? "body")}, ${quote(checkpoint.referenceTarget ?? "body")}, ${quote(checkpoint.assertion)});`
    );
    lines.push(`      const screenshotPath = ${screenshotPathExpression};`);
    lines.push("      await mkdir(path.dirname(screenshotPath), { recursive: true });");
    lines.push("      await page.screenshot({ path: screenshotPath, fullPage: true });");
    lines.push(`    });`);
    return lines;
  }

  if (checkpoint.action === "assert-attribute-contains") {
    lines.push(`      const target = page.locator(${quote(checkpoint.target ?? checkpoint.locator ?? "body")}).first();`);
    lines.push(`      await expect(target, ${quote(checkpoint.assertion)}).toBeVisible();`);
    lines.push(`      const attributeValue = await target.getAttribute(${quote(checkpoint.attributeName ?? "href")});`);
    lines.push(`      expect(attributeValue, ${quote(checkpoint.assertion)}).toBeTruthy();`);
    lines.push(`      expect(attributeValue ?? "", ${quote(checkpoint.assertion)}).toContain(${quote(checkpoint.expectedSubstring ?? "")});`);
    lines.push(`      const screenshotPath = ${screenshotPathExpression};`);
    lines.push("      await mkdir(path.dirname(screenshotPath), { recursive: true });");
    lines.push("      await page.screenshot({ path: screenshotPath, fullPage: true });");
    lines.push(`    });`);
    return lines;
  }

  if (
    checkpoint.action === "click" ||
    checkpoint.action === "fill" ||
    checkpoint.action === "assert-visible" ||
    checkpoint.action === "assert-hidden"
  ) {
    lines.push(`      const target = page.locator(${quote(checkpoint.target ?? checkpoint.locator ?? "body")});`);
    if (checkpoint.action === "assert-hidden") {
      lines.push(`      await expect(target, ${quote(checkpoint.assertion)}).toBeHidden();`);
    } else {
      lines.push(`      await expect(target, ${quote(checkpoint.assertion)}).toBeVisible();`);
    }

    if (checkpoint.action === "click") {
      lines.push(`      await target.click();`);
    }

    if (checkpoint.action === "fill") {
      lines.push(`      await target.fill(${quote(checkpoint.value ?? "")});`);
    }

    lines.push(`      const screenshotPath = ${screenshotPathExpression};`);
    lines.push("      await mkdir(path.dirname(screenshotPath), { recursive: true });");
    lines.push("      await page.screenshot({ path: screenshotPath, fullPage: true });");
    lines.push(`    });`);
    return lines;
  }

  if (checkpoint.locator) {
    lines.push(`      const target = page.locator(${quote(checkpoint.locator)});`);
    lines.push(`      await expect(target, ${quote(checkpoint.assertion)}).toBeVisible();`);
    lines.push(`      const screenshotPath = ${screenshotPathExpression};`);
    lines.push("      await mkdir(path.dirname(screenshotPath), { recursive: true });");
    lines.push("      await target.screenshot({ path: screenshotPath });");
    lines.push(`    });`);
    return lines;
  }

  lines.push(`      await expect(page.locator("body"), ${quote(checkpoint.assertion)}).toBeVisible();`);
  lines.push(`      const screenshotPath = ${screenshotPathExpression};`);
  lines.push("      await mkdir(path.dirname(screenshotPath), { recursive: true });");
  lines.push("      await page.screenshot({ path: screenshotPath, fullPage: true });");
  lines.push(`    });`);
  return lines;
}

function buildSpecFile(spec: PlaywrightSpecArtifact, baseUrl: string, screenshotRoot: string): string {
  const screenshotCategory = inferScreenshotCategory(spec);
  const screenshotDirectory = path.join(screenshotCategory, buildSpecScreenshotDirectory(spec));
  const checkpointScreenshotStems = buildCheckpointScreenshotStems(spec);
  const usesBelowAssertion = spec.checkpoints.some((checkpoint) => checkpoint.action === "assert-below");
  const requiredUiStates = collectRequiredUiStates(spec);
  const usesUiStateRequirements = requiredUiStates.length > 0;
  const usesPairedThemeEvidence = usesUiStateRequirements && supportsPairedThemeEvidence(requiredUiStates);
  const lines = [
    'import { mkdir } from "node:fs/promises";',
    'import path from "node:path";',
    usesBelowAssertion || usesUiStateRequirements
      ? "import { expect, test, type Page } from \"playwright/test\";"
      : "import { expect, test } from \"playwright/test\";",
    "",
    "// Generated by Intent POC. The source-scoped screenshot subtree is overwritten in place when this tracked spec is regenerated.",
    `const baseUrl = process.env.INTENT_POC_BASE_URL ?? ${quote(baseUrl)};`,
    `const screenshotRoot = process.env.INTENT_POC_E2E_SCREENSHOT_ROOT ?? ${quote(screenshotRoot)};`,
    "",
    ...(usesUiStateRequirements ? [`const requiredUiStates = ${JSON.stringify(requiredUiStates, null, 2)} as const;`, ""] : []),
    ...(usesPairedThemeEvidence
      ? [
          "function buildOverriddenUiStateRequirements(",
          "  requirements: typeof requiredUiStates,",
          '  overrides: Partial<Record<(typeof requiredUiStates)[number]["stateId"], string>>',
          "): typeof requiredUiStates {",
          "  return requirements.map((requirement) => ({",
          "    ...requirement,",
          "    requestedValue: overrides[requirement.stateId] ?? requirement.requestedValue",
          "  })) as typeof requiredUiStates;",
          "}",
          "",
          'const lightModeUiStates = buildOverriddenUiStateRequirements(requiredUiStates, { "theme-mode": "light" });',
          ""
        ]
      : []),
    ...(usesUiStateRequirements
      ? [
          "function buildUrlWithUiStates(routePath: string, requirements: typeof requiredUiStates): string {",
          "  const url = new URL(routePath, baseUrl);",
          "  for (const requirement of requirements) {",
          "    if (!requirement.requestedValue) {",
          "      continue;",
          "    }",
          "",
          "    for (const activation of requirement.activation) {",
          "      if (activation.type !== \"query-param\" || !activation.target) {",
          "        continue;",
          "      }",
          "",
          "      const activationValue = activation.values[requirement.requestedValue];",
          "      if (typeof activationValue === \"string\" && activationValue.length > 0) {",
          "        url.searchParams.set(activation.target, activationValue);",
          "      }",
          "    }",
          "  }",
          "",
          "  return url.toString();",
          "}",
          "",
          "function isUiStateRouteSatisfied(page: Page, requirement: (typeof requiredUiStates)[number]): boolean {",
          "  const currentUrl = new URL(page.url());",
          "  for (const activation of requirement.activation) {",
          "    if (activation.type !== \"query-param\" || !activation.target) {",
          "      continue;",
          "    }",
          "",
          "    const activationValue = activation.values[requirement.requestedValue];",
          "    if (typeof activationValue !== \"string\" || activationValue.length === 0) {",
          "      continue;",
          "    }",
          "",
          "    if (currentUrl.searchParams.get(activation.target) === activationValue) {",
          "      return true;",
          "    }",
          "  }",
          "",
          "  return false;",
          "}",
          "",
          "async function applyUiStateRequirements(page: Page, requirements: typeof requiredUiStates): Promise<void> {",
          "  for (const requirement of requirements) {",
          "    if (!requirement.requestedValue) {",
          "      continue;",
          "    }",
          "",
          "    if (isUiStateRouteSatisfied(page, requirement)) {",
          "      continue;",
          "    }",
          "",
          "    for (const activation of requirement.activation) {",
          "      if (activation.type !== \"ui-control\" || !activation.target) {",
          "        continue;",
          "      }",
          "",
          "      const activationValue = activation.values[requirement.requestedValue];",
          "      if (!activationValue || !/^(true|1|on|enabled|active)$/i.test(activationValue)) {",
          "        continue;",
          "      }",
          "",
          "      const control = page.locator(activation.target).first();",
          "      if ((await control.count()) === 0) {",
          "        continue;",
          "      }",
          "",
          "      await expect(control, `${requirement.label ?? requirement.stateId} control should be visible before activation.`).toBeVisible();",
          "      const urlBeforeActivation = page.url();",
          "      await control.click();",
          "      if (page.url() !== urlBeforeActivation) {",
          "        await page.waitForLoadState(\"load\");",
          "      }",
          "      break;",
          "    }",
          "  }",
          "}",
          ""
        ]
      : []),
    ...(usesBelowAssertion
      ? [
          "async function assertLocatorBelow(page: Page, targetSelector: string, referenceSelector: string, message: string): Promise<void> {",
          "  const target = page.locator(targetSelector);",
          "  const reference = page.locator(referenceSelector);",
          "  await expect(target, message).toBeVisible();",
          "  await expect(reference, message).toBeVisible();",
          "  const [targetBox, referenceBox] = await Promise.all([target.boundingBox(), reference.boundingBox()]);",
          "  if (!targetBox || !referenceBox) {",
          "    throw new Error(message);",
          "  }",
          "",
          "  expect(targetBox.y, message).toBeGreaterThanOrEqual(referenceBox.y + referenceBox.height - 1);",
          "}",
          ""
        ]
      : []),
    `test.describe(${quote(spec.suiteName)}, () => {`,
    `  test(${quote(spec.testName)}, async ({ page }) => {`
  ];

  const checkpointVariants = usesPairedThemeEvidence
    ? [
        {
          labelSuffix: "Light Mode",
          screenshotSuffix: "-light",
          uiStateVariableName: "lightModeUiStates"
        },
        {
          labelSuffix: "Dark Mode",
          screenshotSuffix: "-dark",
          uiStateVariableName: "requiredUiStates"
        }
      ]
    : [
        {
          labelSuffix: "",
          screenshotSuffix: "",
          uiStateVariableName: "requiredUiStates"
        }
      ];

  for (const variant of checkpointVariants) {
    for (const [index, checkpoint] of spec.checkpoints.entries()) {
      const checkpointScreenshotStem = checkpointScreenshotStems[index]
        ?? sanitizeFileSegment(stripLegacyScreenshotPrefix(checkpoint.screenshotId))
        ?? sanitizeFileSegment(checkpoint.id)
        ?? `checkpoint-${index + 1}`;
      const screenshotName = sanitizeOutputFileName(
        `${checkpointScreenshotStem}${variant.screenshotSuffix}`,
        `${checkpointScreenshotStem}${variant.screenshotSuffix}`
      );

      lines.push(
        ...buildCheckpointLines(checkpoint, screenshotName, screenshotDirectory, {
          hasRequiredUiStates: usesUiStateRequirements,
          uiStateVariableName: variant.uiStateVariableName,
          labelSuffix: variant.labelSuffix
        })
      );
    }
  }

  lines.push("  });");
  lines.push("});");
  lines.push("");
  return lines.join("\n");
}

function resolveSpecOutputPath(outputDir: string, relativeSpecPath: string): string {
  if (path.isAbsolute(relativeSpecPath)) {
    throw new Error(`Generated Playwright spec path must be relative: ${relativeSpecPath}`);
  }

  const normalizedRelativePath = path.normalize(relativeSpecPath);
  if (normalizedRelativePath === ".." || normalizedRelativePath.startsWith(`..${path.sep}`)) {
    throw new Error(`Generated Playwright spec path cannot escape the configured output root: ${relativeSpecPath}`);
  }

  return path.join(outputDir, normalizedRelativePath);
}

function collectSourceSpecs(normalizedIntent: NormalizedIntent, sourceId: string): PlaywrightSpecArtifact[] {
  const specsByPath = new Map<string, PlaywrightSpecArtifact>();

  for (const workItem of normalizedIntent.businessIntent.workItems) {
    for (const spec of workItem.playwright.specs) {
      if (spec.sourceId !== sourceId) {
        continue;
      }

      if (!specsByPath.has(spec.relativeSpecPath)) {
        specsByPath.set(spec.relativeSpecPath, spec);
      }
    }
  }

  return Array.from(specsByPath.values()).sort((left, right) => left.relativeSpecPath.localeCompare(right.relativeSpecPath));
}

export async function writeGeneratedPlaywrightTests(input: {
  workspace: ResolvedSourceWorkspace;
  normalizedIntent: NormalizedIntent;
  sourceId: string;
}): Promise<GeneratedPlaywrightSpecBundle | null> {
  if (!input.workspace.source.testing.playwright.enabled) {
    return null;
  }

  const specs = collectSourceSpecs(input.normalizedIntent, input.sourceId);
  if (specs.length === 0) {
    return null;
  }

  const outputDir = path.resolve(input.workspace.rootDir, input.workspace.source.testing.playwright.outputDir);
  const sourceDir = path.join(outputDir, sanitizeFileSegment(input.sourceId) || input.sourceId);
  const screenshotRoot = path.resolve(input.workspace.rootDir, "artifacts", "library", sanitizeFileSegment(input.sourceId) || input.sourceId);

  await ensureDirectory(sourceDir);

  const files: string[] = [];

  for (const spec of specs) {
    const outputPath = resolveSpecOutputPath(outputDir, spec.relativeSpecPath);
    await ensureDirectory(path.dirname(outputPath));
    await writeTextFile(outputPath, buildSpecFile(spec, input.workspace.source.app.baseUrl, screenshotRoot));
    files.push(outputPath);
  }

  return {
    outputDir,
    sourceDir,
    files
  };
}