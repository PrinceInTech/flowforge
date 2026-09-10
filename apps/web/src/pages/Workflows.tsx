import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { http } from "../api/client";
import type { Workflow } from "../api/types";
import { useProjectStore } from "./projects-store";
import { Card, EmptyState, ErrorState, Loading, PageHeader, StatusBadge, timeAgo } from "../components/ui";

export default function Workflows() {
  const { projects, selectedProjectId, load: loadProjects, selectProject } = useProjectStore();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    const qs = selectedProjectId ? `?projectId=${selectedProjectId}` : "";
    http
      .get<Workflow[]>(`/api/workflows${qs}`)
      .then(setWorkflows)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

useEffect(() => {
    load();
    // load depends on selectedProjectId
  }, [selectedProjectId]);

  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <div className="stack">
      <PageHeader
        title="Workflows"
        subtitle="Versioned workflow definitions — each published version is immutable."
        actions={
          <Link to="/workflows/new" className="btn btn-primary">
            + New workflow
          </Link>
        }
      />

      {projects.length > 1 && (
        <div className="filters">
          <span className="muted">Project:</span>
          <select
            value={selectedProjectId ?? ""}
            onChange={(e) => selectProject(e.target.value || null)}
          >
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {loading ? (
        <Loading />
      ) : workflows.length === 0 ? (
        <EmptyState
          title="No workflows yet"
          body="Create a workflow with the JSON editor. Steps validate as a DAG (unique ids, no cycles)."
          action={
            <Link to="/workflows/new" className="btn btn-primary">
              Create workflow
            </Link>
          }
        />
      ) : (
        <Card>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Project</th>
                  <th>Version</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {workflows.map((wf) => (
                  <tr key={wf.id} className="row-click">
                    <td>
                      <Link to={`/workflows/${wf.id}`} style={{ fontWeight: 550 }}>
                        {wf.name}
                      </Link>
                    </td>
                    <td className="muted">{wf.project_name ?? "—"}</td>
                    <td>v{wf.latest_version}</td>
                    <td>
                      <StatusBadge status={wf.status} />
                    </td>
                    <td className="muted">{timeAgo(wf.created_at)}</td>
                    <td style={{ textAlign: "right" }}>
                      <Link to={`/workflows/${wf.id}`} className="muted">
                        open →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}