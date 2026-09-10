import { useEffect, useState } from "react";
import { http } from "../api/client";
import type { Project, Workflow } from "../api/types";
import { useProjectStore } from "./projects-store";
import {
  Card,
  EmptyState,
  ErrorState,
  Loading,
  PageHeader,
  StatusBadge,
  formatDate,
} from "../components/ui";

type Schedule = {
  id: string;
  workflow_definition_id: string;
  workflow_name: string;
  name: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  payload: unknown;
  project_id?: string;
  created_at: string;
};

const COMMON_CRONS = [
  { label: "Every minute", value: "* * * * *" },
  { label: "Every 5 minutes", value: "*/5 * * * *" },
  { label: "Hourly", value: "0 * * * *" },
  { label: "Daily at 09:00", value: "0 9 * * *" },
  { label: "Weekdays 08:00", value: "0 8 * * 1-5" },
];

const TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Amsterdam",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
];

export default function Schedules() {
  const { selectedProjectId, load: loadProjects } = useProjectStore();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({
    workflowId: "",
    name: "",
    cron: "",
    timezone: "UTC",
    payload: "{}",
    projectId: "",
  });

  const load = () => {
    setLoading(true);
    const qs = selectedProjectId ? `?projectId=${selectedProjectId}` : "";
    http
      .get<Schedule[]>(`/api/schedules${qs}`)
      .then(setSchedules)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    setForm((f) => ({ ...f, projectId: selectedProjectId ?? "" }));
    load();
  }, [selectedProjectId]);

  useEffect(() => {
    Promise.all([
      http.get<Project[]>("/api/projects").catch(() => [] as Project[]),
      http.get<Workflow[]>("/api/workflows").catch(() => [] as Workflow[]),
    ]).then(([p, w]) => {
      setProjects(p);
      setWorkflows(w);
      if (!form.projectId && p.length) setForm((f) => ({ ...f, projectId: p[0].id }));
      if (!form.workflowId && w.length) setForm((f) => ({ ...f, workflowId: w[0].id }));
    });
  }, []);

  const toggle = async (s: Schedule) => {
    try {
      await http.patch(`/api/schedules/${s.id}`, { enabled: !s.enabled });
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const remove = async (s: Schedule) => {
    if (!window.confirm(`Delete schedule "${s.name}"?`)) return;
    try {
      await http.del(`/api/schedules/${s.id}`);
      setNotice(`Schedule "${s.name}" deleted.`);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const create = async () => {
    if (!form.workflowId || !form.cron || !form.name.trim() || !form.projectId) return;
    let payload: unknown = {};
    try {
      payload = JSON.parse(form.payload);
    } catch {
      setError("Payload is not valid JSON");
      return;
    }
    try {
      await http.post("/api/schedules", {
        workflowId: form.workflowId,
        projectId: form.projectId,
        name: form.name,
        cron: form.cron,
        timezone: form.timezone,
        enabled: true,
        payload,
      });
      setNotice(`Schedule "${form.name}" created. The scheduler ticks every few seconds and triggers due runs.`);
      setShowCreate(false);
      setForm((f) => ({ ...f, name: "", payload: "{}" }));
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <div className="stack">
      <PageHeader
        title="Schedules"
        subtitle="Cron-based triggers. The scheduler runs distributed locks to avoid double-firing."
        actions={
          <button className="btn btn-primary" onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? "Cancel" : "+ New schedule"}
          </button>
        }
      />

      {showCreate && (
        <Card>
          <div className="grid-2">
            <label className="field">
              <span>Name</span>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Nightly report"
              />
            </label>
            <label className="field">
              <span>Workflow</span>
              <select
                value={form.workflowId}
                onChange={(e) => setForm((f) => ({ ...f, workflowId: e.target.value }))}
              >
                <option value="">Select workflow…</option>
                {workflows.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Project</span>
              <select
                value={form.projectId}
                onChange={(e) => setForm((f) => ({ ...f, projectId: e.target.value }))}
              >
                <option value="">Select project…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Timezone</span>
              <select
                value={form.timezone}
                onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>Cron expression</span>
              <div className="row">
                {COMMON_CRONS.map((c) => (
                  <button
                    key={c.value}
                    className={`badge ${form.cron === c.value ? "badge-blue" : "badge-gray"}`}
                    onClick={(e) => {
                      e.preventDefault();
                      setForm((f) => ({ ...f, cron: c.value }));
                    }}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <input
                value={form.cron}
                onChange={(e) => setForm((f) => ({ ...f, cron: e.target.value }))}
                placeholder="0 9 * * 1"
                style={{ marginTop: 6 }}
              />
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>Payload (JSON, becomes run input)</span>
              <textarea
                className="code-input"
                value={form.payload}
                onChange={(e) => setForm((f) => ({ ...f, payload: e.target.value }))}
                spellCheck={false}
                style={{ minHeight: 80 }}
              />
            </label>
          </div>
          <button className="btn btn-primary" onClick={() => void create()} disabled={!form.name.trim() || !form.cron || !form.workflowId}>
            Create schedule
          </button>
        </Card>
      )}

      {notice && <div className="demo-hint">{notice}</div>}

      {loading ? (
        <Loading />
      ) : schedules.length === 0 ? (
        <EmptyState
          title="No schedules yet"
          body="Add a cron schedule to fire a workflow on a timer. Use UTC unless you pick another timezone."
        />
      ) : (
        <Card>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Workflow</th>
                  <th>Cron</th>
                  <th>Timezone</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((s) => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 550 }}>{s.name}</td>
                    <td>{s.workflow_name}</td>
                    <td>
                      <code>{s.cron}</code>
                    </td>
                    <td className="muted">{s.timezone}</td>
                    <td>
                      <StatusBadge status={s.enabled ? "ENABLED" : "DISABLED"} />
                    </td>
                    <td className="muted">{formatDate(s.created_at)}</td>
                    <td style={{ textAlign: "right" }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => void toggle(s)}>
                        {s.enabled ? "Disable" : "Enable"}
                      </button>{" "}
                      <button className="btn btn-secondary btn-sm" onClick={() => void remove(s)}>
                        Delete
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
        <h2>How scheduling works</h2>
        <p style={{ fontSize: 13.5, maxWidth: 560 }}>
          <code>SchedulerService</code> runs in every API replica and ticks every few seconds. It acquires
          a Redis lock, then claims due schedules with <code>FOR UPDATE SKIP LOCKED</code> so replicated
          schedulers never double-fire. Missed runs are appended to the next due occurrence.
        </p>
      </Card>
    </div>
  );
}