import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../db/database.service";
import { ApiError } from "../common/errors";

@Injectable()
export class ProjectsService {
  constructor(private readonly db: DatabaseService) {}

  async list(organizationId: string) {
    const { rows } = await this.db.query(
      `SELECT p.id, p.organization_id, p.name, p.slug, p.description, p.created_at, p.updated_at,
              (SELECT count(*)::int FROM workflow_definitions wd WHERE wd.project_id = p.id) AS workflow_count
       FROM projects p
       WHERE p.organization_id = $1
       ORDER BY p.created_at ASC`,
      [organizationId],
    );
    return rows;
  }

  async create(input: { organizationId: string; name: string; description?: string }) {
    const { rows } = await this.db.query(
      `INSERT INTO projects (organization_id, name, slug, description)
       VALUES ($1, $2, $3, $4)
       RETURNING id, organization_id, name, slug, description, created_at, updated_at`,
      [input.organizationId, input.name, this.slugify(input.name), input.description ?? null],
    );
    return rows[0];
  }

  async get(projectId: string, organizationId: string) {
    const { rows } = await this.db.query(
      `SELECT id, organization_id, name, slug, description, created_at, updated_at
       FROM projects WHERE id = $1 AND organization_id = $2`,
      [projectId, organizationId],
    );
    if (rows.length === 0) throw ApiError.notFound("Project not found");
    return rows[0];
  }

  private slugify(input: string): string {
    return (
      input
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48) || "project"
    );
  }
}