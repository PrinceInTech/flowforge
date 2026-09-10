import { randomUUID, createHash } from "crypto";

export function generateId(): string {
  return randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Full-jitter exponential backoff: delay = min(maxBackoff, backoffMs * 2^attempt) * rand(0..1).
 * Jitter prevents thundering-herd retries when many steps fail together.
 */
export function computeRetryDelayMs(
  attempt: number,
  backoffMs: number,
  maxBackoffMs: number,
): number {
  if (attempt <= 0) return Math.min(backoffMs, maxBackoffMs);
  const exponential = backoffMs * Math.pow(2, attempt);
  const capped = Math.min(exponential, maxBackoffMs);
  return Math.floor(Math.random() * capped);
}

export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

export function generateApiKeyPrefix(rawKey: string): string {
  return rawKey.slice(0, 8);
}

/**
 * Generate a random API key in the form `ff_<32 hex chars>`.
 */
export function generateApiKey(): string {
  return `ff_${randomBytesHex(32)}`;
}

function randomBytesHex(bytes: number): string {
const buf = Buffer.alloc(bytes);
  try {
    const crypto = require("crypto");
    crypto.randomFillSync(buf);
  } catch {
    for (let i = 0; i < bytes; i++) buf[i] = Math.floor(Math.random() * 256);
  }
  return buf.toString("hex");
}

/**
 * Safely interpolate `{{ field.path }}` placeholders in a template using values
 * from an input object. Keys are restricted to alphanumeric + underscore, and
 * unknown paths render as the empty string. No code execution of any kind.
 */
export function renderTemplate(template: string, input: unknown): string {
  const value = (input ?? {}) as Record<string, unknown>;

  const getPath = (path: string): unknown => {
    const parts = path.split(".").filter(Boolean);
    let current: unknown = value;
    for (const part of parts) {
      if (typeof current !== "object" || current === null) return undefined;
      current = (current as Record<string, unknown>)[part];
      if (current === undefined) return undefined;
    }
    return current;
  };

  const safeTemplate = template.replace(
    /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g,
    (_match, path: string) => {
      const resolved = getPath(path);
      if (resolved === undefined || resolved === null) return "";
      if (typeof resolved === "object") return JSON.stringify(resolved);
      return String(resolved);
    },
  );

  return safeTemplate;
}

/**
 * Parses an ISO date string that may not have a trailing Z (Postgres returns
 * `YYYY-MM-DDTHH:MM:SS.mmm` without the Z) into a valid ISO 8601 string.
 */
export function normalizeIsoDate(input: string | Date): string {
  if (input instanceof Date) return input.toISOString();
  if (typeof input === "string") {
    if (input.endsWith("Z")) return input;
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(input)) {
      const date = new Date(input);
      if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
  }
  return String(input);
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "untitled";
}