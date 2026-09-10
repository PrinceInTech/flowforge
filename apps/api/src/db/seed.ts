import { Pool } from "pg";
import { createHash, randomBytes } from "crypto";
import { hashApiKey } from "@flowforge/shared";
import {
  validateWorkflowDefinition,
} from "@flowforge/shared";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://flowforge:flowforge@localhost:5432/flowforge";

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = createHash("sha256").update(`${salt}:${password}`).digest("hex");
  return `${salt}:${hash}`;
}

interface DemoWorkflow {
  name: string;
  description: string;
  definition: {
    name: string;
    description?: string;
    steps: unknown[];
  };
}

const DEMO_WORKFLOWS: DemoWorkflow[] = [
  {
    name: "HTTP fetch -> transform -> delay",
    description:
      "Sequential demo workflow: fetches a JSON payload, transforms it with a template, then waits one second.",
    definition: {
      name: "Sequential fetch-transform-delay",
      description:
        "Fetches https://httpbin.org/json, extracts the title via a restricted template, then delays.",
      steps: [
        {
          id: "fetch",
          name: "Fetch sample JSON",
          type: "HTTP_REQUEST",
          dependsOn: [],
          config: {
            url: "https://httpbin.org/json",
            method: "GET",
            headers: { accept: "application/json" },
            body: undefined,
            timeoutMs: 15000,
          },
          timeoutMs: 20000,
          retryPolicy: { maxRetries: 2, backoffMs: 5000, maxBackoffMs: 30000 },
        },
        {
          id: "transform",
          name: "Extract title",
          type: "TRANSFORM",
          dependsOn: ["fetch"],
          config: {
            template: '{{ slideshow.title }} fetched successfully',
            outputMode: "text",
          },
          timeoutMs: 10000,
          retryPolicy: { maxRetries: 2, backoffMs: 1000, maxBackoffMs: 10000 },
        },
        {
          id: "delay-then-done",
          name: "Delay 1s",
          type: "DELAY",
          dependsOn: ["transform"],
          config: { durationMs: 1000 },
          timeoutMs: 15000,
          retryPolicy: { maxRetries: 0, backoffMs: 1000, maxBackoffMs: 10000 },
        },
      ],
    },
  },
  {
    name: "Parallel fan-out",
    description:
      "Runs two independent delay + transform branches in parallel, then joins with a final transform step.",
    definition: {
      name: "Parallel branches with join",
      description:
        "Pushes the input payload into two parallel branches and joins results.",
      steps: [
        {
          id: "branchA",
          name: "Branch A: delay",
          type: "DELAY",
          dependsOn: [],
          config: { durationMs: 200 },
          timeoutMs: 15000,
          retryPolicy: { maxRetries: 1, backoffMs: 1000, maxBackoffMs: 10000 },
        },
        {
          id: "branchB",
          name: "Branch B: delay",
          type: "DELAY",
          dependsOn: [],
          config: { durationMs: 800 },
          timeoutMs: 15000,
          retryPolicy: { maxRetries: 1, backoffMs: 1000, maxBackoffMs: 10000 },
        },
        {
          id: "branchAOut",
          name: "Branch A: summarize",
          type: "TRANSFORM",
          dependsOn: ["branchA"],
          config: { template: "branch A done", outputMode: "text" },
          timeoutMs: 10000,
          retryPolicy: { maxRetries: 1, backoffMs: 1000, maxBackoffMs: 10000 },
        },
        {
          id: "branchBOut",
          name: "Branch B: summarize",
          type: "TRANSFORM",
          dependsOn: ["branchB"],
          config: { template: "branch B done", outputMode: "text" },
          timeoutMs: 10000,
          retryPolicy: { maxRetries: 1, backoffMs: 1000, maxBackoffMs: 10000 },
        },
        {
          id: "join",
          name: "Join results",
          type: "TRANSFORM",
          dependsOn: ["branchAOut", "branchBOut"],
          config: { template: "{{ branchAOut }} + {{ branchBOut }}", outputMode: "text" },
          timeoutMs: 10000,
          retryPolicy: { maxRetries: 0, backoffMs: 1000, maxBackoffMs: 10000 },
        },
      ],
    },
  },
  {
    name: "Intentionally failing workflow",
    description:
      "A workflow whose HTTP fetch always fails. It visibly retries with backoff and eventually lands in FAILED — the frontend retry button can then be demonstrated.",
    definition: {
      name: "Deliberately failing workflow",
      description:
        "Calls an unreachable URL across a private network range so every attempt fails.",
      steps: [
        {
          id: "try-1",
          name: "Attempt 1: unreachable fetch",
          type: "HTTP_REQUEST",
          dependsOn: [],
          config: {
            url: "http://10.255.255.1:8080/ping",
            method: "GET",
            headers: {},
            body: undefined,
            timeoutMs: 3000,
          },
          timeoutMs: 10000,
          retryPolicy: { maxRetries: 3, backoffMs: 500, maxBackoffMs: 4000 },
        },
      ],
    },
  },
  {
    name: "Greeting echo",
    description:
      "Echoes the payload through a transform and a short delay: a good demonstration of manual triggering with custom input.",
    definition: {
      name: "Greeting echo",
      description: "Echoes the payload field 'name' back.",
      steps: [
        {
          id: "echo",
          name: "Build greeting",
          type: "TRANSFORM",
          dependsOn: [],
          config: { template: "Hello, {{ name }}!", outputMode: "text" },
          timeoutMs: 10000,
          retryPolicy: { maxRetries: 1, backoffMs: 1000, maxBackoffMs: 10000 },
        },
        {
          id: "pause",
          name: "Brief pause",
          type: "DELAY",
          dependsOn: ["echo"],
          config: { durationMs: 500 },
          timeoutMs: 15000,
          retryPolicy: { maxRetries: 0, backoffMs: 1000, maxBackoffMs: 10000 },
        },
      ],
    },
  },
];

const DEMO_EMAIL = "demo@flowforge.dev";
const DEMO_PASSWORD = "flowforge-demo";

async function main() {
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.DB_SSL === "true",
  });
  const client = await pool.connect();
  try {
    const orgCount = await client.query(`SELECT count(*)::int AS n FROM organizations`);
    if (orgCount.rows[0].n > 0) {
      console.log("Database already seeded — skipping.");
      return;
    }

    console.log("Seeding demo data...");

    const { rows: [user] } = await client.query(
      `INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id`,
      [DEMO_EMAIL, hashPassword(DEMO_PASSWORD), "FlowForge Demo User"],
    );

    const { rows: [org] } = await client.query(
      `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
      ["Demo Org", "demo-org"],
    );

    await client.query(
      `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
      [org.id, user.id],
    );

    const { rows: [project] } = await client.query(
      `INSERT INTO projects (organization_id, name, slug, description) VALUES ($1, $2, $3, $4) RETURNING id`,
      [org.id, "Demo Project", "demo-project", "Demo project with example workflows"],
    );

    const rawApiKey = `ff_${randomBytes(32).toString("hex")}`;
    await client.query(
      `INSERT INTO api_keys (organization_id, project_id, name, prefix, key_hash) VALUES ($1, $2, $3, $4, $5)`,
      [org.id, project.id, "Demo API Key", "ff_" + rawApiKey.slice(3, 11), hashApiKey(rawApiKey)],
    );

    for (const wf of DEMO_WORKFLOWS) {
      const validation = validateWorkflowDefinition(
        wf.definition as never,
      );
      if (!validation.ok) {
        console.error(`Demo workflow '${wf.name}' failed validation:`, validation.error.message);
        process.exit(1);
      }

      const { rows: [definition] } = await client.query(
        `INSERT INTO workflow_definitions (organization_id, project_id, name, description, latest_version, status)
         VALUES ($1, $2, $3, $4, 1, 'PUBLISHED') RETURNING id`,
        [org.id, project.id, wf.name, wf.description],
      );

      const { rows: [version] } = await client.query(
        `INSERT INTO workflow_versions (workflow_definition_id, version, definition, status, created_by_user_id)
         VALUES ($1, 1, $2, 'PUBLISHED', $3) RETURNING id`,
        [definition.id, JSON.stringify(wf.definition), user.id],
      );

      await client.query(
        `UPDATE workflow_definitions SET latest_version = 1, latest_version_id = $2 WHERE id = $1`,
        [definition.id, version.id],
      );

      await client.query(
        `INSERT INTO workflow_schedules (organization_id, project_id, workflow_definition_id, workflow_version_id, name, cron, timezone, enabled, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, $8)`,
        [
          org.id, project.id, definition.id, version.id,
          `${wf.name} every hour`,
          "0 * * * *", "UTC", JSON.stringify({ seeded: true }),
        ],
      );
    }

    await client.query(
      `INSERT INTO audit_logs (organization_id, project_id, user_id, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, $3, 'ORG_CREATED', 'ORGANIZATION', $4, $5::jsonb)`,
      [org.id, project.id, user.id, org.id, '{"note":"seeded"}'],
    );

    console.log("Seeded demo org + workflows.");
    console.log("\nDemo credentials:");
    console.log(`  email:    ${DEMO_EMAIL}`);
    console.log(`  password: ${DEMO_PASSWORD}`);
    console.log(`  api key:  ${rawApiKey}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});