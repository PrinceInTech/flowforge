import { describe, expect, it } from "vitest";
import {
  validateWorkflowDefinition,
  getReadySteps,
  topoSortStepsById,
} from "../src/workflow-graph";
import type { Step } from "../src/types";

const baseStep = (over: Partial<Step>): Step => ({
  id: "a",
  name: "A",
  type: "DELAY",
  dependsOn: [],
  config: { durationMs: 100 },
  timeoutMs: 120_000,
  retryPolicy: { maxRetries: 3, backoffMs: 1_000, maxBackoffMs: 60_000 },
  ...over,
});

describe("validateWorkflowDefinition", () => {
  it("accepts a valid sequential DAG", () => {
    const result = validateWorkflowDefinition({
      name: "seq",
      steps: [
        baseStep({ id: "a" }),
        baseStep({ id: "b", dependsOn: ["a"] }),
        baseStep({ id: "c", dependsOn: ["b"] }),
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a valid parallel DAG", () => {
    const result = validateWorkflowDefinition({
      name: "par",
      steps: [
        baseStep({ id: "a" }),
        baseStep({ id: "b" }),
        baseStep({ id: "c", dependsOn: ["a", "b"] }),
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects duplicate step ids", () => {
    const result = validateWorkflowDefinition({
      name: "dup",
      steps: [baseStep({ id: "a" }), baseStep({ id: "a" })],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.errors.join()).toContain("Duplicate");
    }
  });

  it("rejects unknown dependencies", () => {
    const result = validateWorkflowDefinition({
      name: "bad-dep",
      steps: [baseStep({ id: "a", dependsOn: ["ghost"] })],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.errors.join()).toContain("ghost");
    }
  });

  it("rejects cycles", () => {
    const result = validateWorkflowDefinition({
      name: "cycle",
      steps: [
        baseStep({ id: "a", dependsOn: ["b"] }),
        baseStep({ id: "b", dependsOn: ["a"] }),
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.errors.join()).toContain("cycle");
    }
  });

  it("rejects retries beyond the maximum", () => {
    const result = validateWorkflowDefinition({
      name: "retry",
      steps: [
        baseStep({
          id: "a",
          retryPolicy: { maxRetries: 100, backoffMs: 1000, maxBackoffMs: 60000 },
        }),
      ],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects empty selections", () => {
    const result = validateWorkflowDefinition({ name: "empty", steps: [] });
    expect(result.ok).toBe(false);
  });
});

describe("getReadySteps", () => {
  const steps: Step[] = [
    baseStep({ id: "a" }),
    baseStep({ id: "b", dependsOn: ["a"] }),
    baseStep({ id: "c", dependsOn: ["a"] }),
    baseStep({ id: "d", dependsOn: ["b", "c"] }),
  ];

  it("returns root steps first", () => {
    const ready = getReadySteps(steps, new Set());
    expect(ready.map((s) => s.id).sort()).toEqual(["a"]);
  });

  it("unlocks children as parents complete", () => {
    const ready = getReadySteps(steps, new Set(["a"]));
    expect(ready.map((s) => s.id).sort()).toEqual(["b", "c"]);
  });

  it("does not return completed steps", () => {
    const ready = getReadySteps(steps, new Set(["a", "b", "c"]));
    expect(ready.map((s) => s.id)).toEqual(["d"]);
  });
});

describe("topoSortStepsById", () => {
  it("produces topological levels for parallel groups", () => {
    const { levels } = topoSortStepsById([
      baseStep({ id: "a" }),
      baseStep({ id: "b" }),
      baseStep({ id: "c", dependsOn: ["a", "b"] }),
    ]);
    expect(levels).toEqual([["a", "b"], ["c"]]);
  });
});