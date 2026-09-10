import { Reflector } from "@nestjs/core";
import { OrganizationGuard } from "./organization.guard";
import { ApiError } from "./errors";

function makeContext(overrides: {
  user?: { userId: string };
  apiKey?: unknown;
  orgHeader?: string;
  roles?: string[];
}): any {
  const req: Record<string, unknown> = {
    headers: overrides.orgHeader
      ? { "x-organization-id": overrides.orgHeader }
      : {},
    ...(overrides.user ? { user: overrides.user } : {}),
    ...(overrides.apiKey ? { apiKey: overrides.apiKey } : {}),
  };
  const ctx = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => req }),
  };
  const reflector = {
    getAllAndOverride: (key: string) =>
      key === "roles" ? overrides.roles ?? undefined : false,
  } as unknown as Reflector;
  return { ctx, req, reflector, guard: new OrganizationGuard({} as any, reflector) };
}

describe("OrganizationGuard", () => {
  it("rejects requests without X-Organization-Id", async () => {
    const { ctx, guard } = makeContext({ user: { userId: "u1" } });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ApiError);
  });

  it("rejects non-members", async () => {
    const { ctx, guard, req } = makeContext({
      user: { userId: "u1" },
      orgHeader: "org-1",
    });
    const db = {
      query: async () => ({ rows: [] }),
    };
    (guard as any).db = db;
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ApiError);
    void req;
  });

  it("accepts members with sufficient role", async () => {
    const { ctx, guard, req } = makeContext({
      user: { userId: "u1" },
      orgHeader: "org-1",
      roles: ["OWNER", "DEVELOPER"],
    });
    const db = {
      query: async () => ({ rows: [{ role: "DEVELOPER" }] }),
    };
    (guard as any).db = db;
    const ok = await guard.canActivate(ctx);
    expect(ok).toBe(true);
    expect((req as Record<string, unknown>).membership).toEqual({
      organizationId: "org-1",
      role: "DEVELOPER",
    });
  });

  it("rejects members without an adequate role", async () => {
    const { ctx, guard } = makeContext({
      user: { userId: "u1" },
      orgHeader: "org-1",
      roles: ["OWNER"],
    });
    const db = {
      query: async () => ({ rows: [{ role: "VIEWER" }] }),
    };
    (guard as any).db = db;
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ApiError);
  });

  it("lets API-key authenticated requests through", async () => {
    const { ctx, guard } = makeContext({ apiKey: { keyId: "k1", projectId: "p1" } });
    const ok = await guard.canActivate(ctx);
    expect(ok).toBe(true);
  });
});