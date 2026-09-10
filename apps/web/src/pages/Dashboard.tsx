import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { http } from "../api/client";
import type { OpsMetrics, RunStats, Run } from "../api/types";
import { Card, EmptyState, ErrorState, Loading, PageHeader, StatusBadge, timeAgo } from "../components/ui";

export default function Dashboard() {
  const [stats, setStats] = useState<RunStats | null>(null);
  const [ops, setOps] = useState<OpsMetrics | null>(null);
  const [recent, setRecent] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    Promise.all([
      http.get<RunStats>("/api/runs/stats"),
      http.get<OpsMetrics>("/api/ops/metrics"),
      http.get<{ items: Run[] }>("/api/runs?page=1&pageSize=8"),
    ])
      .then(([s, o, r]) => {
        setStats(s);
        setOps(o);
        setRecent(r.items);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, []);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (loading && !stats) return <Loading label="Loading dashboard…" />;

  return (
    <div className="stack">
      <PageHeader
        title="Operational dashboard"
        subtitle="Live overview of runs, queue depth, and worker health. Auto-refreshes every 8s."
      />

      <div className="stat-grid">
        <div className="stat">
          <div className="stat-label">Runs (24h)</div>
          <div className="stat-value">{stats?.runs24h ?? 0}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Success rate</div>
          <div className="stat-value positive">
            {stats ? `${Math.round((stats.successRate ?? 0) * 100)}%` : "—"}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Avg latency</div>
          <div className="stat-value">
            {stats?.avgLatencyMs != null ? `${Math.round(stats.avgLatencyMs)} ms` : "—"}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">In flight</div>
          <div className="stat-value">
            {(stats?.queuedCount ?? 0) + (stats?.runningCount ?? 0)}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Failed (all time)</div>
          <div className="stat-value negative">{stats?.failedCount ?? 0}</div>
        </div>
      </div>

      <div className="grid-2">
        <Card>
          <div className="spread">
            <h2>Workers & queues</h2>
            <Link to="/runs" className="muted" style={{ fontSize: 12.5 }}>
              view runs →
            </Link>
          </div>
          <div className="key-value" style={{ marginTop: 10 }}>
            <dt>Queue backlog</dt>
            <dd>{ops?.queueBacklog ?? "—"}</dd>
            <dt>Active jobs</dt>
            <dd>{ops?.activeJobs ?? "—"}</dd>
            <dt>Workers online</dt>
            <dd>{ops?.workersUp ?? 0}</dd>
            <dt>Lease recoveries</dt>
            <dd>{ops?.leaseRecoveredTotal ?? 0}</dd>
            <dt>Runs started</dt>
            <dd>{ops?.runsStartedTotal ?? 0}</dd>
            <dt>Runs failed</dt>
            <dd>{ops?.runsFailedTotal ?? 0}</dd>
          </div>
        </Card>

        <Card>
          <h2 className="muted" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4 }}>
            How to explore
          </h2>
          <div className="stack" style={{ gap: 10, marginTop: 8 }}>
            <p style={{ fontSize: 13.5 }}>
              Trigger the seeded <b>HTTP fetch → transform → delay</b> workflow from the
              Workflows page and watch a run flow through the timeline.
            </p>
            <p style={{ fontSize: 13.5 }}>
              The <b>intentionally failing workflow</b> visibly retries with jittered
              backoff and lands in FAILED — go to its run and press{" "}
              <span className="badge badge-blue">Retry</span>.
            </p>
            <p style={{ fontSize: 13.5 }}>
              Use the <b>API key trigger</b> from curl or the <b>webhook</b> endpoint and
              replay the same <code>Idempotency-Key</code> to see deduplication.
            </p>
          </div>
        </Card>
      </div>

      <Card>
        <h2>Recent runs</h2>
        {recent.length === 0 ? (
          <EmptyState
            title="No runs yet"
            body="Trigger a workflow from the Workflows page, the webhook, or the API-key endpoint."
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Workflow</th>
                  <th>Trigger</th>
                  <th>Status</th>
                  <th>Run #</th>
                  <th>Started</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {recent.map((run) => (
                  <tr key={run.id} className="row-click">
                    <td>
                      <Link to={`/runs/${run.id}`} style={{ fontWeight: 550 }}>
                        {run.workflow_name}
                      </Link>
                    </td>
                    <td>
                      <StatusBadge status={run.trigger} />
                    </td>
                    <td>
                      <StatusBadge status={run.status} />
                    </td>
                    <td className="muted">#{run.run_number}</td>
                    <td className="muted">{timeAgo(run.created_at)}</td>
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
        )}
      </Card>
    </div>
  );
}