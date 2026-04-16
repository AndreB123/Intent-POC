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

async function checkHttpReadiness(url: string, expectedStatus: number, timeoutMs?: number): Promise<boolean> {
  try {
    const response = await fetch(url, {
      signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined
    });
    return response.status === expectedStatus;
  } catch {
    return false;
  }
}

async function checkSelectorReadiness(input: {
  config: AppConfig;
  workspace: ResolvedSourceWorkspace;
  path: string;
  selector: string;
  timeoutMs: number;
}): Promise<boolean> {
  const browser = await getBrowserType(input.config.playwright.browser).launch({ headless: true });
  try {
    const page = await browser.newPage();
    try {
      await page.goto(new URL(input.path, input.workspace.baseUrl).toString(), {
        waitUntil: "domcontentloaded",
        timeout: input.timeoutMs
      });
      await page.waitForSelector(input.selector, { timeout: input.timeoutMs });
      return true;
    } catch {
      return false;
    } finally {
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

export async function checkReady(
  config: AppConfig,
  workspace: ResolvedSourceWorkspace,
  timeoutMs?: number
): Promise<boolean> {
  const readiness = workspace.source.app.readiness;

  if (readiness.type === "http") {
    return await checkHttpReadiness(readiness.url ?? workspace.baseUrl, readiness.expectedStatus, timeoutMs);
  }

  return await checkSelectorReadiness({
    config,
    workspace,
    path: readiness.path,
    selector: readiness.selector,
    timeoutMs: timeoutMs ?? readiness.intervalMs
  });
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
      if (await checkHttpReadiness(url, readiness.expectedStatus, readiness.intervalMs)) {
        return;
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