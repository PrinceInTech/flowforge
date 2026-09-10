import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { http } from "../api/client";
import type { WorkflowDetail as WorkflowDetailType } from "../api/types";
import {
  Card,
  Code,
  EmptyState,
  ErrorState,
  JsonBlock,
  Loading,
  PageHeader,
  StatusBadge,
  formatDate,
} from "../components/ui";
import { useProjectStore } from "./projects-store";
import { useAuth } from "../auth/auth-store";

export default function WorkflowDetail() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const [data, setData] = useState<WorkflowDetailType | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [payload, setPayload] = useState("{\n  \"name\": \"FlowForge\"\n}");
  const [triggerMsg, setTriggerMsg] = useState<string | null>(null);
  const { selectProject } = useProjectStore();
  const { session } = useAuth();

  const load = () => {
    http
      .get<WorkflowDetailType>(`/api/workflows/${workflowId}`)
      .then((d) => {
        setData(d);
        if (!selectedVersion && d.workflow.latest_version_id) {
          setSelectedVersion(d.workflow.latest_version_id);
        }
      })
      .catch((err) => setError((err as Error).message));
  };

  useEffect(load, [workflowId]);

  useEffect(() => {
    if (!data) return;
    selectProject(data.workflow.project_id);
  }, [data]);

  const trigger = async () => {
    setTriggering(true);
    setTriggerMsg(null);
    try {
      let parsed: unknown = {};
      try {
        parsed = JSON.parse(payload);
      } catch {
        setTriggerMsg("Payload is not valid JSON");
        setTriggering(false);
        return;
      }
      const result = await http.post<{ runId: string; duplicate?: boolean }>("/api/runs/trigger", {
        workflowId,
        payload: parsed,
      });
      setTriggerMsg(`Run created → /runs/${result.runId}${result.duplicate ? " (duplicate request)" : ""}`);
    } catch (err) {
      setTriggerMsg((err as Error).message);
    } finally {
      setTriggering(false);
    }
  };

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <Loading label="Loading workflow…" />;

  const version = data.versions.find((v) => v.id === selectedVersion);
  const isEditor = (session?.organizations.find((o) => (o as unknown as { selected?: boolean }).selected)?.role ?? "VIEWER") !== "VIEWER";

  return (
    <div className="stack">
      <PageHeader
        title={data.workflow.name}
        subtitle={data.workflow.description ?? `${data.versions.length} version(s)`}
        actions={
          <>
            <Link to={`/workflows/${workflowId}/edit`} className="btn btn-secondary">
              Edit (new version)
            </Link>
            {isEditor && (
              <button className="btn btn-primary" onClick={trigger} disabled={triggering}>
                {triggering ? "Triggering…" : "▶ Trigger now"}
              </button>
            )}
          </>
        }
      />

      {triggerMsg && (
        <div className="demo-hint">
          {triggerMsg.startsWith("Run created") ? (
            <span>
              ✓ {triggerMsg} —{" "}
              <Link to={triggerMsg.split("→")[1]?.trim() ?? "/runs"}>open the run</Link>
            </span>
          ) : (
            triggerMsg
          )}
        </div>
      )}

      <div className="grid-2">
        <Card>
          <h2>Versions</h2>
          {data.versions.length === 0 ? (
            <EmptyState title="No versions yet" body="Publish a version to make the workflow runnable." />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Version</th>
                    <th>Status</th>
                    <th>Published at</th>
                  </tr>
                </thead>
                <tbody>
                  {data.versions
                    .slice()
                    .reverse()
                    .map((v) => (
                      <tr
                        key={v.id}
                        className="row-click"
                        style={{ background: v.id === selectedVersion ? "#f4f4ff" : undefined }}
                        onClick={() => setSelectedVersion(v.id)}
                      >
                        <td style={{ fontWeight: 600 }}>v{v.version}</td>
                        <td>
                          <StatusBadge status={v.status} />
                        </td>
                        <td className="muted">{formatDate(v.created_at)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <div className="spread">
            <h2>Trigger with payload</h2>
            <span className="muted" style={{ fontSize: 12 }}>
              Payload becomes each step's input
            </span>
          </div>
          <textarea
            className="code-input"
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
            spellCheck={false}
            style={{ minHeight: 220 }}
          />
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn btn-primary" onClick={trigger} disabled={triggering}>
              {triggering ? "Triggering…" : "Trigger"}
            </button>
            <span className="muted" style={{ fontSize: 12.5 }}>
              A 202 response returns immediately; execution happens in the worker.
            </span>
          </div>
        </Card>
      </div>

      {version && (
        <Card>
          <div className="spread">
            <h2>
              Definition — v{version.version}{" "}
              <span className="muted" style={{ fontWeight: 400 }}>
                (immutable)
              </span>
            </h2>
            <StatusBadge status={version.status} />
          </div>
          <Code>{(version.definition as { name?: string }).name ?? "workflow"}</Code>
          <div style={{ marginTop: 14 }}>
            {(version.definition as { steps?: Array<{ id: string; name: string; type: string; dependsOn: string[] }> }).steps?.map(
              (step) => (
                <div key={step.id} className="step-head" style={{ padding: "8px 0" }}>
                  <span className="badge badge-gray">{step.type}</span>
                  <span style={{ fontWeight: 550 }}>{step.name}</span>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {step.dependsOn.length > 0 ? `depends on ${step.dependsOn.join(", ")}` : "root step"}
                  </span>
                </div>
              ),
            )}
          </div>
          <JsonBlock value={version.definition} />
        </Card>
      )}
    </div>
  );
}