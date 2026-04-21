# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests/intent/intent-poc-app/behavior-is-verified-visually-for-applicable-sources.spec.ts >> Intent-driven flow for intent-poc-app >> Behavior is verified visually for applicable sources
- Location: tests/intent/intent-poc-app/behavior-is-verified-visually-for-applicable-sources.spec.ts:10:7

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: page.waitForSelector: Test timeout of 30000ms exceeded.
Call log:
  - waiting for locator('[data-testid=\'component-activity-timeline\']') to be visible

```

# Page snapshot

```yaml
- generic [ref=e2]: not found
```

# Test source

```ts
  147 |       await page.goto(new URL("/library/component-banner-info", baseUrl).toString(), { waitUntil: "load" });
  148 |       await page.waitForSelector("[data-testid='component-banner-info']");
  149 |       const target = page.locator("[data-testid='component-banner-info']");
  150 |       await expect(target, "The target '[data-testid='component-banner-info']' is visible for Info Banner.").toBeVisible();
  151 |       const screenshotPath = path.join(screenshotRoot, "bdd/behavior-is-verified-visually-for-applicable-sources-spec", "info-banner.png");
  152 |       await mkdir(path.dirname(screenshotPath), { recursive: true });
  153 |       await target.screenshot({ path: screenshotPath });
  154 |     });
  155 |     await test.step("Warning Banner", async () => {
  156 |       await page.goto(new URL("/library/component-banner-warning", baseUrl).toString(), { waitUntil: "load" });
  157 |       await page.waitForSelector("[data-testid='component-banner-warning']");
  158 |       const target = page.locator("[data-testid='component-banner-warning']");
  159 |       await expect(target, "The target '[data-testid='component-banner-warning']' is visible for Warning Banner.").toBeVisible();
  160 |       const screenshotPath = path.join(screenshotRoot, "bdd/behavior-is-verified-visually-for-applicable-sources-spec", "warning-banner.png");
  161 |       await mkdir(path.dirname(screenshotPath), { recursive: true });
  162 |       await target.screenshot({ path: screenshotPath });
  163 |     });
  164 |     await test.step("Modal Shell", async () => {
  165 |       await page.goto(new URL("/library/component-modal-shell", baseUrl).toString(), { waitUntil: "load" });
  166 |       await page.waitForSelector("[data-testid='component-modal-shell']");
  167 |       const target = page.locator("[data-testid='component-modal-shell']");
  168 |       await expect(target, "The target '[data-testid='component-modal-shell']' is visible for Modal Shell.").toBeVisible();
  169 |       const screenshotPath = path.join(screenshotRoot, "bdd/behavior-is-verified-visually-for-applicable-sources-spec", "modal-shell.png");
  170 |       await mkdir(path.dirname(screenshotPath), { recursive: true });
  171 |       await target.screenshot({ path: screenshotPath });
  172 |     });
  173 |     await test.step("Table Row", async () => {
  174 |       await page.goto(new URL("/library/component-table-row", baseUrl).toString(), { waitUntil: "load" });
  175 |       await page.waitForSelector("[data-testid='component-table-row']");
  176 |       const target = page.locator("[data-testid='component-table-row']");
  177 |       await expect(target, "The target '[data-testid='component-table-row']' is visible for Table Row.").toBeVisible();
  178 |       const screenshotPath = path.join(screenshotRoot, "bdd/behavior-is-verified-visually-for-applicable-sources-spec", "table-row.png");
  179 |       await mkdir(path.dirname(screenshotPath), { recursive: true });
  180 |       await target.screenshot({ path: screenshotPath });
  181 |     });
  182 |     await test.step("Search Bar", async () => {
  183 |       await page.goto(new URL("/library/component-search-bar", baseUrl).toString(), { waitUntil: "load" });
  184 |       await page.waitForSelector("[data-testid='component-search-bar']");
  185 |       const target = page.locator("[data-testid='component-search-bar']");
  186 |       await expect(target, "The target '[data-testid='component-search-bar']' is visible for Search Bar.").toBeVisible();
  187 |       const screenshotPath = path.join(screenshotRoot, "bdd/behavior-is-verified-visually-for-applicable-sources-spec", "search-bar.png");
  188 |       await mkdir(path.dirname(screenshotPath), { recursive: true });
  189 |       await target.screenshot({ path: screenshotPath });
  190 |     });
  191 |     await test.step("Stat Tile", async () => {
  192 |       await page.goto(new URL("/library/component-stat-tile", baseUrl).toString(), { waitUntil: "load" });
  193 |       await page.waitForSelector("[data-testid='component-stat-tile']");
  194 |       const target = page.locator("[data-testid='component-stat-tile']");
  195 |       await expect(target, "The target '[data-testid='component-stat-tile']' is visible for Stat Tile.").toBeVisible();
  196 |       const screenshotPath = path.join(screenshotRoot, "bdd/behavior-is-verified-visually-for-applicable-sources-spec", "stat-tile.png");
  197 |       await mkdir(path.dirname(screenshotPath), { recursive: true });
  198 |       await target.screenshot({ path: screenshotPath });
  199 |     });
  200 |     await test.step("Nav Tabs", async () => {
  201 |       await page.goto(new URL("/library/component-nav-tabs", baseUrl).toString(), { waitUntil: "load" });
  202 |       await page.waitForSelector("[data-testid='component-nav-tabs']");
  203 |       const target = page.locator("[data-testid='component-nav-tabs']");
  204 |       await expect(target, "The target '[data-testid='component-nav-tabs']' is visible for Nav Tabs.").toBeVisible();
  205 |       const screenshotPath = path.join(screenshotRoot, "bdd/behavior-is-verified-visually-for-applicable-sources-spec", "nav-tabs.png");
  206 |       await mkdir(path.dirname(screenshotPath), { recursive: true });
  207 |       await target.screenshot({ path: screenshotPath });
  208 |     });
  209 |     await test.step("Success Toast", async () => {
  210 |       await page.goto(new URL("/library/component-toast-success", baseUrl).toString(), { waitUntil: "load" });
  211 |       await page.waitForSelector("[data-testid='component-toast-success']");
  212 |       const target = page.locator("[data-testid='component-toast-success']");
  213 |       await expect(target, "The target '[data-testid='component-toast-success']' is visible for Success Toast.").toBeVisible();
  214 |       const screenshotPath = path.join(screenshotRoot, "bdd/behavior-is-verified-visually-for-applicable-sources-spec", "success-toast.png");
  215 |       await mkdir(path.dirname(screenshotPath), { recursive: true });
  216 |       await target.screenshot({ path: screenshotPath });
  217 |     });
  218 |     await test.step("Error Toast", async () => {
  219 |       await page.goto(new URL("/library/component-toast-error", baseUrl).toString(), { waitUntil: "load" });
  220 |       await page.waitForSelector("[data-testid='component-toast-error']");
  221 |       const target = page.locator("[data-testid='component-toast-error']");
  222 |       await expect(target, "The target '[data-testid='component-toast-error']' is visible for Error Toast.").toBeVisible();
  223 |       const screenshotPath = path.join(screenshotRoot, "bdd/behavior-is-verified-visually-for-applicable-sources-spec", "error-toast.png");
  224 |       await mkdir(path.dirname(screenshotPath), { recursive: true });
  225 |       await target.screenshot({ path: screenshotPath });
  226 |     });
  227 |     await test.step("Form Section", async () => {
  228 |       await page.goto(new URL("/library/component-form-section", baseUrl).toString(), { waitUntil: "load" });
  229 |       await page.waitForSelector("[data-testid='component-form-section']");
  230 |       const target = page.locator("[data-testid='component-form-section']");
  231 |       await expect(target, "The target '[data-testid='component-form-section']' is visible for Form Section.").toBeVisible();
  232 |       const screenshotPath = path.join(screenshotRoot, "bdd/behavior-is-verified-visually-for-applicable-sources-spec", "form-section.png");
  233 |       await mkdir(path.dirname(screenshotPath), { recursive: true });
  234 |       await target.screenshot({ path: screenshotPath });
  235 |     });
  236 |     await test.step("User List Item", async () => {
  237 |       await page.goto(new URL("/library/component-user-list-item", baseUrl).toString(), { waitUntil: "load" });
  238 |       await page.waitForSelector("[data-testid='component-user-list-item']");
  239 |       const target = page.locator("[data-testid='component-user-list-item']");
  240 |       await expect(target, "The target '[data-testid='component-user-list-item']' is visible for User List Item.").toBeVisible();
  241 |       const screenshotPath = path.join(screenshotRoot, "bdd/behavior-is-verified-visually-for-applicable-sources-spec", "user-list-item.png");
  242 |       await mkdir(path.dirname(screenshotPath), { recursive: true });
  243 |       await target.screenshot({ path: screenshotPath });
  244 |     });
  245 |     await test.step("Activity Timeline", async () => {
  246 |       await page.goto(new URL("/library/component-activity-timeline", baseUrl).toString(), { waitUntil: "load" });
> 247 |       await page.waitForSelector("[data-testid='component-activity-timeline']");
      |                  ^ Error: page.waitForSelector: Test timeout of 30000ms exceeded.
  248 |       const target = page.locator("[data-testid='component-activity-timeline']");
  249 |       await expect(target, "The target '[data-testid='component-activity-timeline']' is visible for Activity Timeline.").toBeVisible();
  250 |       const screenshotPath = path.join(screenshotRoot, "bdd/behavior-is-verified-visually-for-applicable-sources-spec", "activity-timeline.png");
  251 |       await mkdir(path.dirname(screenshotPath), { recursive: true });
  252 |       await target.screenshot({ path: screenshotPath });
  253 |     });
  254 |     await test.step("Dashboard Summary View", async () => {
  255 |       await page.goto(new URL("/library/view-dashboard-summary", baseUrl).toString(), { waitUntil: "load" });
  256 |       await page.waitForSelector("[data-testid='view-dashboard-summary']");
  257 |       const target = page.locator("[data-testid='view-dashboard-summary']");
  258 |       await expect(target, "The target '[data-testid='view-dashboard-summary']' is visible for Dashboard Summary View.").toBeVisible();
  259 |       const screenshotPath = path.join(screenshotRoot, "bdd/behavior-is-verified-visually-for-applicable-sources-spec", "dashboard-summary-view.png");
  260 |       await mkdir(path.dirname(screenshotPath), { recursive: true });
  261 |       await target.screenshot({ path: screenshotPath });
  262 |     });
  263 |     await test.step("List Overview View", async () => {
  264 |       await page.goto(new URL("/library/view-list-overview", baseUrl).toString(), { waitUntil: "load" });
  265 |       await page.waitForSelector("[data-testid='view-list-overview']");
  266 |       const target = page.locator("[data-testid='view-list-overview']");
  267 |       await expect(target, "The target '[data-testid='view-list-overview']' is visible for List Overview View.").toBeVisible();
  268 |       const screenshotPath = path.join(screenshotRoot, "bdd/behavior-is-verified-visually-for-applicable-sources-spec", "list-overview-view.png");
  269 |       await mkdir(path.dirname(screenshotPath), { recursive: true });
  270 |       await target.screenshot({ path: screenshotPath });
  271 |     });
  272 |     await test.step("Settings Panel View", async () => {
  273 |       await page.goto(new URL("/library/view-settings-panel", baseUrl).toString(), { waitUntil: "load" });
  274 |       await page.waitForSelector("[data-testid='view-settings-panel']");
  275 |       const target = page.locator("[data-testid='view-settings-panel']");
  276 |       await expect(target, "The target '[data-testid='view-settings-panel']' is visible for Settings Panel View.").toBeVisible();
  277 |       const screenshotPath = path.join(screenshotRoot, "bdd/behavior-is-verified-visually-for-applicable-sources-spec", "settings-panel-view.png");
  278 |       await mkdir(path.dirname(screenshotPath), { recursive: true });
  279 |       await target.screenshot({ path: screenshotPath });
  280 |     });
  281 |     await test.step("Empty Results View", async () => {
  282 |       await page.goto(new URL("/library/view-empty-results", baseUrl).toString(), { waitUntil: "load" });
  283 |       await page.waitForSelector("[data-testid='view-empty-results']");
  284 |       const target = page.locator("[data-testid='view-empty-results']");
  285 |       await expect(target, "The target '[data-testid='view-empty-results']' is visible for Empty Results View.").toBeVisible();
  286 |       const screenshotPath = path.join(screenshotRoot, "bdd/behavior-is-verified-visually-for-applicable-sources-spec", "empty-results-view.png");
  287 |       await mkdir(path.dirname(screenshotPath), { recursive: true });
  288 |       await target.screenshot({ path: screenshotPath });
  289 |     });
  290 |     await test.step("Campaign Table View", async () => {
  291 |       await page.goto(new URL("/library/view-campaign-table", baseUrl).toString(), { waitUntil: "load" });
  292 |       await page.waitForSelector("[data-testid='view-campaign-table']");
  293 |       const target = page.locator("[data-testid='view-campaign-table']");
  294 |       await expect(target, "The target '[data-testid='view-campaign-table']' is visible for Campaign Table View.").toBeVisible();
  295 |       const screenshotPath = path.join(screenshotRoot, "bdd/behavior-is-verified-visually-for-applicable-sources-spec", "campaign-table-view.png");
  296 |       await mkdir(path.dirname(screenshotPath), { recursive: true });
  297 |       await target.screenshot({ path: screenshotPath });
  298 |     });
  299 |     await test.step("Notifications Center View", async () => {
  300 |       await page.goto(new URL("/library/view-notifications-center", baseUrl).toString(), { waitUntil: "load" });
  301 |       await page.waitForSelector("[data-testid='view-notifications-center']");
  302 |       const target = page.locator("[data-testid='view-notifications-center']");
  303 |       await expect(target, "The target '[data-testid='view-notifications-center']' is visible for Notifications Center View.").toBeVisible();
  304 |       const screenshotPath = path.join(screenshotRoot, "bdd/behavior-is-verified-visually-for-applicable-sources-spec", "notifications-center-view.png");
  305 |       await mkdir(path.dirname(screenshotPath), { recursive: true });
  306 |       await target.screenshot({ path: screenshotPath });
  307 |     });
  308 |     await test.step("User Directory View", async () => {
  309 |       await page.goto(new URL("/library/view-user-directory", baseUrl).toString(), { waitUntil: "load" });
  310 |       await page.waitForSelector("[data-testid='view-user-directory']");
  311 |       const target = page.locator("[data-testid='view-user-directory']");
  312 |       await expect(target, "The target '[data-testid='view-user-directory']' is visible for User Directory View.").toBeVisible();
  313 |       const screenshotPath = path.join(screenshotRoot, "bdd/behavior-is-verified-visually-for-applicable-sources-spec", "user-directory-view.png");
  314 |       await mkdir(path.dirname(screenshotPath), { recursive: true });
  315 |       await target.screenshot({ path: screenshotPath });
  316 |     });
  317 |     await test.step("Revenue KPIs View", async () => {
  318 |       await page.goto(new URL("/library/view-revenue-kpis", baseUrl).toString(), { waitUntil: "load" });
  319 |       await page.waitForSelector("[data-testid='view-revenue-kpis']");
  320 |       const target = page.locator("[data-testid='view-revenue-kpis']");
  321 |       await expect(target, "The target '[data-testid='view-revenue-kpis']' is visible for Revenue KPIs View.").toBeVisible();
  322 |       const screenshotPath = path.join(screenshotRoot, "bdd/behavior-is-verified-visually-for-applicable-sources-spec", "revenue-kpis-view.png");
  323 |       await mkdir(path.dirname(screenshotPath), { recursive: true });
  324 |       await target.screenshot({ path: screenshotPath });
  325 |     });
  326 |     await test.step("Onboarding Checklist View", async () => {
  327 |       await page.goto(new URL("/library/view-onboarding-checklist", baseUrl).toString(), { waitUntil: "load" });
  328 |       await page.waitForSelector("[data-testid='view-onboarding-checklist']");
  329 |       const target = page.locator("[data-testid='view-onboarding-checklist']");
  330 |       await expect(target, "The target '[data-testid='view-onboarding-checklist']' is visible for Onboarding Checklist View.").toBeVisible();
  331 |       const screenshotPath = path.join(screenshotRoot, "bdd/behavior-is-verified-visually-for-applicable-sources-spec", "onboarding-checklist-view.png");
  332 |       await mkdir(path.dirname(screenshotPath), { recursive: true });
  333 |       await target.screenshot({ path: screenshotPath });
  334 |     });
  335 |     await test.step("Approval Queue View", async () => {
  336 |       await page.goto(new URL("/library/view-approval-queue", baseUrl).toString(), { waitUntil: "load" });
  337 |       await page.waitForSelector("[data-testid='view-approval-queue']");
  338 |       const target = page.locator("[data-testid='view-approval-queue']");
  339 |       await expect(target, "The target '[data-testid='view-approval-queue']' is visible for Approval Queue View.").toBeVisible();
  340 |       const screenshotPath = path.join(screenshotRoot, "bdd/behavior-is-verified-visually-for-applicable-sources-spec", "approval-queue-view.png");
  341 |       await mkdir(path.dirname(screenshotPath), { recursive: true });
  342 |       await target.screenshot({ path: screenshotPath });
  343 |     });
  344 |     await test.step("Audit Log View", async () => {
  345 |       await page.goto(new URL("/library/view-audit-log", baseUrl).toString(), { waitUntil: "load" });
  346 |       await page.waitForSelector("[data-testid='view-audit-log']");
  347 |       const target = page.locator("[data-testid='view-audit-log']");
```