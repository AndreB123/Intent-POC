import type { CodeSurfaceId } from "./code-surface";

export interface RepoMemoryCatalogEntry {
  id: string;
  title: string;
  sourcePath: string;
  sourceIds: string[];
  surfaceIds: CodeSurfaceId[];
  tags: string[];
  notes: string[];
}

// Workspace-local export of the durable repo memory notes. Runtime code cannot
// read /memories/repo directly, so scoping retrieval uses this catalog instead.
export const REPO_MEMORY_CATALOG: RepoMemoryCatalogEntry[] = [
  {
    id: "studio-lifecycle-preview",
    title: "Studio Lifecycle Preview",
    sourcePath: "/memories/repo/studio-lifecycle-preview.md",
    sourceIds: ["intent-poc-app"],
    surfaceIds: ["intent-studio", "orchestrator-and-planning"],
    tags: ["studio", "reviewed draft", "api plan", "scoping", "draft", "send", "execution"],
    notes: [
      "POST /api/plan returns a scoping-only reviewed IDD draft first, and that preview should stay lean and prompt-relevant.",
      "Studio execution stays locked until the reviewed draft is explicitly sent through /api/drafts/:id/send.",
      "The Studio run flow is two-click: first generate the reviewed draft, then patch/send it and start execution from draftId."
    ]
  },
  {
    id: "ui-state-metadata",
    title: "UI State Metadata",
    sourcePath: "/memories/repo/ui-state-metadata.md",
    sourceIds: ["intent-poc-app"],
    surfaceIds: ["intent-studio", "surface-library", "capture-and-evidence"],
    tags: ["ui state", "theme", "dark mode", "query param", "evidence"],
    notes: [
      "Source planning metadata is the reusable UI-state contract; prefer planning.verificationNotes and planning.uiStates over prompt-specific routing rules.",
      "theme-mode uses a shared dark query-param contract across Studio and library routes, so verification should prefer route state before UI controls.",
      "Theme-sensitive UI bugs need paired light-mode reference and dark-mode target evidence."
    ]
  },
  {
    id: "normalization-metadata",
    title: "Normalization Metadata",
    sourcePath: "/memories/repo/normalization-metadata.md",
    sourceIds: ["intent-poc-app"],
    surfaceIds: ["orchestrator-and-planning"],
    tags: ["normalization", "ambiguity", "planning depth", "scoping"],
    notes: [
      "normalizedIntent.normalizationMeta records requested and effective planning depth plus an explicit ambiguity summary.",
      "Ambiguity reasons come from low-confidence code-surface routing and bounded planner warnings."
    ]
  },
  {
    id: "reviewed-intent-runner",
    title: "Reviewed Intent Runner",
    sourcePath: "/memories/repo/reviewed-intent-runner.md",
    sourceIds: ["intent-poc-app"],
    surfaceIds: ["intent-studio", "orchestrator-and-planning"],
    tags: ["runintent", "reviewed draft", "draftId", "normalized intent", "runner"],
    notes: [
      "runIntent accepts normalizedIntent in RunIntentOptions so reviewed drafts can execute without re-normalizing raw prompt text.",
      "The runtime policy helper must pass normalizedIntent through so CLI, Studio, and other entrypoints share the same reviewed-intent runner contract.",
      "Studio starts reviewed runs with both prompt and artifact.normalizedIntent when launching from draftId."
    ]
  },
  {
    id: "artifact-contract",
    title: "Artifact Contract",
    sourcePath: "/memories/repo/domains/artifact-contract.md",
    sourceIds: ["intent-poc-app"],
    surfaceIds: ["surface-library", "capture-and-evidence"],
    tags: ["artifacts", "screenshots", "library", "baseline", "capture", "paths"],
    notes: [
      "Persistent artifacts live under artifacts/business, artifacts/sources/<sourceId>, and artifacts/library/<sourceId>.",
      "runId is audit metadata only and must not control durable path naming.",
      "Tracked-library sources persist PNGs only under artifacts/library/<sourceId>."
    ]
  },
  {
    id: "demo-runtime",
    title: "Demo Runtime",
    sourcePath: "/memories/repo/domains/demo-runtime.md",
    sourceIds: ["intent-poc-app"],
    surfaceIds: ["intent-studio", "surface-library"],
    tags: ["demo runtime", "intent studio", "library", "shared render"],
    notes: [
      "Intent Studio at / is the source of truth for reusable demo UI.",
      "/library stays a stable screenshot surface and should reuse shared render layers.",
      "Demo screenshot refresh runs through runIntent instead of a parallel pipeline."
    ]
  },
  {
    id: "idd-governed-decomposition",
    title: "IDD Governed Decomposition",
    sourcePath: "/memories/repo/features/idd-governed-decomposition/feature.md",
    sourceIds: ["intent-poc-app"],
    surfaceIds: ["orchestrator-and-planning"],
    tags: ["idd", "decomposition", "workstream", "task"],
    notes: [
      "Normalized intent plans should emit objective, workstream, task, subtask, and verification decomposition.",
      "Planned work items link back to decomposition ids so execution stays governed.",
      "Business summaries, source summaries, and Linear issue descriptions should surface the decomposition without requiring raw JSON."
    ]
  }
];