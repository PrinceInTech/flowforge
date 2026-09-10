import { useEffect, useState } from "react";
import { http } from "../api/client";
import type { Project } from "../api/types";
import { useProjectStore } from "./projects-store";
import {
  Card,
  CopyButton,
  EmptyState,
  ErrorState,
  Loading,
  PageHeader,
  formatDate,
  timeAgo,
} from "../components/ui";

type ApiKeyRow = {
  id: string;
  project_id: string;
  name: string;
  prefix: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

export default function ApiKeys() {
  const { selectedProjectId, load: loadProjects } = useProjectStore();
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    const qs = selectedProjectId ? `?projectId=${selectedProjectId}` : "";
    http
      .get<ApiKeyRow[]>(`/api/api-keys${qs}`)
      .then((r) => setKeys(r))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    setProjectId(selectedProjectId ?? "");
    load();
  }, [selectedProjectId]);

  useEffect(() => {
    http.get<Project[]>("/api/projects").then(setProjects).catch(() => undefined);
  }, []);

  const create = async () => {
    if (!name.trim() || !projectId) return;
    setError(null);
    setNotice(null);
    try {
      const res = await http.post<{ key: string }>("/api/api-keys", { name, projectId });
      setCreatedKey(res.key);
      setShowCreate(false);
      setName("");
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const revoke = async (keyId: string, keyName: string) => {
    if (!window.confirm(`Revoke API key "${keyName}"? Existing automated triggers will stop working.`)) return;
    try {
      await http.post(`/api/api-keys/${keyId}/revoke`);
      setNotice(`"${keyName}" revoked.`);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <div className="stack">
      <PageHeader
        title="API keys"
        subtitle="Programmatic trigger credentials — scoped to a project, stored hashed."
        actions={
          <button className="btn btn-primary" onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? "Cancel" : "+ New key"}
          </button>
        }
      />

      {showCreate && (
        <Card>
          <div className="grid-2">
            <label className="field">
              <span>Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="CI deployer" />
            </label>
            <label className="field">
              <span>Project</span>
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">Select project…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button className="btn btn-primary" onClick={() => void create()} disabled={!name.trim() || !projectId}>
            Create key
          </button>
        </Card>
      )}

      {createdKey && (
        <Card>
          <h2 className="positive" style={{ marginBottom: 8 }}>
            Key created — copy it now
          </h2>
          <p className="muted" style={{ marginBottom: 10, fontSize: 13 }}>
            The raw key is shown exactly once and never again. Anyone holding it can trigger workflows
            in the scoped project.
          </p>
          <div className="code" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <code style={{ flex: 1 }}>{createdKey}</code>
            <CopyButton text={createdKey} />
          </div>
        </Card>
      )}

      {notice && <div className="demo-hint">{notice}</div>}

      {loading ? (
        <Loading />
      ) : keys.length === 0 ? (
        <EmptyState
          title="No API keys"
          body="Create a key to trigger workflows with curl or an external system."
        />
      ) : (
        <Card>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Key</th>
                  <th>Last used</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id}>
                    <td style={{ fontWeight: 550 }}>{k.name}</td>
                    <td className="muted">
                      <code>
                        {k.prefix}••••••••••••
                      </code>
                    </td>
                    <td className="muted">{k.last_used_at ? timeAgo(k.last_used_at) : "never"}</td>
                    <td className="muted">{formatDate(k.created_at)}</td>
                    <td style={{ textAlign: "right" }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => void revoke(k.id, k.name)}>
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card>
        <h2>Triggering with a key</h2>
        <div className="code" style={{ whiteSpace: "pre-wrap" }}>
          {`curl -X POST http://localhost:4000/api/v1/trigger \\
  -H "Authorization: Bearer ff_...your_key..." \\
  -H "Content-Type: application/json" \\
  -d '{"workflowId":"<workflow id>","payload":{"hello":"world"}}'

# Idempotent re-entry (same key + same payload → returns original run):
#   -H "Idempotency-Key: my-request-1"`}
        </div>
      </Card>
    </div>
  );
}