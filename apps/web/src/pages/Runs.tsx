import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { http } from "../api/client";
import type { Run, Workflow } from "../api/types";
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

const STATUSES = ["", "PENDING", "QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED", "DEAD_LETTER"];

export default function Runs() {
  const { selectedProjectId } = useProjectStore();
  const [runs, setRuns] = useState<Run[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (status) params.set("status", status);
    if (workflowId) params.set("workflowId", workflowId);
    if (selectedProjectId) params.set("projectId", selectedProjectId);
    http
      .get<{ items: Run[]; total: number }>(`/api/runs?${params.toString()}`)
      .then((res) => {
        setRuns(res.items);
        setTotal(res.total);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    http.get<Workflow[]>(`/api/workflows`).then(setWorkflows).catch(() => undefined);
  }, [selectedProjectId]);

  useEffect(() => {
    setPage(1);
  }, [status, workflowId, selectedProjectId]);

  useEffect(load, [page, status, workflowId, selectedProjectId]);

  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <div className="stack">
      <PageHeader title="Runs" subtitle="Every run is persisted; execution is asynchronous via the worker." />

      <div className="filters">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s === "" ? "All statuses" : s.replace("_", " ")}
            </option>
          ))}
        </select>
        <select value={workflowId} onChange={(e) => setWorkflowId(e.target.value)}>
          <option value="">All workflows</option>
          {workflows.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <Loading />
      ) : runs.length === 0 ? (
        <EmptyState
          title="No runs match"
          body="Trigger a workflow to see runs here, or clear the filters."
          action={
            <Link to="/workflows" className="btn btn-primary">
              Go to workflows
            </Link>
          }
        />
      ) : (
        <Card>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Workflow</th>
                  <th>Run</th>
                  <th>Trigger</th>
                  <th>Status</th>
                  <th>Started</th>
                  <th>Duration</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className="row-click">
                    <td style={{ fontWeight: 550 }}>{run.workflow_name}</td>
                    <td className="muted">#{run.run_number}</td>
                    <td>
                      <StatusBadge status={run.trigger} />
                    </td>
                    <td>
                      <StatusBadge status={run.status} />
                    </td>
                    <td className="muted">{timeAgo(run.created_at)}</td>
                    <td className="muted">
                      {run.started_at && run.completed_at
                        ? `${((new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000).toFixed(1)}s`
                        : "—"}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <Link to={`/runs/${run.id}`} className="muted">
                        open →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              ← Prev
            </button>
            <span>
              Page {page} · {total} runs
            </span>
            <button
              className="btn btn-secondary btn-sm"
              disabled={page * 20 >= total}
              onClick={() => setPage(page + 1)}
            >
              Next →
            </button>
          </div>
        </Card>
      )}
    </div>
  );
}