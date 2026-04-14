import { runCommand } from "../shared/process";

export type TestImpactScope = "code" | "full";
export type TestImpactCommand = "npm run test:code" | "npm test";

export interface TestImpactDecision {
  scope: TestImpactScope;
  command: TestImpactCommand;
  reason: string;
  changedPaths: string[];
  matchedPaths: string[];
}

interface PathGroup {
  reason: string;
  matches: (normalizedPath: string) => boolean;
}

const FULL_TEST_GROUPS: PathGroup[] = [
  {
    reason: "Demo app, theme, and surface changes refresh tracked screenshots.",
    matches: (normalizedPath) => normalizedPath.startsWith("src/demo-app/")
  },
  {
    reason: "Orchestrator changes affect the full intent runner.",
    matches: (normalizedPath) => normalizedPath.startsWith("src/orchestrator/")
  },
  {
    reason: "Capture, comparison, and evidence changes affect screenshot workflows.",
    matches: (normalizedPath) =>
      normalizedPath.startsWith("src/capture/") ||
      normalizedPath.startsWith("src/compare/") ||
      normalizedPath.startsWith("src/evidence/")
  },
  {
    reason: "Config and CLI changes can alter runnable sources and test wiring.",
    matches: (normalizedPath) =>
      normalizedPath.startsWith("src/config/") ||
      normalizedPath === "src/cli.ts" ||
      normalizedPath === "package.json"
  },
  {
    reason: "Tracked baseline and runnable config changes must be validated by the full workflow.",
    matches: (normalizedPath) =>
      normalizedPath.startsWith("evidence/baselines/") ||
      normalizedPath === "intent-poc.yaml" ||
      normalizedPath === "intent-poc.local-no-linear.yaml"
  }
];

const CODE_ONLY_GROUPS: PathGroup[] = [
  {
    reason: "Intent planning changes can stay on the deterministic code suite.",
    matches: (normalizedPath) => normalizedPath.startsWith("src/intent/")
  },
  {
    reason: "Linear planning and client slices can stay on the deterministic code suite.",
    matches: (normalizedPath) => normalizedPath.startsWith("src/linear/")
  },
  {
    reason: "Test-only edits do not need tracked screenshot refresh.",
    matches: (normalizedPath) => normalizedPath.endsWith(".test.ts")
  },
  {
    reason: "Documentation-only edits default to the code suite.",
    matches: (normalizedPath) => normalizedPath.endsWith(".md")
  },
  {
    reason: "TypeScript project config changes default to the code suite.",
    matches: (normalizedPath) => normalizedPath === "tsconfig.json"
  }
];

function normalizePath(inputPath: string): string {
  return inputPath.replace(/\\/g, "/").replace(/^\.\//, "");
}

function dedupePaths(paths: string[]): string[] {
  return Array.from(new Set(paths.map(normalizePath).filter((path) => path.length > 0))).sort();
}

function collectMatches(paths: string[], groups: PathGroup[]): string[] {
  return paths.filter((currentPath) => groups.some((group) => group.matches(currentPath)));
}

function findFirstMatchingReason(paths: string[], groups: PathGroup[]): string | undefined {
  for (const group of groups) {
    if (paths.some((currentPath) => group.matches(currentPath))) {
      return group.reason;
    }
  }

  return undefined;
}

export function classifyChangedPaths(changedPaths: string[]): TestImpactDecision {
  const normalizedPaths = dedupePaths(changedPaths);

  if (normalizedPaths.length === 0) {
    return {
      scope: "code",
      command: "npm run test:code",
      reason: "No changed files were detected, so the fast deterministic code suite is enough.",
      changedPaths: normalizedPaths,
      matchedPaths: []
    };
  }

  const fullMatches = collectMatches(normalizedPaths, FULL_TEST_GROUPS);
  if (fullMatches.length > 0) {
    return {
      scope: "full",
      command: "npm test",
      reason: findFirstMatchingReason(normalizedPaths, FULL_TEST_GROUPS) ?? "Changed files require the full workflow.",
      changedPaths: normalizedPaths,
      matchedPaths: fullMatches
    };
  }

  const codeOnlyMatches = collectMatches(normalizedPaths, CODE_ONLY_GROUPS);
  if (codeOnlyMatches.length === normalizedPaths.length) {
    return {
      scope: "code",
      command: "npm run test:code",
      reason: findFirstMatchingReason(normalizedPaths, CODE_ONLY_GROUPS) ?? "Changed files only affect deterministic code paths.",
      changedPaths: normalizedPaths,
      matchedPaths: codeOnlyMatches
    };
  }

  return {
    scope: "full",
    command: "npm test",
    reason: "At least one changed file falls outside the safe code-only set, so the full workflow is required.",
    changedPaths: normalizedPaths,
    matchedPaths: normalizedPaths.filter((currentPath) => !codeOnlyMatches.includes(currentPath))
  };
}

export async function listGitChangedPaths(cwd: string): Promise<string[]> {
  const commandOutputs = await Promise.all([
    runCommand("git diff --name-only", { cwd }),
    runCommand("git diff --name-only --cached", { cwd }),
    runCommand("git ls-files --others --exclude-standard", { cwd })
  ]);

  return dedupePaths(
    commandOutputs.flatMap((result) => result.stdout.split(/\r?\n/).filter((line) => line.trim().length > 0))
  );
}

function formatDecision(decision: TestImpactDecision): string {
  const header = [
    `Selected scope: ${decision.scope}`,
    `Running: ${decision.command}`,
    `Reason: ${decision.reason}`
  ];

  if (decision.changedPaths.length === 0) {
    return header.join("\n");
  }

  return [
    ...header,
    "Changed files:",
    ...decision.changedPaths.map((currentPath) => `- ${currentPath}`)
  ].join("\n");
}

async function executeSelectedCommand(cwd: string, decision: TestImpactDecision): Promise<void> {
  const result = await runCommand(decision.command, { cwd });
  if (result.stdout.length > 0) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr.length > 0) {
    process.stderr.write(result.stderr);
  }
}

async function main(): Promise<void> {
  const printOnly = process.argv.includes("--print");
  const explicitPaths = process.argv.slice(2).filter((argument) => argument !== "--print");
  const changedPaths = explicitPaths.length > 0 ? explicitPaths : await listGitChangedPaths(process.cwd());
  const decision = classifyChangedPaths(changedPaths);

  process.stdout.write(`${formatDecision(decision)}\n`);

  if (printOnly) {
    return;
  }

  await executeSelectedCommand(process.cwd(), decision);
}

if (process.argv[1] && /test-impact-detector\.(ts|js)$/.test(process.argv[1])) {
  void main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}