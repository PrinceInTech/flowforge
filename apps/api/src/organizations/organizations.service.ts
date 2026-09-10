import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../db/database.service";
import { slugify } from "@flowforge/shared";

@Injectable()
export class OrganizationsService {
  constructor(private readonly db: DatabaseService) {}

  async create(name: string, ownerUserId: string) {
    const { rows: [org] } = await this.db.query<{
      id: string;
      name: string;
      slug: string;
      created_at: string;
      updated_at: string;
    }>(
      `INSERT INTO organizations (name, slug) VALUES ($1, $2)
       RETURNING id, name, slug, created_at, updated_at`,
      [name, `${slugify(name)}-${Math.random().toString(36).slice(2, 8)}`],
    );
    await this.db.query(
      `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
      [org.id, ownerUserId],
    );
    return org;
  }

  async listForUser(userId: string) {
    const { rows } = await this.db.query(
      `SELECT o.id, o.name, o.slug, o.created_at, o.updated_at, m.role
       FROM organizations o
       JOIN organization_members m ON m.organization_id = o.id
       WHERE m.user_id = $1
       ORDER BY o.created_at ASC`,
      [userId],
    );
    return rows;
  }

  async get(orgId: string) {
    const { rows } = await this.db.query(
      `SELECT id, name, slug, created_at, updated_at FROM organizations WHERE id = $1`,
      [orgId],
    );
    return rows[0] ?? null;
  }

  async listMembers(orgId: string) {
    const { rows } = await this.db.query(
      `SELECT m.id, m.organization_id, m.user_id, m.role, m.created_at, m.updated_at,
              u.email, u.name
       FROM organization_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.organization_id = $1
       ORDER BY m.created_at ASC`,
      [orgId],
    );
    return rows;
  }

  async addMember(orgId: string, email: string, role: string) {
    const { rows: users } = await this.db.query<{ id: string }>(
      `SELECT id FROM users WHERE email = $1`,
      [email],
    );
    if (users.length === 0) return null;
    const userId = users[0].id;
    const { rows } = await this.db.query(
      `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role
       RETURNING id, organization_id, user_id, role, created_at, updated_at`,
      [orgId, userId, role],
    );
    return rows[0] ?? null;
  }

  async updateRole(orgId: string, userId: string, role: string) {
    const { rows } = await this.db.query(
      `UPDATE organization_members SET role = $3
       WHERE organization_id = $1 AND user_id = $2
       RETURNING id, organization_id, user_id, role, created_at, updated_at`,
      [orgId, userId, role],
    );
    return rows[0] ?? null;
  }

  async removeMember(orgId: string, userId: string) {
    const { rows } = await this.db.query(
      `DELETE FROM organization_members
       WHERE organization_id = $1 AND user_id = $2
       RETURNING id`,
      [orgId, userId],
    );
    return rows[0] ?? null;
  }
}