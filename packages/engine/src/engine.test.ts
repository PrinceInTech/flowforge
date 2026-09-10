import { describe, expect, it } from "vitest";
import { computeReadySteps, computeStepInput } from "./engine";

const pendingStep = (over: Partial<{ id: string; step_id: string; status: string; dependsOn: string[] }>) => ({
  id: "",
  step_id: "a",
  step_name: "A",
  step_type: "DELAY",
  step_config: { durationMs: 1 },
  status: "PENDING",
  attempt: 0,
  max_retries: 0,
  ...over,
});

describe("computeStepInput", () => {
  const definitionSteps = [
    { id: "join", dependsOn: ["a", "b"] as string[] },
  ];

  it("gives a dependent step its parents' outputs keyed by step id", () => {
    const steps = [
      pendingStep({ step_id: "a", status: "COMPLETED", output: { title: "Alpha" } }),
      pendingStep({ step_id: "b", status: "COMPLETED", output: { title: "Beta" } }),
      pendingStep({ step_id: "join", dependsOn: ["a", "b"] }),
    ];
    const input = computeStepInput({
      stepId: "join",
      definitionSteps,
      steps,
      runPayload: { seed: true },
    });
    expect(input).toEqual({
      a: { title: "Alpha" },
      b: { title: "Beta" },
    });
  });

  it("falls back to a null parent output when a parent has no output", () => {
    const steps = [
      pendingStep({ step_id: "a", status: "COMPLETED", output: undefined }),
      pendingStep({ step_id: "join", dependsOn: ["a"] }),
    ];
    const input = computeStepInput({
      stepId: "join",
      definitionSteps: [{ id: "join", dependsOn: ["a"] }],
      steps,
      runPayload: { seed: true },
    });
    expect(input).toEqual({ a: null });
  });

  it("lets a root step inherit the run payload", () => {
    const steps = [pendingStep({ step_id: "a" })];
    const input = computeStepInput({
      stepId: "a",
      definitionSteps: [{ id: "a", dependsOn: [] }],
      steps,
      runPayload: { hello: "world" },
    });
    expect(input).toEqual({ hello: "world" });
  });
});

describe("computeReadySteps", () => {
  it("marks root steps as ready when no deps are completed yet", () => {
    const steps = [
      pendingStep({ step_id: "a" }),
      pendingStep({ step_id: "b", dependsOn: ["a"] }),
    ];
    const ready = computeReadySteps(
      [
        { step_id: "a", dependsOn: [] },
        { step_id: "b", dependsOn: ["a"] },
      ],
      steps,
    );
    expect(ready.map((s) => s.step_id)).toEqual(["a"]);
  });

  it("wakes a step once every dependency completed", () => {
    const steps = [
      pendingStep({ step_id: "a", status: "COMPLETED" }),
      pendingStep({ step_id: "b", status: "COMPLETED" }),
      pendingStep({ step_id: "c", dependsOn: ["a", "b"] }),
    ];
    const ready = computeReadySteps(
      [
        { step_id: "a", dependsOn: [] },
        { step_id: "b", dependsOn: [] },
        { step_id: "c", dependsOn: ["a", "b"] },
      ],
      steps,
    );
    expect(ready.map((s) => s.step_id)).toEqual(["c"]);
  });

  it("never returns non-PENDING steps", () => {
    const steps = [
      pendingStep({ step_id: "a", status: "READY" }),
      pendingStep({ step_id: "b", status: "FAILED" }),
    ];
    const ready = computeReadySteps(
      [
        { step_id: "a", dependsOn: [] },
        { step_id: "b", dependsOn: [] },
      ],
      steps,
    );
    expect(ready).toEqual([]);
  });
});