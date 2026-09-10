import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { http } from "../api/client";
import type { Project, Run } from "../api/types";
import { useProjectStore } from "./projects-store";
import {
  Card,
  EmptyState,
  ErrorState,
  Loading,
  PageHeader,
  StatusBadge,
  timeAgo,
} from "../components/ui";

export default function ProjectsPage() {
  const { projects, selectedProjectId, loading, load, selectProject } = useProjectStore();
  const [projectRuns, setProjectRuns] = useState<Run[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);

  const selected = projects.find((p) => p.id === selectedProjectId);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedProjectId) return;
    http
      .get<{ items: Run[] }>(`/api/runs?page=1&pageSize=10&projectId=${selectedProjectId}`)
      .then((r) => setProjectRuns(r.items))
      .catch((err) => setError((err as Error).message));
  }, [selectedProjectId]);

  const createProject = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      await http.post<Project>("/api/projects", { name, description });
      setName("");
      setDescription("");
      setShowCreate(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  if (error) return <ErrorState message={error} />;

  return (
    <div className="stack">
      <PageHeader
        title="Projects"
        subtitle="Workflows and runs are scoped to a project; API keys belong to a project."
        actions={
          <button className="btn btn-primary" onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? "Cancel" : "+ New project"}
          </button>
        }
      />

      {showCreate && (
        <Card>
          <div className="grid-2">
            <label className="field">
              <span>Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Payment service" />
            </label>
            <label className="field">
              <span>Description</span>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional"
              />
            </label>
          </div>
          <button className="btn btn-primary" onClick={createProject} disabled={creating || !name.trim()}>
            {creating ? "Creating…" : "Create project"}
          </button>
        </Card>
      )}

      {loading ? (
        <Loading />
      ) : projects.length === 0 ? (
        <EmptyState
          title="No projects yet"
          body="Projects group workflows, runs, and API keys."
          action={<button className="btn btn-primary" onClick={() => setShowCreate(true)}>Create a project</button>}
        />
      ) : (
        <div className="grid-2">
          {projects.map((p) => (
            <Card
              key={p.id}
              className={p.id === selectedProjectId ? "" : ""}
            >
              <div className="spread">
                <div>
                  <Link
                    to="/workflows"
                    onClick={() => selectProject(p.id)}
                    style={{ fontWeight: 650, fontSize: 15 }}
                  >
                    {p.name}
                  </Link>
                  {p.description && (
                    <p className="muted" style={{ marginTop: 4 }}>
                      {p.description}
                    </p>
                  )}
                </div>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => selectProject(p.id)}
                >
                  {p.id === selectedProjectId ? "Selected" : "Select"}
                </button>
              </div>
              <div className="muted" style={{ marginTop: 10, fontSize: 12.5 }}>
                {p.workflow_count ?? 0} workflows ·{" "}
                <a
                  href="javaScript:void(0)"
                  onClick={(e) => {
                    e.preventDefault();
                    selectProject(p.id);
                    window.location.hash = "runs";
                  }}
                >
                  view runs
                </a>
              </div>
            </Card>
          ))}
        </div>
      )}

      {selected && (
        <Card>
          <div className="spread">
            <h2>Recent runs — {selected.name}</h2>
            <Link to="/runs" className="muted" style={{ fontSize: 12.5 }}>
              all runs →
            </Link>
          </div>
          {projectRuns.length === 0 ? (
            <EmptyState title="No runs in this project yet" />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Workflow</th>
                    <th>Status</th>
                    <th>Trigger</th>
                    <th>Run #</th>
                    <th>Started</th>
                  </tr>
                </thead>
                <tbody>
                  {projectRuns.map((run) => (
                    <tr key={run.id} className="row-click">
                      <td>
                        <Link to={`/runs/${run.id}`} style={{ fontWeight: 550 }}>
                          {run.workflow_name}
                        </Link>
                      </td>
                      <td>
                        <StatusBadge status={run.status} />
                      </td>
                      <td className="muted">{run.trigger}</td>
                      <td className="muted">#{run.run_number}</td>
                      <td className="muted">{timeAgo(run.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}