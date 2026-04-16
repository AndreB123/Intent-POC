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
  const relativeWithoutExtension = path.join(parsed.dir, parsed.name);
  const normalized = relativeWithoutExtension.replace(/\\/g, "/");
  return sanitizeFileSegment(normalized) || sanitizeFileSegment(spec.testName) || "generated-spec";
}

function buildCheckpointLines(checkpoint: PlaywrightCheckpoint, index: number, screenshotDirectory: string): string[] {
  const screenshotName = sanitizeOutputFileName(checkpoint.screenshotId, `checkpoint-${index + 1}`);
  const screenshotPathExpression = `path.join(screenshotRoot, ${quote(screenshotDirectory)}, ${quote(screenshotName)})`;
  const lines = [
    `    await test.step(${quote(checkpoint.label)}, async () => {`
  ];

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
        `      await page.goto(new URL(${quote(checkpoint.path)}, baseUrl).toString(), { waitUntil: ${quote(checkpoint.waitUntil ?? "domcontentloaded")} });`
      );
    }

    if (checkpoint.waitForSelector) {
      lines.push(`      await page.waitForSelector(${quote(checkpoint.waitForSelector)});`);
    }

    lines.push(`      const screenshotPath = ${screenshotPathExpression};`);
    lines.push("      await mkdir(path.dirname(screenshotPath), { recursive: true });");
    lines.push("      await page.screenshot({ path: screenshotPath, fullPage: true });");
    lines.push(`    });`);
    return lines;
  }

  if (checkpoint.action === "goto") {
    lines.push(
      `      await page.goto(new URL(${quote(checkpoint.path ?? "/")}, baseUrl).toString(), { waitUntil: ${quote(checkpoint.waitUntil ?? "networkidle")} });`
    );
  }

  if (checkpoint.waitForSelector) {
    if (checkpoint.action === "assert-hidden") {
      lines.push(`      await page.waitForSelector(${quote(checkpoint.waitForSelector)}, { state: "hidden" });`);
    } else {
      lines.push(`      await page.waitForSelector(${quote(checkpoint.waitForSelector)});`);
    }
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
  const usesBelowAssertion = spec.checkpoints.some((checkpoint) => checkpoint.action === "assert-below");
  const lines = [
    'import { mkdir } from "node:fs/promises";',
    'import path from "node:path";',
    usesBelowAssertion
      ? "import { expect, test, type Page } from \"playwright/test\";"
      : "import { expect, test } from \"playwright/test\";",
    "",
    "// Generated by Intent POC. This tracked Playwright spec is regenerated in place when the same intent path is requested.",
    `const baseUrl = process.env.INTENT_POC_BASE_URL ?? ${quote(baseUrl)};`,
    `const screenshotRoot = process.env.INTENT_POC_E2E_SCREENSHOT_ROOT ?? ${quote(screenshotRoot)};`,
    "",
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

  for (const [index, checkpoint] of spec.checkpoints.entries()) {
    lines.push(...buildCheckpointLines(checkpoint, index, screenshotDirectory));
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
  const screenshotRoot = path.resolve(input.workspace.rootDir, "artifacts", "library");

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