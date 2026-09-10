import { describe, expect, it } from "vitest";
import {
  TriggerRunSchema,
  RunListQuerySchema,
  CreateWorkflowSchema,
  CreateApiKeySchema,
  CreateScheduleSchema,
} from "./validation";

describe("TriggerRunSchema", () => {
  it("requires a workflowId", () => {
    expect(TriggerRunSchema.safeParse({ workflowId: "wf_1", payload: { x: 1 } }).success).toBe(true);
    expect(TriggerRunSchema.safeParse({ payload: { x: 1 } }).success).toBe(false);
  });

  it("defaults payload to an empty object", () => {
    const parsed = TriggerRunSchema.safeParse({ workflowId: "wf_1" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.payload).toEqual({});
  });
});

describe("RunListQuerySchema", () => {
  it("passes an optional projectId through", () => {
    const parsed = RunListQuerySchema.safeParse({ page: 1, projectId: "proj_9" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.projectId).toBe("proj_9");
  });
});

describe("CreateWorkflowSchema", () => {
  it("requires a projectId", () => {
    expect(CreateWorkflowSchema.safeParse({ name: "w", projectId: "p1" }).success).toBe(true);
    expect(CreateWorkflowSchema.safeParse({ name: "w" }).success).toBe(false);
  });
});

describe("CreateApiKeySchema", () => {
  it("requires a projectId", () => {
    expect(CreateApiKeySchema.safeParse({ name: "k", projectId: "p1" }).success).toBe(true);
    expect(CreateApiKeySchema.safeParse({ name: "k" }).success).toBe(false);
  });
});

describe("CreateScheduleSchema", () => {
  it("requires a projectId alongside the workflowId", () => {
    const good = CreateScheduleSchema.safeParse({
      workflowId: "wf_1",
      projectId: "p1",
      name: "s",
      cron: "* * * * *",
    });
    expect(good.success).toBe(true);
    expect(CreateScheduleSchema.safeParse({ workflowId: "wf_1", name: "s", cron: "* * * * *" }).success).toBe(false);
  });
});