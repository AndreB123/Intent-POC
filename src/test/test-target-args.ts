const TEST_TARGET_EXTENSIONS = [".test.", ".spec."];
const FLAG_VALUE_PREFIXES = ["--test-"];
const EXACT_FLAGS_WITH_VALUES = new Set([
  "--conditions",
  "--concurrency",
  "--experimental-loader",
  "--import",
  "--loader",
  "--require",
  "--watch-path"
]);

function looksLikeTestTarget(arg: string): boolean {
  if (arg.includes("*") || arg.includes("?")) {
    return true;
  }

  if (TEST_TARGET_EXTENSIONS.some((segment) => arg.includes(segment))) {
    return true;
  }

  return arg.includes("/") || arg.includes("\\");
}

function flagConsumesNextValue(arg: string): boolean {
  if (!arg.startsWith("-") || arg.includes("=")) {
    return false;
  }

  return EXACT_FLAGS_WITH_VALUES.has(arg) || FLAG_VALUE_PREFIXES.some((prefix) => arg.startsWith(prefix));
}

export function splitTestRunnerArgs(argv: string[]): { runnerArgs: string[]; testTargets: string[] } {
  const runnerArgs: string[] = [];
  const testTargets: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg.startsWith("-")) {
      runnerArgs.push(arg);

      const nextArg = argv[index + 1];
      if (nextArg && flagConsumesNextValue(arg) && !nextArg.startsWith("-") && !looksLikeTestTarget(nextArg)) {
        runnerArgs.push(nextArg);
        index += 1;
      }

      continue;
    }

    testTargets.push(arg);
  }

  return { runnerArgs, testTargets };
}