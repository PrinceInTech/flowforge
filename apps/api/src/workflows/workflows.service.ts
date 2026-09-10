import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../db/database.service";
import { ApiError } from "../common/errors";
import { AuditService } from "../audit/audit.service";
import { validateWorkflowDefinition } from "@flowforge/shared";
import type { PublishWorkflowInput, WorkflowDefinitionInput } from "@flowforge/shared";

@Injectable()
export class WorkflowsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string, projectId?: string) {
    const params: unknown[] = [organizationId];
    let where = "wd.organization_id = $1";
    if (projectId) {
      params.push(projectId);
      where += " AND wd.project_id = $2";
    }
    const { rows } = await this.db.query(
      `SELECT wd.id, wd.organization_id, wd.project_id, wd.name, wd.description,
              wd.latest_version, wd.latest_version_id, wd.status,
              wd.created_at, wd.updated_at,
              p.name AS project_name,
              COALESCE(latest.created_at, wd.created_at) AS last_published_at
       FROM workflow_definitions wd
       JOIN projects p ON p.id = wd.project_id
       LEFT JOIN workflow_versions latest ON latest.id = wd.latest_version_id
       WHERE ${where}
       ORDER BY wd.created_at DESC`,
      params,
    );
    return rows;
  }

  async create(input: {
    organizationId: string;
    projectId: string;
    name: string;
    description?: string;
    userId: string;
  }) {
    const { rows } = await this.db.query(
      `INSERT INTO workflow_definitions
         (organization_id, project_id, name, description)
       VALUES ($1, $2, $3, $4)
       RETURNING id, organization_id, project_id, name, description,
                 latest_version, status, created_at, updated_at`,
      [input.organizationId, input.projectId, input.name, input.description ?? null],
    );
    return rows[0];
  }

  async get(workflowId: string, organizationId: string) {
    const { rows } = await this.db.query(
      `SELECT wd.id, wd.organization_id, wd.project_id, wd.name, wd.description,
              wd.latest_version, wd.latest_version_id, wd.status,
              wd.created_at, wd.updated_at, p.name AS project_name
       FROM workflow_definitions wd
       JOIN projects p ON p.id = wd.project_id
       WHERE wd.id = $1 AND wd.organization_id = $2`,
      [workflowId, organizationId],
    );
    if (rows.length === 0) throw ApiError.notFound("Workflow not found");
    return rows[0];
  }

  async getWithVersions(workflowId: string, organizationId: string) {
    const wf = await this.get(workflowId, organizationId);
    const { rows: versions } = await this.db.query(
      `SELECT v.id, v.workflow_definition_id, v.version, v.definition, v.status,
              v.created_by_user_id, v.created_at, v.updated_at,
              u.email AS created_by_email
       FROM workflow_versions v
       LEFT JOIN users u ON u.id = v.created_by_user_id
       WHERE v.workflow_definition_id = $1
       ORDER BY v.version ASC`,
      [workflowId],
    );
    return { workflow: wf, versions };
  }

  async getVersion(versionId: string, organizationId: string) {
    const { rows } = await this.db.query(
      `SELECT v.id, v.workflow_definition_id, v.version, v.definition, v.status,
              v.created_at, v.updated_at, u.email AS created_by_email,
              wd.organization_id
       FROM workflow_versions v
       JOIN workflow_definitions wd ON wd.id = v.workflow_definition_id
       LEFT JOIN users u ON u.id = v.created_by_user_id
       WHERE v.id = $1 AND wd.organization_id = $2`,
      [versionId, organizationId],
    );
    if (rows.length === 0) throw ApiError.notFound("Workflow version not found");
    return rows[0];
  }

  /**
   * Saves an editable draft then publishes it as the next immutable version.
   * Drafts are per-workflow: saving a draft replaces the previous draft.
   */
  async saveDraft(input: {
    organizationId: string;
    projectId: string;
    workflowId?: string;
    definition: PublishWorkflowInput["definition"];
    userId: string;
  }) {
    let workflowId = input.workflowId;
    if (!workflowId) {
      const created = await this.create({
        organizationId: input.organizationId,
        projectId: input.projectId,
        name: input.definition.name,
        description: input.definition.description,
        userId: input.userId,
      });
      workflowId = created.id;
    }

    const validation = this.validateDefinition(input.definition);
    if (!validation.ok) throw ApiError.badRequest(validation.error.message, validation.error.errors);

    const existing = await this.db.query(
      `SELECT id FROM workflow_versions
       WHERE workflow_definition_id = $1 AND (status = 'DRAFT' OR (version = 0 AND status = 'SUPERSEDED'))`,
      [workflowId],
    );
    if (existing.rows.length > 0) {
      await this.db.query(
        `UPDATE workflow_versions SET definition = $2, status = 'DRAFT' WHERE id = $1`,
        [existing.rows[0].id, JSON.stringify(input.definition)],
      );
      return { workflowId, draftVersionId: existing.rows[0].id, updated: true };
    }

    const { rows } = await this.db.query(
      `INSERT INTO workflow_versions (workflow_definition_id, version, definition, status, created_by_user_id)
       VALUES ($1, 0, $2, 'DRAFT', $3)
       RETURNING id`,
      [workflowId, JSON.stringify(input.definition), input.userId],
    );
    return { workflowId, draftVersionId: rows[0].id, updated: false };
  }

  async publish(input: {
    organizationId: string;
    workflowId: string;
    definition: PublishWorkflowInput["definition"];
    userId: string;
    draftVersionId?: string;
    ip?: string;
    userAgent?: string;
  }) {
    const wf = await this.get(input.workflowId, input.organizationId);

    const validation = this.validateDefinition(input.definition);
    if (!validation.ok) throw ApiError.badRequest(validation.error.message, validation.error.errors);

    if (input.draftVersionId) {
      const draft = await this.db.query(
        `SELECT id FROM workflow_versions
         WHERE id = $1 AND workflow_definition_id = $2 AND status = 'DRAFT'`,
        [input.draftVersionId, input.workflowId],
      );
      if (draft.rows.length > 0) {
        await this.db.query(
          `DELETE FROM workflow_versions WHERE id = $1`,
          [input.draftVersionId],
        );
      }
    }

    const { rows: nextRow } = await this.db.query(
      `SELECT COALESCE(MAX(version),0) + 1 AS next FROM workflow_versions
       WHERE workflow_definition_id = $1`,
      [input.workflowId],
    );
    const nextVersion = (nextRow[0].next as number) || 1;

    await this.db.query(
      `UPDATE workflow_versions SET status = 'SUPERSEDED'
       WHERE workflow_definition_id = $1 AND status IN ('DRAFT','PUBLISHED')`,
      [input.workflowId],
    );

    const { rows: versionRow } = await this.db.query(
      `INSERT INTO workflow_versions (workflow_definition_id, version, definition, status, created_by_user_id)
       VALUES ($1, $2, $3, 'PUBLISHED', $4)
       RETURNING id`,
      [input.workflowId, nextVersion, JSON.stringify(input.definition), input.userId],
    );
    const versionId = versionRow[0].id;

    await this.db.query(
      `UPDATE workflow_definitions
       SET name = $2, description = $3, latest_version = $4, latest_version_id = $5, status = 'PUBLISHED'
       WHERE id = $1`,
      [input.workflowId, input.definition.name, input.definition.description ?? null, nextVersion, versionId],
    );

    await this.audit.record({
      organizationId: input.organizationId,
      projectId: wf.project_id,
      userId: input.userId,
      action: "WORKFLOW_PUBLISHED",
      entityType: "WORKFLOW_VERSION",
      entityId: versionId,
      metadata: { workflowId: input.workflowId, version: nextVersion },
      ip: input.ip,
      userAgent: input.userAgent,
    });

    return { workflowId: input.workflowId, versionId, version: nextVersion, status: "PUBLISHED" };
  }

  async remove(workflowId: string, organizationId: string) {
    const { rowCount } = await this.db.query(
      `DELETE FROM workflow_definitions WHERE id = $1 AND organization_id = $2`,
      [workflowId, organizationId],
    );
    if (rowCount === 0) throw ApiError.notFound("Workflow not found");
  }

  private validateDefinition(definition: PublishWorkflowInput["definition"]) {
    return validateWorkflowDefinition(definition as WorkflowDefinitionInput);
  }
}