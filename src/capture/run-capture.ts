import { BrowserContextOptions, chromium, firefox, webkit } from "playwright";
import { AppConfig, CaptureItemConfig } from "../config/schema";
import { log } from "../shared/log";
import { ResolvedSourceWorkspace } from "../target/resolve-target";
import { CaptureOutcome, captureTarget } from "./capture-target";

export interface CaptureRunResult {
  outcomes: CaptureOutcome[];
  abortedDueToError: boolean;
}

export interface CaptureRunHooks {
  onCaptureStarted?: (item: CaptureItemConfig) => void;
  onCaptureCompleted?: (outcome: CaptureOutcome) => void;
  onCaptureFailed?: (outcome: CaptureOutcome) => void;
}

function getBrowserType(browser: AppConfig["playwright"]["browser"]) {
  switch (browser) {
    case "firefox":
      return firefox;
    case "webkit":
      return webkit;
    case "chromium":
    default:
      return chromium;
  }
}

function buildContextOptions(config: AppConfig, item: CaptureItemConfig): BrowserContextOptions {
  return {
    viewport: item.viewport ?? config.playwright.viewport,
    deviceScaleFactor: config.playwright.deviceScaleFactor,
    locale: config.playwright.locale,
    timezoneId: config.playwright.timezoneId,
    colorScheme: config.playwright.colorScheme,
    reducedMotion: config.playwright.disableAnimations ? "reduce" : "no-preference",
    extraHTTPHeaders: config.playwright.extraHTTPHeaders
  };
}

export async function runCapture(
  config: AppConfig,
  workspace: ResolvedSourceWorkspace,
  captureItems: CaptureItemConfig[],
  capturesDir: string,
  controllerRoot: string,
  continueOnCaptureError: boolean,
  hooks: CaptureRunHooks = {}
): Promise<CaptureRunResult> {
  const browser = await getBrowserType(config.playwright.browser).launch({
    headless: config.playwright.headless
  });

  const outcomes: CaptureOutcome[] = [];
  let abortedDueToError = false;

  try {
    for (const item of captureItems) {
      hooks.onCaptureStarted?.(item);
      const context = await browser.newContext(buildContextOptions(config, item));
      try {
        const outcome = await captureTarget(config, workspace, context, item, capturesDir, controllerRoot);
        outcomes.push(outcome);

        if (outcome.status === "failed") {
          hooks.onCaptureFailed?.(outcome);
          log.warn(`Capture failed for '${item.id}'.`, { error: outcome.error });
          if (!continueOnCaptureError) {
            abortedDueToError = true;
            break;
          }
        } else {
          hooks.onCaptureCompleted?.(outcome);
          log.info(`Captured '${item.id}'.`, { outputPath: outcome.outputPath });
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  return { outcomes, abortedDueToError };
}