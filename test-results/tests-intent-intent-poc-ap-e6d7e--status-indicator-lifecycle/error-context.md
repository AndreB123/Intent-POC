# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests/intent/intent-poc-app/test-execution-indicator.spec.ts >> Intent Studio Test Execution Indicator >> Verify status indicator lifecycle
- Location: tests/intent/intent-poc-app/test-execution-indicator.spec.ts:144:7

# Error details

```
Error: The status indicator component is present in the UI.

expect(locator).toBeVisible() failed

Locator: locator('[data-testid=\'test-status-indicator\']')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - The status indicator component is present in the UI. with timeout 5000ms
  - waiting for locator('[data-testid=\'test-status-indicator\']')

```

# Test source

```ts
  85  | }
  86  | 
  87  | function isUiStateRouteSatisfied(page: Page, requirement: (typeof requiredUiStates)[number]): boolean {
  88  |   const currentUrl = new URL(page.url());
  89  |   for (const activation of requirement.activation) {
  90  |     if (activation.type !== "query-param" || !activation.target) {
  91  |       continue;
  92  |     }
  93  | 
  94  |     const activationValue = activation.values[requirement.requestedValue];
  95  |     if (typeof activationValue !== "string" || activationValue.length === 0) {
  96  |       continue;
  97  |     }
  98  | 
  99  |     if (currentUrl.searchParams.get(activation.target) === activationValue) {
  100 |       return true;
  101 |     }
  102 |   }
  103 | 
  104 |   return false;
  105 | }
  106 | 
  107 | async function applyUiStateRequirements(page: Page, requirements: typeof requiredUiStates): Promise<void> {
  108 |   for (const requirement of requirements) {
  109 |     if (!requirement.requestedValue) {
  110 |       continue;
  111 |     }
  112 | 
  113 |     if (isUiStateRouteSatisfied(page, requirement)) {
  114 |       continue;
  115 |     }
  116 | 
  117 |     for (const activation of requirement.activation) {
  118 |       if (activation.type !== "ui-control" || !activation.target) {
  119 |         continue;
  120 |       }
  121 | 
  122 |       const activationValue = activation.values[requirement.requestedValue];
  123 |       if (!activationValue || !/^(true|1|on|enabled|active)$/i.test(activationValue)) {
  124 |         continue;
  125 |       }
  126 | 
  127 |       const control = page.locator(activation.target).first();
  128 |       if ((await control.count()) === 0) {
  129 |         continue;
  130 |       }
  131 | 
  132 |       await expect(control, `${requirement.label ?? requirement.stateId} control should be visible before activation.`).toBeVisible();
  133 |       const urlBeforeActivation = page.url();
  134 |       await control.click();
  135 |       if (page.url() !== urlBeforeActivation) {
  136 |         await page.waitForLoadState("load");
  137 |       }
  138 |       break;
  139 |     }
  140 |   }
  141 | }
  142 | 
  143 | test.describe("Intent Studio Test Execution Indicator", () => {
  144 |   test("Verify status indicator lifecycle", async ({ page }) => {
  145 |     await test.step("Verify running state indicator", async () => {
  146 |       await page.route("**/api/state", async (route) => {
  147 |         await route.fulfill({
  148 |           status: 200,
  149 |           contentType: "application/json; charset=utf-8",
  150 |           body: "{}"
  151 |         });
  152 |       });
  153 |       await page.route("**/api/events", async (route) => {
  154 |         await route.fulfill({
  155 |           status: 200,
  156 |           contentType: "text/event-stream",
  157 |           body: ""
  158 |         });
  159 |       });
  160 |       const screenshotPath = path.join(screenshotRoot, "bdd/test-execution-indicator-spec", "verify-running-state-indicator.png");
  161 |       await mkdir(path.dirname(screenshotPath), { recursive: true });
  162 |       await page.screenshot({ path: screenshotPath, fullPage: true });
  163 |     });
  164 |     await test.step("Verify passed state indicator", async () => {
  165 |       await page.route("**/api/state", async (route) => {
  166 |         await route.fulfill({
  167 |           status: 200,
  168 |           contentType: "application/json; charset=utf-8",
  169 |           body: "{}"
  170 |         });
  171 |       });
  172 |       await page.route("**/api/events", async (route) => {
  173 |         await route.fulfill({
  174 |           status: 200,
  175 |           contentType: "text/event-stream",
  176 |           body: ""
  177 |         });
  178 |       });
  179 |       const screenshotPath = path.join(screenshotRoot, "bdd/test-execution-indicator-spec", "verify-passed-state-indicator.png");
  180 |       await mkdir(path.dirname(screenshotPath), { recursive: true });
  181 |       await page.screenshot({ path: screenshotPath, fullPage: true });
  182 |     });
  183 |     await test.step("Assert indicator visibility", async () => {
  184 |       const target = page.locator("[data-testid='test-status-indicator']");
> 185 |       await expect(target, "The status indicator component is present in the UI.").toBeVisible();
      |                                                                                    ^ Error: The status indicator component is present in the UI.
  186 |       const screenshotPath = path.join(screenshotRoot, "bdd/test-execution-indicator-spec", "assert-indicator-visibility.png");
  187 |       await mkdir(path.dirname(screenshotPath), { recursive: true });
  188 |       await page.screenshot({ path: screenshotPath, fullPage: true });
  189 |     });
  190 |   });
  191 | });
  192 | 
```