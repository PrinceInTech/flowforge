import { renderTemplate } from "@flowforge/shared";

export interface StepContext {
  stepRunId: string;
  workflowRunId: string;
  stepId: string;
  stepName: string;
  stepType: string;
  stepConfig: unknown;
  input: unknown;
  attempt: number;
  timeoutMs: number;
}

export interface ExecutionResult {
  ok: boolean;
  output?: unknown;
  errorMessage?: string;
}

export interface StepHost {
  /** Persist a structured log line onto the step run. */
  log(level: "info" | "warn" | "error", message: string): Promise<void>;
}

/**
 * Runs a step. Each executor is deliberately constrained:
 *  - HTTP uses fetch with a timeout and a same-supplied header set.
 *  - DELAY only waits (the caller heartbeats the lease during the wait).
 *  - TRANSFORM only interpolates `{{ path }}` placeholders; no eval, no JS.
 */
export async function executeStep(
  ctx: StepContext,
  host: StepHost,
): Promise<ExecutionResult> {
  switch (ctx.stepType) {
    case "HTTP_REQUEST":
      return executeHttp(ctx, host);
    case "DELAY":
      return executeDelay(ctx, host);
    case "TRANSFORM":
      return executeTransform(ctx, host);
    default:
      return { ok: false, errorMessage: `Unknown step type: ${ctx.stepType}` };
  }
}

async function executeHttp(ctx: StepContext, host: StepHost): Promise<ExecutionResult> {
  const config = (ctx.stepConfig ?? {}) as {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    timeoutMs?: number;
  };

  if (!config.url) return { ok: false, errorMessage: "HTTP step is missing url" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ctx.timeoutMs);

  try {
    await host.log(
      "info",
      `Attempt ${ctx.attempt}: ${config.method ?? "GET"} ${config.url}`,
    );
    const response = await fetch(config.url, {
      method: config.method ?? "GET",
      headers: { "user-agent": "flowforge-worker/1.0", ...(config.headers ?? {}) },
      body:
        config.body !== undefined && config.body !== null
          ? JSON.stringify(config.body)
          : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }

    if (!response.ok) {
      return {
        ok: false,
        errorMessage: `HTTP ${response.status} from ${config.url}`,
      };
    }
    return { ok: true, output: parsed };
  } catch (err) {
    const aborted = (err as { name?: string }).name === "AbortError";
    return {
      ok: false,
      errorMessage: aborted
        ? `HTTP request timed out after ${ctx.timeoutMs}ms`
        : `HTTP request failed: ${(err as Error).message}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function executeDelay(ctx: StepContext, host: StepHost): Promise<ExecutionResult> {
  const config = (ctx.stepConfig ?? {}) as { durationMs?: number };
  const duration = Math.max(1, Math.min(config.durationMs ?? 1_000, 86_400_000));

  await host.log("info", `Sleeping for ${duration}ms (timeout ${ctx.timeoutMs}ms)`);

  if (duration > ctx.timeoutMs) {
    return {
      ok: false,
      errorMessage: `DELAY of ${duration}ms exceeds the step timeout of ${ctx.timeoutMs}ms`,
    };
  }

  await new Promise<void>((resolve) => setTimeout(resolve, duration));
  return { ok: true, output: { sleptMs: duration } };
}

async function executeTransform(ctx: StepContext, host: StepHost): Promise<ExecutionResult> {
  const config = (ctx.stepConfig ?? {}) as { template?: string; outputMode?: string };

  if (typeof config.template !== "string") {
    return { ok: false, errorMessage: "TRANSFORM step is missing a template" };
  }
  if (config.template.length > 32_768) {
    return { ok: false, errorMessage: "TRANSFORM template exceeds 32 KiB" };
  }

  try {
    const rendered = renderTemplate(config.template, ctx.input);
    await host.log("info", `Rendered template -> ${rendered.slice(0, 200)}`);
    if (config.outputMode === "json") {
      try {
        return { ok: true, output: JSON.parse(rendered) };
      } catch {
        return {
          ok: false,
          errorMessage: "TRANSFORM output was not valid JSON",
        };
      }
    }
    return { ok: true, output: rendered };
  } catch (err) {
    return {
      ok: false,
      errorMessage: `TRANSFORM failed: ${(err as Error).message}`,
    };
  }
}