import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { http } from "../api/client";
import type { WorkflowDetail } from "../api/types";
import { useProjectStore } from "./projects-store";
import { Card, ErrorState, Loading, PageHeader } from "../components/ui";

const DEFAULT_DEFINITION = `{
  "name": "My workflow",
  "description": "Describe what this workflow does",
  "steps": [
    {
      "id": "greet",
      "name": "Build greeting",
      "type": "TRANSFORM",
      "dependsOn": [],
      "config": {
        "template": "Hello, {{ name }}!",
        "outputMode": "text"
      },
      "timeoutMs": 10000,
      "retryPolicy": { "maxRetries": 1, "backoffMs": 1000, "maxBackoffMs": 30000 }
    },
    {
      "id": "pause",
      "name": "Brief pause",
      "type": "DELAY",
      "dependsOn": ["greet"],
      "config": { "durationMs": 1000 },
      "timeoutMs": 15000,
      "retryPolicy": { "maxRetries": 0, "backoffMs": 1000, "maxBackoffMs": 10000 }
    }
  ]
}`;

type Def = {
  name: string;
  description?: string;
  steps: Array<{ id: string; name: string; type: string }>;
};

export default function WorkflowEditor() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const navigate = useNavigate();
  const { projects, loading: projectsLoading, load: loadProjects, selectedProjectId, selectProject } = useProjectStore();

  const [json, setJson] = useState(DEFAULT_DEFINITION);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!workflowId);
  const [saving, setSaving] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (!projects.length) return;
    setProjectId(selectedProjectId ?? projects[0].id);
  }, [projects, selectedProjectId]);

  useEffect(() => {
    if (!workflowId || loadedFor.current === workflowId) return;
    loadedFor.current = workflowId;
    setLoading(true);
    http
      .get<WorkflowDetail>(`/api/workflows/${workflowId}`)
      .then((d) => {
        const draft = d.versions.find((v) => v.status === "DRAFT");
        const latest = draft ?? d.versions.find((v) => v.id === d.workflow.latest_version_id);
        if (latest) setJson(JSON.stringify(latest.definition, null, 2));
        setProjectId(d.workflow.project_id);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [workflowId]);

  const runValidation = (text: string): Def | null => {
    setValidation([]);
    try {
      const parsed = JSON.parse(text) as Def;
      setNotice(null);
      return parsed;
    } catch (err) {
      setValidation([(err as Error).message]);
      return null;
    }
  };

  const doPublish = async (draftVersionId?: string) => {
    const parsed = runValidation(json);
    if (!parsed) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      if (workflowId) {
        const res = await http.post<{ version: number }>(`/api/workflows/${workflowId}/publish`, {
          definition: parsed,
          draftVersionId,
        });
        setNotice(`Published v${res.version}. This version is now immutable.`);
      } else {
        if (!projectId) {
          setValidation(["Select a project first"]);
          setSaving(false);
          return;
        }
        const created = await http.post<{ id: string }>("/api/workflows", {
          name: parsed.name,
          description: parsed.description ?? "",
          projectId,
        });
        const res = await http.post<{ version: number }>(`/api/workflows/${created.id}/publish`, {
          definition: parsed,
        });
        setNotice(`Workflow created and published to v${res.version}.`);
        navigate(`/workflows/${created.id}`);
      }
    } catch (err) {
      const e = err as { message?: string; details?: Array<{ path: string; message: string }> };
      if (e.details?.length) {
        setValidation(e.details.map((d) => `${d.path}: ${d.message}`));
      } else {
        setValidation([e.message ?? "Publish failed"]);
      }
    } finally {
      setSaving(false);
    }
  };

  const doSaveDraft = async () => {
    const parsed = runValidation(json);
    if (!parsed) return;
    setSavingDraft(true);
    setError(null);
    setNotice(null);
    try {
      if (workflowId) {
        const res = await http.post<{ workflowId: string; updated: boolean }>(
          "/api/workflows/draft",
          { workflowId, definition: parsed },
        );
        setNotice(`Draft saved${res.updated ? " (updated)" : ""}. Nothing published yet.`);
      } else {
        if (!projectId) {
          setValidation(["Select a project first"]);
          setSavingDraft(false);
          return;
        }
        const res = await http.post<{ workflowId: string; updated: boolean }>(
          "/api/workflows/draft",
          { projectId, definition: parsed },
        );
        setNotice("Draft saved. Nothing published yet.");
        navigate(`/workflows/${res.workflowId}/edit`);
      }
    } catch (err) {
      const e = err as { message?: string; details?: Array<{ path: string; message: string }> };
      if (e.details?.length) {
        setValidation(e.details.map((d) => `${d.path}: ${d.message}`));
      } else {
        setValidation([e.message ?? "Save draft failed"]);
      }
    } finally {
      setSavingDraft(false);
    }
  };

  if (loading) return <Loading label="Loading workflow…" />;
  if (error && !projectsLoading) return <ErrorState message={error} />;

  return (
    <div className="stack">
      <PageHeader
        title={workflowId ? "Edit workflow" : "New workflow"}
        subtitle="Edits create a new version — published versions are immutable and runs always snapshot them."
        actions={
          <Link to={workflowId ? `/workflows/${workflowId}` : "/workflows"} className="btn btn-secondary">
            Back
          </Link>
        }
      />

      {!workflowId && (
        <Card>
          <div className="row">
            <label className="field" style={{ marginBottom: 0, minWidth: 260 }}>
              <span>Project</span>
              <select
                value={projectId ?? ""}
                onChange={(e) => {
                  setProjectId(e.target.value);
                  if (e.target.value) selectProject(e.target.value);
                }}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted" style={{ maxWidth: 420, fontSize: 12.5 }}>
              Workflows are scoped to a project for tenancy and API-key access.
            </p>
          </div>
        </Card>
      )}

      <Card>
        <div className="spread">
          <h2>Definition (JSON)</h2>
          <span className="muted" style={{ fontSize: 12 }}>
            JSON validates as a DAG: unique ids, resolvable dependsOn, no cycles.
          </span>
        </div>
        <textarea
          className="code-input"
          value={json}
          onChange={(e) => setJson(e.target.value)}
          spellCheck={false}
          style={{ minHeight: 460, width: "100%" }}
        />
        {validation.length > 0 && (
          <div className="form-error" style={{ marginTop: 12, whiteSpace: "pre-wrap" }}>
            {validation.map((v, i) => (
              <div key={i}>• {v}</div>
            ))}
          </div>
        )}
        {notice && (
          <div className="demo-hint" style={{ marginTop: 12 }}>
            ✓ {notice}
          </div>
        )}
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn btn-secondary" onClick={() => void doSaveDraft()} disabled={saving || savingDraft}>
            {savingDraft ? "Saving draft…" : "Save Draft"}
          </button>
          <button className="btn btn-primary" onClick={() => void doPublish()} disabled={saving || savingDraft}>
            {saving ? "Publishing…" : workflowId ? "Publish new version" : "Create & publish"}
          </button>
          <span className="muted" style={{ fontSize: 12.5 }}>
            Save Draft stores an editable v0 without publishing.
          </span>
        </div>
      </Card>

      <Card>
        <h2>Step reference</h2>
        <div className="key-value" style={{ gridTemplateColumns: "220px 1fr" }}>
          <dt>HTTP_REQUEST</dt>
          <dd>
            Make an HTTP call. Config: <code>url</code> (required), <code>method</code>,{" "}
            <code>headers</code>, <code>body</code>, <code>timeoutMs</code>.
          </dd>
          <dt>DELAY</dt>
          <dd>
            Wait. Config: <code>durationMs</code>. The worker heartbeats the lease while waiting.
          </dd>
          <dt>TRANSFORM</dt>
          <dd>
            Restricted templating: <code>{"{{ field.path }}"}</code> placeholders resoled against the
            step input. No arbitrary code. Config: <code>template</code>, optional{" "}
            <code>outputMode: "text" | "json"</code>.
          </dd>
          <dt>dependsOn</dt>
          <dd>Ids of steps that must complete first. Empty array = root step (runs in parallel).</dd>
          <dt>retryPolicy</dt>
          <dd>
            <code>maxRetries</code> (0–10), <code>backoffMs</code>, <code>maxBackoffMs</code>. Retries use
            exponential backoff with full jitter.
          </dd>
        </div>
      </Card>
    </div>
  );
}