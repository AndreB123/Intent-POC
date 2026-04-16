import path from "node:path";
import { promises as fs } from "node:fs";
import { BrowserContext, Page } from "playwright";
import { PNG } from "pngjs";
import { AppConfig, CaptureItemConfig } from "../config/schema";
import { hashBuffer } from "../compare/hash-image";
import { ensureDirectory } from "../shared/fs";
import { ResolvedSourceWorkspace } from "../target/resolve-target";

export interface CaptureOutcome {
  captureId: string;
  name?: string;
  path: string;
  url: string;
  kind: "page" | "locator";
  outputPath: string;
  relativeOutputPath: string;
  durationMs: number;
  viewport: { width: number; height: number };
  locator?: string;
  status: "captured" | "failed";
  hash?: string;
  width?: number;
  height?: number;
  error?: string;
  warnings: string[];
}

function buildMaskLocators(page: Page, item: CaptureItemConfig) {
  return item.maskSelectors.map((selector) => page.locator(selector));
}

function joinCssBlocks(config: AppConfig, workspace: ResolvedSourceWorkspace): string | undefined {
  const cssBlocks = [...workspace.source.capture.injectCss];

  if (config.playwright.disableAnimations) {
    cssBlocks.push(
      `*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }`
    );
  }

  return cssBlocks.length > 0 ? cssBlocks.join("\n") : undefined;
}

function resolveCaptureOutputPath(item: CaptureItemConfig, capturesDir: string): string {
  const relativePath = item.relativeOutputPath ?? `${item.id}.png`;

  if (path.isAbsolute(relativePath)) {
    throw new Error(`Capture output path for '${item.id}' must be relative.`);
  }

  const normalizedPath = path.normalize(relativePath);
  if (normalizedPath === ".." || normalizedPath.startsWith(`..${path.sep}`)) {
    throw new Error(`Capture output path for '${item.id}' cannot escape the capture root.`);
  }

  return path.join(capturesDir, normalizedPath);
}

export async function captureTarget(
  config: AppConfig,
  workspace: ResolvedSourceWorkspace,
  context: BrowserContext,
  item: CaptureItemConfig,
  capturesDir: string,
  controllerRoot: string
): Promise<CaptureOutcome> {
  const startedAt = Date.now();
  const page = await context.newPage();
  const outputPath = resolveCaptureOutputPath(item, capturesDir);
  const url = new URL(`${workspace.source.capture.basePathPrefix}${item.path}`, workspace.baseUrl).toString();
  const viewport = item.viewport ?? config.playwright.viewport;
  const captureAsLocator = Boolean(item.locator) && !(item.fullPage ?? workspace.source.capture.defaultFullPage);

  try {
    await ensureDirectory(path.dirname(outputPath));
    await page.goto(url, { waitUntil: "networkidle" });

    const css = joinCssBlocks(config, workspace);
    if (css) {
      await page.addStyleTag({ content: css });
    }

    if (item.waitForSelector) {
      await page.waitForSelector(item.waitForSelector);
    }

    if (workspace.source.capture.waitAfterLoadMs > 0) {
      await page.waitForTimeout(workspace.source.capture.waitAfterLoadMs);
    }

    if (item.delayMs > 0) {
      await page.waitForTimeout(item.delayMs);
    }

    const mask = buildMaskLocators(page, item);
    let screenshot: Buffer;

    if (captureAsLocator) {
      const locatorSelector = item.locator;
      if (!locatorSelector) {
        throw new Error(`Capture '${item.id}' is configured for locator capture without a locator selector.`);
      }

      const locator = page.locator(locatorSelector);
      await locator.waitFor();
      screenshot = await locator.screenshot({
        animations: config.playwright.disableAnimations ? "disabled" : "allow",
        mask
      });
    } else {
      screenshot = await page.screenshot({
        animations: config.playwright.disableAnimations ? "disabled" : "allow",
        fullPage: item.fullPage ?? workspace.source.capture.defaultFullPage,
        clip: item.clip,
        mask
      });
    }

    await fs.writeFile(outputPath, screenshot);
    const png = PNG.sync.read(screenshot);

    return {
      captureId: item.id,
      name: item.name,
      path: item.path,
      url,
      kind: captureAsLocator ? "locator" : "page",
      outputPath,
      relativeOutputPath: path.relative(capturesDir, outputPath),
      durationMs: Date.now() - startedAt,
      viewport,
      locator: captureAsLocator ? item.locator : undefined,
      status: "captured",
      hash: hashBuffer(screenshot),
      width: png.width,
      height: png.height,
      warnings: []
    };
  } catch (error) {
    return {
      captureId: item.id,
      name: item.name,
      path: item.path,
      url,
      kind: captureAsLocator ? "locator" : "page",
      outputPath,
      relativeOutputPath: path.relative(capturesDir, outputPath),
      durationMs: Date.now() - startedAt,
      viewport,
      locator: captureAsLocator ? item.locator : undefined,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      warnings: []
    };
  } finally {
    await page.close();
  }
}