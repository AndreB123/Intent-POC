import { renderSelectionCard } from "./render-content-cards";

export function renderStudioGuideCards(): string {
  return `
                <div class="field-wide">
                  ${renderSelectionCard({
                    title: "How Work Scope Works",
                    badge: { label: "guide", toneClass: "target-ready" },
                    lines: [
                      { html: "<strong>Work scope</strong> constrains which configured repos or apps can participate in the run. It does not change how screenshots are handled after capture." },
                      { text: "Rename cards and update repo context directly in the Source Metadata editor. Use the YAML config when you need to add, remove, or structurally rewire sources." },
                      { text: "When multiple sources are checked, the planner creates one evidence lane per selected source inside the same business run." }
                    ]
                  })}
                </div>
                <div class="field-wide">
                  ${renderSelectionCard({
                    title: "Default work scope",
                    titleId: "selection-title",
                    badge: { label: "optional", toneClass: "target-ready", id: "selection-status" },
                    lines: [
                      { text: "The runner can choose sources from your prompt, then fall back to the config default if needed.", id: "selection-summary" },
                      { text: "Blank work scope falls back to prompt matching, business-wide expansion, then config default.", id: "selection-defaults" },
                      { text: "Use the Work Scope selector in the Run Workspace tab to understand what each source actually does before you constrain the run.", id: "selection-details" }
                    ]
                  })}
                </div>`;
}

export function renderStudioLifecyclePanel(): string {
  return `
            <div class="lifecycle-stack">
              <div class="lifecycle-step" id="step-normalization">
                <div class="lifecycle-step-title">1. Prompt Interpretation <span class="lifecycle-step-status" id="step-normalization-status" data-state="pending">Pending</span></div>
                <div class="lifecycle-step-content">
                  <div class="plan-intent-text" id="plan-intent-text"></div>
                  <div class="plan-intent-outcome" id="plan-intent-outcome"></div>
                  <div class="plan-note" id="plan-plan-notes"></div>
                </div>
              </div>
              <div class="lifecycle-step" id="step-linear">
                <div class="lifecycle-step-title">2. Repo Context <span class="lifecycle-step-status" id="step-linear-status" data-state="pending">Pending</span></div>
                <div class="lifecycle-step-content" id="plan-linear"></div>
              </div>
              <div class="lifecycle-step" id="step-bdd">
                <div class="lifecycle-step-title">3. Scope & Boundaries <span class="lifecycle-step-status" id="step-bdd-status" data-state="pending">Pending</span></div>
                <div class="lifecycle-step-content">
                  <div id="plan-criteria"></div>
                  <div id="plan-scenarios"></div>
                </div>
              </div>
              <div class="lifecycle-step" id="step-tdd">
                <div class="lifecycle-step-title">4. Success Contract <span class="lifecycle-step-status" id="step-tdd-status" data-state="pending">Pending</span></div>
                <div class="lifecycle-step-content">
                  <div id="plan-decomposition"></div>
                  <div id="plan-work-items"></div>
                </div>
              </div>
              <div class="lifecycle-step" id="step-plan">
                <div class="lifecycle-step-title">5. Execution Readiness <span class="lifecycle-step-status" id="step-plan-status" data-state="pending">Pending</span></div>
                <div class="lifecycle-step-content">
                  <div class="plan-note" id="plan-execution-note"></div>
                  <div id="plan-sources"></div>
                  <div id="plan-tools"></div>
                  <div id="plan-destinations"></div>
                </div>
              </div>
              <div class="lifecycle-step" id="step-implementation">
                <div class="lifecycle-step-title">6. Implementation <span class="lifecycle-step-status" id="step-implementation-status" data-state="pending">Pending</span></div>
                <div class="lifecycle-step-content" id="plan-implementation"></div>
              </div>
              <div class="lifecycle-step" id="step-qa">
                <div class="lifecycle-step-title">7. QA Verification <span class="lifecycle-step-status" id="step-qa-status" data-state="pending">Pending</span></div>
                <div class="lifecycle-step-content" id="plan-qa"></div>
              </div>
            </div>`;
}