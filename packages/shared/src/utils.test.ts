import { describe, expect, it } from "vitest";
import { computeRetryDelayMs, renderTemplate, hashApiKey } from "../src/utils";

describe("computeRetryDelayMs", () => {
  it("returns base backoff for the first attempt", () => {
    expect(computeRetryDelayMs(1, 1000, 60000)).toBeGreaterThanOrEqual(0);
    expect(computeRetryDelayMs(1, 1000, 60000)).toBeLessThanOrEqual(2000);
  });

  it("caps at maxBackoff regardless of attempt", () => {
    for (let i = 0; i < 100; i++) {
      const delay = computeRetryDelayMs(20, 1000, 5000);
      expect(delay).toBeLessThanOrEqual(5000);
    }
  });

  it("is bounded, never negative", () => {
    expect(computeRetryDelayMs(0, 100, 5000)).toBeGreaterThanOrEqual(0);
  });
});

describe("renderTemplate", () => {
  it("interpolates nested paths", () => {
    expect(renderTemplate("{{ a.b }}!", { a: { b: "hi" } })).toBe("hi!");
  });

  it("renders missing paths as empty strings", () => {
    expect(renderTemplate("<{{ missing.path }}>", { x: 1 })).toBe("<>");
  });

  it("serializes object values as JSON", () => {
    expect(renderTemplate("{{ obj }}", { obj: { a: 1 } })).toBe('{"a":1}');
  });

  it("does NOT interpret code syntax (template engine is strictly interpolative)", () => {
    const template = "{{ process }} {{ 1 + 1 }}";
    const out = renderTemplate(template, {});
    expect(out).toBe(" {{ 1 + 1 }}");
    expect(template).toContain("process");
  });
});

describe("hashApiKey", () => {
  it("is deterministic and hex", () => {
    const h1 = hashApiKey("ff_abc");
    const h2 = hashApiKey("ff_abc");
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never returns the plaintext", () => {
    expect(hashApiKey("ff_secret_123")).not.toContain("secret");
  });
});