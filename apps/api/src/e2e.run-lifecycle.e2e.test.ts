import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module";
import { useLenientJsonBodyParser } from "./common/fastify-json.parser";

let app: NestFastifyApplication;
let baseUrl: string;

beforeAll(async () => {
  app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false, bodyLimit: 5 * 1024 * 1024 }),
    { abortOnError: false },
  );
  app.useGlobalFilters(
    new (await import("./common/global-exception.filter")).GlobalExceptionFilter(),
  );
  await app.init();
  useLenientJsonBodyParser(app);
  await app.listen(0, "127.0.0.1");
  const addr = app.getHttpServer().address() as { address: string; port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  if (app) await app.close();
});

function url(path: string) {
  return `${baseUrl}${path}`;
}

async function req<T = any>(
  method: string,
  path: string,
  opts: {
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<{ status: number; body: T }> {
  const http = await import("http");
  const u = new URL(url(path));
  return new Promise((resolve, reject) => {
    const r = http.request(
      u,
      {
        method,
        headers: { "content-type": "application/json", ...opts.headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString();
          let body: any;
          try {
            body = JSON.parse(raw);
          } catch {
            body = raw;
          }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    r.on("error", reject);
    if (opts.body !== undefined) r.write(JSON.stringify(opts.body));
    r.end();
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

async function signup(email: string, password: string) {
  const res = await req("POST", "/api/auth/signup", {
    body: { email, password, name: "E2E Test User" },
  });
  if (res.status !== 201) {
    throw new Error(`signup failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body as {
    user: { id: string; email: string };
    organizations: { id: string; name: string; role: string }[];
    tokens: { accessToken: string; refreshToken: string };
  };
}

function authHeaders(tokens: { accessToken: string }, orgId: string) {
  return {
    authorization: `Bearer ${tokens.accessToken}`,
    "x-organization-id": orgId,
  };
}

const WORKFLOW_DEF = {
  name: "E2E smoke workflow",
  description: "Runs in e2e tests",
  steps: [
    {
      id: "step_a",
      name: "Transform greeting",
      type: "TRANSFORM" as const,
      dependsOn: [],
      config: { template: "Hello, {{ name }}!", outputMode: "text" as const },
      timeoutMs: 5_000,
      retryPolicy: { maxRetries: 0, backoffMs: 1_000, maxBackoffMs: 5_000 },
    },
  ],
};

const FANOUT_WORKFLOW_DEF = {
  name: "E2E fan-out workflow",
  description: "Parallel branches merged by a join step referencing parent outputs",
  steps: [
    {
      id: "branchA",
      name: "Branch A: summarize",
      type: "TRANSFORM" as const,
      dependsOn: [],
      config: { template: "branch A done", outputMode: "text" as const },
      timeoutMs: 5_000,
      retryPolicy: { maxRetries: 0, backoffMs: 1_000, maxBackoffMs: 5_000 },
    },
    {
      id: "branchB",
      name: "Branch B: summarize",
      type: "TRANSFORM" as const,
      dependsOn: [],
      config: { template: "branch B done", outputMode: "text" as const },
      timeoutMs: 5_000,
      retryPolicy: { maxRetries: 0, backoffMs: 1_000, maxBackoffMs: 5_000 },
    },
    {
      id: "join",
      name: "Join results",
      type: "TRANSFORM" as const,
      dependsOn: ["branchA", "branchB"],
      config: {
        template: "{{ branchA }} + {{ branchB }}",
        outputMode: "text" as const,
      },
      timeoutMs: 10_000,
      retryPolicy: { maxRetries: 0, backoffMs: 1_000, maxBackoffMs: 5_000 },
    },
  ],
};

async function pollRun(
  runId: string,
  headers: Record<string, string>,
  { maxAttempts = 60, intervalMs = 500 } = {},
): Promise<{ status: string; steps: any[] }> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const res = await req("GET", `/api/runs/${runId}`, { headers });
    if (res.status === 200 && res.body?.run) {
      const { run, steps } = res.body as any;
      if (["COMPLETED", "FAILED", "CANCELLED", "DEAD_LETTER"].includes(run.status)) {
        return { status: run.status, steps };
      }
    }
  }
  throw new Error("Run did not reach terminal state within timeout");
}

// ───────────────────────────────────────────────────────────────────────────
// Tests
// ───────────────────────────────────────────────────────────────────────────

describe("E2E: run lifecycle and idempotency", () => {
  let session: Awaited<ReturnType<typeof signup>>;
  let orgId: string;
  let projectId: string;
  let workflowId: string;
  let draftWorkflowId: string;

  beforeAll(async () => {
    const ts = Date.now();
    session = await signup(`e2e_${ts}@test.io`, "test1234!!");
    orgId = session.organizations[0].id;
  });

  // ── Auth ────────────────────────────────────────────────────────────────

  it("signs up and returns a session", () => {
    expect(session.user.email).toContain("e2e_");
    expect(session.tokens.accessToken).toBeTruthy();
    expect(orgId).toBeTruthy();
  });

  it("restores session from access token", async () => {
    const res = await req("GET", "/api/auth/session", {
      headers: authHeaders(session.tokens, orgId),
    });
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(session.user.id);
  });

  // ── Project + Workflow ──────────────────────────────────────────────────

  it("creates a project", async () => {
    const res = await req("POST", "/api/projects", {
      body: { name: "E2E Project" },
      headers: authHeaders(session.tokens, orgId),
    });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    projectId = res.body.id;
  });

  it("lists projects", async () => {
    const res = await req("GET", "/api/projects", {
      headers: authHeaders(session.tokens, orgId),
    });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it("creates a workflow", async () => {
    const res = await req("POST", "/api/workflows", {
      body: { name: "E2E Workflow", description: "test", projectId },
      headers: authHeaders(session.tokens, orgId),
    });
    expect(res.status).toBe(201);
    workflowId = res.body.id;
    expect(workflowId).toBeTruthy();
  });

  it("publishes the workflow definition", async () => {
    const res = await req("POST", `/api/workflows/${workflowId}/publish`, {
      body: { definition: WORKFLOW_DEF },
      headers: authHeaders(session.tokens, orgId),
    });
    expect(res.status).toBe(202);
    expect(res.body.version).toBe(1);
    expect(res.body.status).toBe("PUBLISHED");
  });

  // ── Save draft ───────────────────────────────────────────────────────────

  it("saves a draft for a new workflow without publishing", async () => {
    const res = await req("POST", "/api/workflows/draft", {
      body: { projectId, definition: WORKFLOW_DEF },
      headers: authHeaders(session.tokens, orgId),
    });
    expect(res.status).toBe(201);
    expect(res.body.workflowId).toBeTruthy();
    expect(res.body.draftVersionId).toBeTruthy();
    expect(res.body.updated).toBe(false);
    draftWorkflowId = res.body.workflowId;

    const detail = await req("GET", `/api/workflows/${draftWorkflowId}`, {
      headers: authHeaders(session.tokens, orgId),
    });
    expect(detail.status).toBe(200);
    expect(detail.body.workflow.latest_version).toBe(0);
    expect(detail.body.workflow.status).toBe("DRAFT");
    const versions = detail.body.versions as any[];
    expect(versions.length).toBe(1);
    expect(versions[0].version).toBe(0);
    expect(versions[0].status).toBe("DRAFT");
  });

  it("re-saving a draft updates it in place at version 0", async () => {
    const res = await req("POST", "/api/workflows/draft", {
      body: {
        workflowId: draftWorkflowId,
        definition: { ...WORKFLOW_DEF, name: "E2E draft v2", description: "edited" },
      },
      headers: authHeaders(session.tokens, orgId),
    });
    expect(res.status).toBe(201);
    expect(res.body.updated).toBe(true);

    const detail = await req("GET", `/api/workflows/${draftWorkflowId}`, {
      headers: authHeaders(session.tokens, orgId),
    });
    const versions = detail.body.versions as any[];
    expect(versions.length).toBe(1);
    expect(versions[0].status).toBe("DRAFT");
    expect(versions[0].definition.name).toBe("E2E draft v2");
    expect(versions[0].definition.description).toBe("edited");
  });

  it("publishing leaves published versions immutable and drafts can resume at v0", async () => {
    const publishRes = await req("POST", `/api/workflows/${draftWorkflowId}/publish`, {
      body: { definition: { ...WORKFLOW_DEF, name: "E2E draft published" } },
      headers: authHeaders(session.tokens, orgId),
    });
    expect(publishRes.status).toBe(202);
    expect(publishRes.body.version).toBe(1);
    expect(publishRes.body.status).toBe("PUBLISHED");

    const draftRes = await req("POST", "/api/workflows/draft", {
      body: {
        workflowId: draftWorkflowId,
        definition: { ...WORKFLOW_DEF, name: "E2E next draft" },
      },
      headers: authHeaders(session.tokens, orgId),
    });
    expect(draftRes.status).toBe(201);

    const detail = await req("GET", `/api/workflows/${draftWorkflowId}`, {
      headers: authHeaders(session.tokens, orgId),
    });
    const versions = (detail.body.versions as any[]).sort(
      (a: any, b: any) => b.version - a.version,
    );
    expect(versions.length).toBe(2);
    expect(versions[0]).toMatchObject({ version: 1, status: "PUBLISHED" });
    expect(versions[0].definition.name).toBe("E2E draft published");
    expect(versions[1]).toMatchObject({ version: 0, status: "DRAFT" });
    expect(versions[1].definition.name).toBe("E2E next draft");
  });

  it("rejects draft save without authentication", async () => {
    const res = await req("POST", "/api/workflows/draft", {
      body: { projectId, definition: WORKFLOW_DEF },
    });
    expect(res.status).toBe(401);
  });

  it("rejects draft save on a workflow in another organization", async () => {
    const other = await signup(`e2e_other_${Date.now()}@test.io`, "test1234!!");
    const res = await req("POST", "/api/workflows/draft", {
      body: { workflowId, definition: WORKFLOW_DEF },
      headers: authHeaders(other.tokens, other.organizations[0].id),
    });
    expect(res.status).toBe(404);
  });

  // ── Run lifecycle ───────────────────────────────────────────────────────

  it("triggers a run and it completes", async () => {
    const triggerRes = await req("POST", "/api/runs/trigger", {
      body: { workflowId, payload: { name: "World" } },
      headers: authHeaders(session.tokens, orgId),
    });
    expect(triggerRes.status).toBe(202);
    expect(triggerRes.body.runId).toBeTruthy();
    expect(triggerRes.body.duplicate).toBe(false);

    const result = await pollRun(
      triggerRes.body.runId,
      authHeaders(session.tokens, orgId),
    );
    expect(result.status).toBe("COMPLETED");
    expect(result.steps.length).toBe(1);
    expect(result.steps[0].status).toBe("COMPLETED");
    expect(result.steps[0].output).toBe("Hello, World!");
  });

  it("restricts retry/cancel on runs to OWNER and DEVELOPER roles", async () => {
    const triggerRes = await req("POST", "/api/runs/trigger", {
      body: { workflowId, payload: { name: "RBAC" } },
      headers: authHeaders(session.tokens, orgId),
    });
    expect(triggerRes.status).toBe(202);
    const runId: string = triggerRes.body.runId;
    await pollRun(runId, authHeaders(session.tokens, orgId));

    const viewer = await signup(`e2e_viewer_${Date.now()}@test.io`, "test1234!!");
    const addRes = await req("POST", `/api/organizations/${orgId}/members`, {
      body: { email: viewer.user.email, role: "VIEWER" },
      headers: authHeaders(session.tokens, orgId),
    });
    expect(addRes.status).toBe(201);

    const viewerHeaders = authHeaders(viewer.tokens, orgId);
    const retryRes = await req("POST", `/api/runs/${runId}/retry`, {
      headers: viewerHeaders,
    });
    expect(retryRes.status).toBe(403);

    const cancelRes = await req("POST", `/api/runs/${runId}/cancel`, {
      headers: viewerHeaders,
    });
    expect(cancelRes.status).toBe(403);

    // An OWNER passes the role guard and reaches the service. A completed run is
    // not retryable, so this 400 (not 403) also proves the request was authorized.
    const ownerRetry = await req("POST", `/api/runs/${runId}/retry`, {
      headers: authHeaders(session.tokens, orgId),
    });
    expect(ownerRetry.status).toBe(400);
  });

  it("joins parallel branch outputs into the dependent step input", async () => {
    const createRes = await req("POST", "/api/workflows", {
      body: { name: "E2E Fanout", description: "fan-out join", projectId },
      headers: authHeaders(session.tokens, orgId),
    });
    expect(createRes.status).toBe(201);
    const fanoutWorkflowId = createRes.body.id;

    const publishRes = await req("POST", `/api/workflows/${fanoutWorkflowId}/publish`, {
      body: { definition: FANOUT_WORKFLOW_DEF },
      headers: authHeaders(session.tokens, orgId),
    });
    expect(publishRes.status).toBe(202);

    const triggerRes = await req("POST", "/api/runs/trigger", {
      body: { workflowId: fanoutWorkflowId, payload: {} },
      headers: authHeaders(session.tokens, orgId),
    });
    expect(triggerRes.status).toBe(202);

    const result = await pollRun(
      triggerRes.body.runId,
      authHeaders(session.tokens, orgId),
    );
    expect(result.status).toBe("COMPLETED");
    const join = result.steps.find((s: any) => s.step_id === "join");
    expect(join).toBeTruthy();
    expect(join.output).toBe("branch A done + branch B done");
  });

  // ── Idempotency ─────────────────────────────────────────────────────────

  it("returns the same run for duplicate idempotency key", async () => {
    const idempotencyKey = `e2e-idempotent-${Date.now()}`;

    const first = await req("POST", "/api/runs/trigger", {
      body: { workflowId, payload: { name: "Idempotent" } },
      headers: {
        ...authHeaders(session.tokens, orgId),
        "idempotency-key": idempotencyKey,
      },
    });
    expect(first.status).toBe(202);
    expect(first.body.duplicate).toBe(false);

    const second = await req("POST", "/api/runs/trigger", {
      body: { workflowId, payload: { name: "Idempotent" } },
      headers: {
        ...authHeaders(session.tokens, orgId),
        "idempotency-key": idempotencyKey,
      },
    });
    expect(second.status).toBe(202);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.runId).toBe(first.body.runId);
  });

  it("rejects same idempotency key with different payload", async () => {
    const idempotencyKey = `e2e-idempotent-conflict-${Date.now()}`;

    await req("POST", "/api/runs/trigger", {
      body: { workflowId, payload: { name: "First" } },
      headers: {
        ...authHeaders(session.tokens, orgId),
        "idempotency-key": idempotencyKey,
      },
    });

    const res = await req("POST", "/api/runs/trigger", {
      body: { workflowId, payload: { name: "Different" } },
      headers: {
        ...authHeaders(session.tokens, orgId),
        "idempotency-key": idempotencyKey,
      },
    });
    expect(res.status).toBe(409);
  });

  // ── Run listing + detail ────────────────────────────────────────────────

  it("lists runs with pagination", async () => {
    const res = await req("GET", "/api/runs?page=1&pageSize=5", {
      headers: authHeaders(session.tokens, orgId),
    });
    expect(res.status).toBe(200);
    expect(res.body.items).toBeDefined();
    expect(res.body.total).toBeGreaterThan(0);
    expect(res.body.items.length).toBeLessThanOrEqual(5);
  });

  it("retrieves run detail with step timeline", async () => {
    const listRes = await req("GET", "/api/runs?page=1&pageSize=1", {
      headers: authHeaders(session.tokens, orgId),
    });
    const runId = listRes.body.items[0].id;

    const res = await req("GET", `/api/runs/${runId}`, {
      headers: authHeaders(session.tokens, orgId),
    });
    expect(res.status).toBe(200);
    expect(res.body.run.id).toBe(runId);
    expect(Array.isArray(res.body.steps)).toBe(true);
  });

  // ── API keys ────────────────────────────────────────────────────────────

  it("creates and lists API keys", async () => {
    const projectId = (
      await req("GET", "/api/projects", {
        headers: authHeaders(session.tokens, orgId),
      })
    ).body[0].id;

    const createRes = await req("POST", "/api/api-keys", {
      body: { name: "E2E Key", projectId },
      headers: authHeaders(session.tokens, orgId),
    });
    expect(createRes.status).toBe(201);
    expect(createRes.body.key).toMatch(/^ff_/);

    const listRes = await req("GET", "/api/api-keys", {
      headers: authHeaders(session.tokens, orgId),
    });
    expect(listRes.status).toBe(200);
    expect(listRes.body.some((k: any) => k.name === "E2E Key")).toBe(true);
  });

  // ── Schedules ───────────────────────────────────────────────────────────

  it("creates a schedule", async () => {
    const res = await req("POST", "/api/schedules", {
      body: {
        workflowId,
        projectId: (
          await req("GET", "/api/projects", {
            headers: authHeaders(session.tokens, orgId),
          })
        ).body[0].id,
        name: "E2E Schedule",
        cron: "0 * * * *",
        timezone: "UTC",
        enabled: true,
        payload: { name: "Scheduled" },
      },
      headers: authHeaders(session.tokens, orgId),
    });
    expect(res.status).toBe(201);
  });

  // ── Ops metrics ─────────────────────────────────────────────────────────

  it("returns Prometheus metrics", async () => {
    const res = await req("GET", "/api/metrics", {});
    expect(res.status).toBe(200);
    expect(typeof res.body).toBe("string");
    expect(res.body).toContain("flowforge");
  });

  it("returns ops metrics JSON", async () => {
    const res = await req("GET", "/api/ops/metrics", {});
    expect(res.status).toBe(200);
    expect(typeof res.body.queueBacklog).toBe("number");
    expect(typeof res.body.workersUp).toBe("number");
  });

  // ── Health ──────────────────────────────────────────────────────────────

  it("returns health check", async () => {
    const res = await req("GET", "/api/health", {});
    expect(res.status).toBe(200);
  });

  it("returns ready check", async () => {
    const res = await req("GET", "/api/health/ready", {});
    expect(res.status).toBe(200);
  });
});
