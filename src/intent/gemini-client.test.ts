import { strict as assert } from "node:assert";
import test from "node:test";
import { isGeminiTransientError, runGeminiModelFailover } from "./gemini-client";

test("isGeminiTransientError detects provider saturation and availability signals", () => {
  assert.equal(
    isGeminiTransientError('{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}'),
    true
  );
  assert.equal(isGeminiTransientError("RESOURCE_EXHAUSTED: quota limited"), true);
  assert.equal(isGeminiTransientError("429 too many requests"), true);
});

test("isGeminiTransientError does not classify deterministic planner failures as transient", () => {
  assert.equal(isGeminiTransientError("provider returned no runnable spec artifacts"), false);
  assert.equal(isGeminiTransientError("invalid JSON response from provider"), false);
});

test("runGeminiModelFailover switches to fallback model on transient primary failure", async () => {
  const attempts: string[] = [];

  const result = await runGeminiModelFailover({
    contextLabel: "Gemini TDD planning",
    primaryModel: "models/gemini-3.1-flash-lite-preview",
    modelFailover: ["models/gemini-3.1-pro-preview"],
    invoke: async (model) => {
      attempts.push(model);
      if (model === "models/gemini-3.1-flash-lite-preview") {
        throw new Error("UNAVAILABLE: high demand");
      }

      return { text: '{"workItems":[]}' };
    }
  });

  assert.deepEqual(attempts, ["models/gemini-3.1-flash-lite-preview", "models/gemini-3.1-pro-preview"]);
  assert.equal(result.selectedModel, "models/gemini-3.1-pro-preview");
  assert.equal(result.failedAttempts.length, 1);
  assert.equal(result.failedAttempts[0]?.model, "models/gemini-3.1-flash-lite-preview");
});

test("runGeminiModelFailover aborts immediately on non-transient errors", async () => {
  const attempts: string[] = [];

  await assert.rejects(
    () =>
      runGeminiModelFailover({
        contextLabel: "Gemini TDD planning",
        primaryModel: "models/gemini-3.1-flash-lite-preview",
        modelFailover: ["models/gemini-3.1-pro-preview"],
        invoke: async (model) => {
          attempts.push(model);
          throw new Error("provider returned no runnable spec artifacts");
        }
      }),
    /Gemini TDD planning failed on model 'models\/gemini-3.1-flash-lite-preview': provider returned no runnable spec artifacts/
  );

  assert.deepEqual(attempts, ["models/gemini-3.1-flash-lite-preview"]);
});

test("runGeminiModelFailover throws aggregated failure after all transient attempts", async () => {
  await assert.rejects(
    () =>
      runGeminiModelFailover({
        contextLabel: "Gemini TDD planning",
        primaryModel: "models/gemini-3.1-flash-lite-preview",
        modelFailover: ["models/gemini-3.1-pro-preview"],
        invoke: async () => {
          throw new Error("503 UNAVAILABLE high demand");
        }
      }),
    /failed after transient Gemini provider saturation across models \[models\/gemini-3.1-flash-lite-preview, models\/gemini-3.1-pro-preview\]/
  );
});
