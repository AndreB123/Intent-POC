import { chromium, firefox, webkit } from "playwright";
import { AppConfig } from "../config/schema";
import { ResolvedSourceWorkspace } from "../target/resolve-target";

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
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

export async function waitForReady(
  config: AppConfig,
  workspace: ResolvedSourceWorkspace
): Promise<void> {
  const readiness = workspace.source.app.readiness;
  const startedAt = Date.now();

  if (readiness.type === "http") {
    const url = readiness.url ?? workspace.baseUrl;
    while (Date.now() - startedAt < readiness.timeoutMs) {
      try {
        const response = await fetch(url);
        if (response.status === readiness.expectedStatus) {
          return;
        }
      } catch {
        // Keep polling until timeout.
      }

      await sleep(readiness.intervalMs);
    }

    throw new Error(`Timed out waiting for HTTP readiness at ${url}`);
  }

  const browser = await getBrowserType(config.playwright.browser).launch({ headless: true });
  try {
    while (Date.now() - startedAt < readiness.timeoutMs) {
      const page = await browser.newPage();
      try {
        await page.goto(new URL(readiness.path, workspace.baseUrl).toString(), {
          waitUntil: "domcontentloaded"
        });
        await page.waitForSelector(readiness.selector, { timeout: readiness.intervalMs });
        return;
      } catch {
        await page.close();
        await sleep(readiness.intervalMs);
      }
    }
  } finally {
    await browser.close();
  }

  throw new Error(`Timed out waiting for selector readiness on ${workspace.baseUrl}${readiness.path}`);
}