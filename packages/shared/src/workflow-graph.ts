import type { Step, WorkflowDefinitionInput } from "./types";
import { StepSchema } from "./types";

export class WorkflowValidationError extends Error {
  readonly code: string;
  readonly errors: string[];

  constructor(errors: string[], code = "WORKFLOW_INVALID") {
    super(errors.join("; "));
    this.name = "WorkflowValidationError";
    this.code = code;
    this.errors = errors;
  }
}

function topologicalSort(
  steps: Step[],
): { sorted: Step[]; hasCycle: boolean; cycleNodes: string[] } {
  const idToIdx = new Map(steps.map((s, i) => [s.id, i]));
  const adj: number[][] = steps.map(() => []);
  const inDegree = new Array(steps.length).fill(0);

  steps.forEach((s, i) => {
    for (const dep of s.dependsOn) {
      const depIdx = idToIdx.get(dep);
      if (depIdx === undefined) continue;
      adj[depIdx].push(i);
      inDegree[i] += 1;
    }
  });

  const queue: number[] = [];
  inDegree.forEach((deg, i) => {
    if (deg === 0) queue.push(i);
  });

  const sorted: number[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    sorted.push(node);
    for (const next of adj[node]) {
      inDegree[next] -= 1;
      if (inDegree[next] === 0) queue.push(next);
    }
  }

  if (sorted.length !== steps.length) {
    const inGraph = new Set(sorted);
    const cycleNodes = steps
      .map((s, i) => ({ s, i }))
      .filter(({ i }) => !inGraph.has(i))
      .map(({ s }) => s.id);
    return { sorted: [], hasCycle: true, cycleNodes };
  }

  return { sorted: sorted.map((i) => steps[i]), hasCycle: false, cycleNodes: [] };
}

/**
 * Validates that a workflow definition is a safe, executable DAG.
 *
 * Rules:
 *  1. Step ids are unique, non-empty, and <= 128 chars.
 *  2. Every `dependsOn` reference resolves to a real step.
 *  3. The graph is acyclic.
 *  4. Dependency order means dependent steps can be run sequentially or in parallel safely.
 *  5. Retry limits are bounded (max 10 retries) and timeouts are bounded.
 */
export function validateWorkflowDefinition(
  definition: WorkflowDefinitionInput,
): { ok: true } | { ok: false; error: WorkflowValidationError } {
  const errors: string[] = [];

  if (!definition.name || definition.name.length < 1) {
    errors.push("Workflow name is required");
  }
  if (definition.name.length > 256) {
    errors.push("Workflow name must be at most 256 characters");
  }
  if (!Array.isArray(definition.steps) || definition.steps.length === 0) {
    errors.push("Workflow must define at least one step");
  }

  if (errors.length > 0) {
    return { ok: false, error: new WorkflowValidationError(errors) };
  }

  // Validate each step against the schema.
  for (let i = 0; i < definition.steps.length; i++) {
    const parsed = StepSchema.safeParse(definition.steps[i]);
    if (!parsed.success) {
      errors.push(
        `Step at index ${i} is invalid: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join(", ")}`,
      );
    }
  }

  if (errors.length > 0) {
    return { ok: false, error: new WorkflowValidationError(errors) };
  }

  const steps = definition.steps;

  // 1. Unique ids.
  const seenIds = new Set<string>();
  for (const step of steps) {
    if (step.id.length === 0) {
      errors.push("Step id cannot be empty");
    }
    if (step.id.length > 128) {
      errors.push(`Step id '${step.id}' exceeds 128 characters`);
    }
    if (seenIds.has(step.id)) {
      errors.push(`Duplicate step id: '${step.id}'`);
    }
    seenIds.add(step.id);
  }

  // 2. Valid dependencies.
  const existingIds = new Set(steps.map((s) => s.id));
  for (const step of steps) {
    for (const dep of step.dependsOn) {
      if (!existingIds.has(dep)) {
        errors.push(
          `Step '${step.id}' depends on unknown step '${dep}'`,
        );
      }
      if (dep === step.id) {
        errors.push(`Step '${step.id}' cannot depend on itself`);
      }
    }
  }

  // 3. No cycles.
  const { hasCycle, cycleNodes } = topologicalSort(steps);
  if (hasCycle) {
    errors.push(
      `Workflow graph contains a cycle involving steps: ${cycleNodes.join(", ")}`,
    );
  }

  // 4. Sensible retry limits.
  for (const step of steps) {
    if (step.retryPolicy.maxRetries > 10) {
      errors.push(
        `Step '${step.id}' retry count exceeds maximum of 10`,
      );
    }
    if (step.timeoutMs > 600_000) {
      errors.push(
        `Step '${step.id}' timeout exceeds maximum of 600000ms`,
      );
    }
  }

  if (errors.length > 0) {
    return { ok: false, error: new WorkflowValidationError(errors) };
  }

  return { ok: true };
}

/**
 * Returns the set of step ids that are ready to execute given the current
 * set of completed step ids. A step is ready when all of its dependencies
 * have completed (or have no dependencies).
 */
export function getReadySteps(steps: Step[], completedIds: Set<string>): Step[] {
  return steps.filter((s) => {
    if (completedIds.has(s.id)) return false;
    return s.dependsOn.every((dep) => completedIds.has(dep));
  });
}

export interface ReadyStepGroup {
  /** Ids that have no remaining dependencies inside the batch (can start immediately). */
  ids: string[];
  /** Steps that depend on steps outside the group. */
  blocked: string[];
}

export function topoSortStepsById(
  steps: Step[],
): { byId: Map<string, Step>; levels: string[][] } {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const result = topologicalSort(steps);
  if (result.hasCycle) {
    return { byId, levels: [] };
  }
  // Group by depth.
  const depth = new Map<string, number>();
  for (const step of result.sorted) {
    const deps = step.dependsOn;
    const depDepth = deps.length === 0 ? -1 : Math.max(...deps.map((d) => depth.get(d) ?? -1));
    depth.set(step.id, depDepth + 1);
  }
  const maxDepth = result.sorted.reduce((m, s) => Math.max(m, depth.get(s.id) ?? 0), 0);
  const levels: string[][] = [];
  for (let d = 0; d <= maxDepth; d++) {
    levels.push(result.sorted.filter((s) => depth.get(s.id) === d).map((s) => s.id));
  }
  return { byId, levels };
}