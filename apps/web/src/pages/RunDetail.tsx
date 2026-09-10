import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { http } from "../api/client";
import type { RunDetail as RunDetailType, StepRun } from "../api/types";
import {
  Card,
  ErrorState,
  JsonBlock,
  Loading,
  PageHeader,
  StatusBadge,
  formatDate,
  timeAgo,
} from "../components/ui";
import { useAuth } from "../auth/auth-store";

export default function RunDetail() {
  const { runId } = useParams<{ runId: string }>();
  const { session } = useAuth();
  const [data, setData] = useState<RunDetailType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = () => {
    http
      .get<RunDetailType>(`/api/runs/${runId}`)
      .then(setData)
      .catch((err) => setError((err as Error).message));
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [runId]);

  const role = (session?.organizations?.find((o) => (o as unknown as { selected?: boolean }).selected) as
    | { role?: string }
    | undefined)?.role;
  const canEdit = role === "OWNER" || role === "DEVELOPER";

  const action = async (path: string, label: string) => {
    setBusy(label);
    try {
      await http.post(path);
      setNotice(`${label} requested — refreshing…`);
      setTimeout(() => {
        load();
        setNotice(null);
      }, 1500);
    } catch (err) {
      setNotice(`${label} failed: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <Loading label="Loading run…" />;
  const run = data.run;

  const statusToneClass = (s: string) => {
    if (["COMPLETED"].includes(s)) return "completed";
    if (["FAILED", "DEAD_LETTER"].includes(s)) return "failed";
    if (["RUNNING", "QUEUED", "READY"].includes(s)) return "running";
    return "pending";
  };

  return (
    <div className="stack">
      <PageHeader
        title={`Run #${run.run_number} — ${run.workflow_name}`}
        subtitle={`v${run.version} · ${run.trigger} · ${timeAgo(run.created_at)} · id ${run.id}`}
        actions={
          canEdit && (run.status === "FAILED" || run.status === "DEAD_LETTER") ? (
            <button className="btn btn-danger" onClick={() => void action(`/api/runs/${runId}/retry`, "Retry")} disabled={!!busy}>
              {busy === "Retry" ? "Retrying…" : "↻ Retry run"}
            </button>
          ) : canEdit && ["PENDING", "QUEUED", "RUNNING"].includes(run.status) ? (
            <button className="btn btn-secondary" onClick={() => void action(`/api/runs/${runId}/cancel`, "Cancel")} disabled={!!busy}>
              {busy === "Cancel" ? "Cancelling…" : "✕ Cancel"}
            </button>
          ) : undefined
        }
      />

      {notice && <div className="demo-hint">{notice}</div>}

      {run.status === "FAILED" && (
        <Card className="error">
          <h2 style={{ color: "#991b1b" }}>Run failed</h2>
          <p style={{ marginTop: 4 }}>{run.error_message}</p>
        </Card>
      )}

      <div className="grid-2">
        <Card>
          <h2>Overview</h2>
          <dl className="key-value">
            <dt>Status</dt>
            <dd>
              <StatusBadge status={run.status} />
            </dd>
            <dt>Trigger</dt>
            <dd>{run.trigger}</dd>
            <dt>Created</dt>
            <dd>{formatDate(run.created_at)}</dd>
            <dt>Started</dt>
            <dd>{formatDate(run.started_at)}</dd>
            <dt>Completed</dt>
            <dd>{formatDate(run.completed_at)}</dd>
            <dt>Created by</dt>
            <dd>{run.created_by_user_email ?? "—"}</dd>
            <dt>Project</dt>
            <dd>{run.project_name}</dd>
          </dl>
        </Card>
        <Card>
          <h2>Input payload</h2>
          <JsonBlock value={run.payload} />
        </Card>
      </div>

      <Card>
        <h2>Step timeline</h2>
        <div className="timeline">
          {data.steps.map((step) => (
            <StepRow
              key={step.id}
              step={step}
              runStatus={run.status}
              expanded={!!expanded[step.id]}
              onToggle={() => setExpanded((prev) => ({ ...prev, [step.id]: !prev[step.id] }))}
              dotClass={statusToneClass(step.status)}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}

function StepRow({
  step,
  runStatus,
  expanded,
  onToggle,
  dotClass,
}: {
  step: StepRun;
  runStatus: string;
  expanded: boolean;
  onToggle: () => void;
  dotClass: string;
}) {
  return (
    <div className="timeline-item">
      <span className={`timeline-dot ${dotClass}`} />
      <div className="step-head" onClick={onToggle}>
        <span className="badge badge-gray">{step.step_type}</span>
        <span className="step-title">{step.step_name}</span>
        <StatusBadge status={step.status} />
        <span className="step-meta">
          attempt {step.attempt}
          {step.max_retries > 0 ? ` / ${step.max_retries + 1} max` : ""}
        </span>
        <span className="step-meta">{expanded ? "▾" : "▸"}</span>
      </div>

      {expanded && (
        <div className="step-body">
          <div>
            <h4>Logs</h4>
            {step.logs?.length ? (
              step.logs.map((log, i) => (
                <div key={i} className="code" style={{ marginBottom: 6, padding: "8px 12px", fontSize: 11.5 }}>
                  [{log.ts}] {log.level}: {log.message}
                </div>
              ))
            ) : (
              <p className="muted">No logs yet.</p>
            )}
          </div>

          {step.error_message && (
            <div className="form-error" style={{ margin: 0 }}>
              {step.error_message}
            </div>
          )}

          <div>
            <h4>Input</h4>
            <JsonBlock value={step.input ?? {}} />
          </div>

          <div>
            <h4>Output</h4>
            {step.status === "COMPLETED" ? (
              <JsonBlock value={step.output ?? null} />
            ) : (
              <p className="muted">
                {step.status === "RUNNING" ? "Step is running…" : "No output yet."}
              </p>
            )}
          </div>

          <h4>Step config</h4>
          <JsonBlock value={step.step_config} />
        </div>
      )}
      {runStatus === "CANCELLED" && step.status === "CANCELLED" && (
        <div className="step-meta" style={{ marginLeft: 0 }}>Cancelled with the run</div>
      )}
    </div>
  );
}