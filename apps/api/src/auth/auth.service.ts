import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { DatabaseService } from "../db/database.service";
import { RedisService } from "../redis/redis.service";
import { ApiError } from "../common/errors";
import { AuditService } from "../audit/audit.service";
import type { AuthSession, OrgRole } from "@flowforge/shared";
import { SignUpInput, SignInInput, AuthTokens } from "./auth.types";

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {}

  async signup(
    input: SignUpInput,
    meta: { ip?: string; userAgent?: string },
  ): Promise<AuthSession> {
    const passwordHash = hashPassword(input.password);

    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
      [input.email, passwordHash, input.name ?? null],
    );

    if (rows.length === 0) {
      throw ApiError.conflict("An account with this email already exists");
    }
    const userId = rows[0].id;

    const { rows: orgRows } = await this.db.query<{
      id: string;
      name: string;
      slug: string;
    }>(
      `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id, name, slug`,
      [
        "My Organization",
        `org-${randomBytes(4).toString("hex")}`,
      ],
    );
    const org = orgRows[0];

    await this.db.query(
      `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
      [org.id, userId],
    );

    await this.audit.record({
      organizationId: org.id,
      userId,
      action: "AUTH_SIGN_UP",
      entityType: "USER",
      entityId: userId,
      metadata: { email: input.email },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    const user = await this.getUser(userId);
    const tokens = await this.issueTokens(userId, user.email, user.name);
    return { user, organizations: [{ ...org, role: "OWNER" }], tokens };
  }

  async signin(
    input: SignInInput,
    meta: { ip?: string; userAgent?: string },
  ): Promise<AuthSession> {
    const { rows } = await this.db.query<{
      id: string;
      email: string;
      name: string | null;
      password_hash: string;
    }>(`SELECT id, email, name, password_hash FROM users WHERE email = $1`, [
      input.email,
    ]);
    if (rows.length === 0 || !verifyPassword(input.password, rows[0].password_hash)) {
      throw ApiError.unauthorized("Invalid email or password");
    }

    const user = rows[0];

    const { rows: orgRows } = await this.db.query<{
      id: string;
      name: string;
      slug: string;
      role: OrgRole;
    }>(
      `SELECT o.id, o.name, o.slug, m.role
       FROM organizations o
       JOIN organization_members m ON m.organization_id = o.id
       WHERE m.user_id = $1
       ORDER BY m.created_at ASC`,
      [user.id],
    );

    await this.audit.record({
      organizationId: orgRows[0]?.id ?? null,
      userId: user.id,
      action: "AUTH_SIGN_IN",
      entityType: "USER",
      entityId: user.id,
      metadata: {},
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    const tokens = await this.issueTokens(user.id, user.email, user.name);
    return {
      user: { id: user.id, email: user.email, name: user.name, createdAt: "", updatedAt: "" },
      organizations: orgRows,
      tokens,
    };
  }

  async refresh(
    refreshToken: string,
    meta: { ip?: string; userAgent?: string },
  ): Promise<AuthTokens> {
    const payload = await this.verifyRefreshToken(refreshToken).catch(() => {
      throw ApiError.unauthorized("Invalid refresh token");
    });

    const revoked = await this.redis.get(
      `flowforge:refresh:revoked:${payload.sessionId}`,
    );
    if (revoked) throw ApiError.unauthorized("Refresh token has been revoked");

    await this.db.query(`SELECT 1 FROM users WHERE id = $1`, [payload.sub]).then(
      (r) => {
        if (r.rows.length === 0) throw ApiError.unauthorized("User no longer exists");
      },
    );

    await this.audit.record({
      organizationId: null,
      userId: payload.sub,
      action: "AUTH_REFRESH",
      entityType: "USER",
      entityId: payload.sub,
      metadata: {},
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    // Rotate: revoke old session, issue fresh pair.
    await this.redis.setEx(`flowforge:refresh:revoked:${payload.sessionId}`, 60 * 60 * 24 * 30, "1");
    const { rows } = await this.db.query<{ email: string; name: string | null }>(
      `SELECT email, name FROM users WHERE id = $1`,
      [payload.sub],
    );
    return this.issueTokens(payload.sub, rows[0].email, rows[0].name);
  }

  async signout(userId: string, sessionId: string, meta: { ip?: string; userAgent?: string }) {
    await this.redis.setEx(`flowforge:session:revoked:${sessionId}`, 60 * 60 * 24, "1");
    await this.audit.record({
      organizationId: null,
      userId,
      action: "AUTH_SIGN_OUT",
      entityType: "USER",
      entityId: userId,
      metadata: {},
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  /**
   * Reconstructs the client session (user + memberships) from a valid access
   * token. Used by the SPA to restore state after a page reload.
   */
  async getSession(userId: string) {
    const user = await this.getUser(userId);
    const { rows: orgs } = await this.db.query<{ id: string; name: string; slug: string; role: OrgRole }>(
      `SELECT o.id, o.name, o.slug, m.role
       FROM organizations o
       JOIN organization_members m ON m.organization_id = o.id
       WHERE m.user_id = $1
       ORDER BY m.created_at ASC`,
      [userId],
    );
    return { user, organizations: orgs };
  }

  private async issueTokens(
    userId: string,
    email: string,
    name: string | null,
  ): Promise<AuthTokens> {
    const sessionId = randomBytes(24).toString("hex");
    const accessSecret =
      this.config.get<string>("JWT_ACCESS_SECRET") ?? "dev-access-secret-change-me";
    const refreshSecret =
      this.config.get<string>("JWT_REFRESH_SECRET") ?? "dev-refresh-secret-change-me";
    const accessTtl = parseInt(this.config.get("JWT_ACCESS_TTL") ?? "900", 10);
    const refreshTtl = parseInt(this.config.get("JWT_REFRESH_TTL") ?? "604800", 10);

    const accessToken = await this.jwt.signAsync(
      { sub: userId, email, name, sessionId },
      { secret: accessSecret, expiresIn: accessTtl },
    );
    const refreshToken = await this.jwt.signAsync(
      { sub: userId, email, name, sessionId, type: "refresh" },
      { secret: refreshSecret, expiresIn: refreshTtl },
    );
    return { accessToken, refreshToken, expiresIn: accessTtl };
  }

  private async verifyRefreshToken(token: string): Promise<{ sub: string; sessionId: string }> {
    const secret =
      this.config.get<string>("JWT_REFRESH_SECRET") ?? "dev-refresh-secret-change-me";
    const payload = await this.jwt.verifyAsync<{ sub: string; sessionId: string; type?: string }>(
      token,
      { secret },
    );
    if (payload.type !== "refresh") throw new Error("not a refresh token");
    return payload;
  }

  private async getUser(userId: string) {
    const { rows } = await this.db.query<{
      id: string;
      email: string;
      name: string | null;
    }>(`SELECT id, email, name FROM users WHERE id = $1`, [userId]);
    if (rows.length === 0) throw ApiError.notFound("User not found");
    return rows[0];
  }
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = createHash("sha256").update(`${salt}:${password}`).digest("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = createHash("sha256").update(`${salt}:${password}`).digest("hex");
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(candidate, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
