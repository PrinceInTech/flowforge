import { useEffect, useState } from "react";
import { http, getOrganizationId } from "../api/client";
import type { OrgRole } from "../api/types";
import { useAuth } from "../auth/auth-store";
import {
  Card,
  EmptyState,
  ErrorState,
  Loading,
  PageHeader,
  StatusBadge,
  formatDate,
} from "../components/ui";

type Member = {
  id: string;
  organization_id: string;
  user_id: string;
  role: OrgRole;
  email: string;
  name: string | null;
  created_at: string;
};

type OrgInfo = { id: string; name: string; slug: string; role: string };

export default function Members() {
  const { session } = useAuth();
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("DEVELOPER");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const orgId = getOrganizationId() ?? (session?.organizations as OrgInfo[] | undefined)?.[0]?.id ?? null;
  const myUserId = session?.user?.id;
  const myRole = org?.role;

  const load = () => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all([
      http.get<OrgInfo>(`/api/organizations/${orgId}`),
      http.get<Member[]>(`/api/organizations/${orgId}/members`),
    ])
      .then(([o, m]) => {
        setOrg(o);
        setMembers(m);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [orgId]);

  const invite = async () => {
    if (!email.trim()) return;
    setBusy(true);
    try {
      await http.post(`/api/organizations/${orgId}/members`, { email: email.trim(), role });
      setEmail("");
      setShowInvite(false);
      setNotice(`Invited ${email.trim()} as ${role}.`);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (m: Member, nextRole: OrgRole) => {
    try {
      await http.patch(`/api/organizations/${orgId}/members/${m.user_id}`, { role: nextRole });
      setNotice(`${m.email} is now ${nextRole}.`);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const remove = async (m: Member) => {
    if (!window.confirm(`Remove ${m.email} from this organization?`)) return;
    try {
      await http.del(`/api/organizations/${orgId}/members/${m.user_id}`);
      setNotice(`Removed ${m.email}.`);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (loading) return <Loading label="Loading members…" />;
  if (!orgId || !org)
    return (
      <EmptyState title="No organization selected" body="Create or select an organization to manage members." />
    );

  const isOwner = myRole === "OWNER";

  return (
    <div className="stack">
      <PageHeader
        title={`${org.name} — Members`}
        subtitle="Roles: OWNER, DEVELOPER, VIEWER. Only owners can invite or change roles."
        actions={
          isOwner ? (
            <button className="btn btn-primary" onClick={() => setShowInvite((v) => !v)}>
              {showInvite ? "Cancel" : "+ Invite member"}
            </button>
          ) : undefined
        }
      />

      {showInvite && isOwner && (
        <Card>
          <div className="grid-2">
            <label className="field">
              <span>Email</span>
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@company.com" />
            </label>
            <label className="field">
              <span>Role</span>
              <select value={role} onChange={(e) => setRole(e.target.value as OrgRole)}>
                <option value="DEVELOPER">DEVELOPER</option>
                <option value="VIEWER">VIEWER</option>
                <option value="OWNER">OWNER</option>
              </select>
            </label>
          </div>
          <button className="btn btn-primary" onClick={() => void invite()} disabled={busy || !email.trim()}>
            {busy ? "Inviting…" : "Invite"}
          </button>
        </Card>
      )}

      {notice && <div className="demo-hint">{notice}</div>}

      <Card>
        {members.length === 0 ? (
          <EmptyState title="No members" body="You are on your own for now." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Joined</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    <td style={{ fontWeight: 550 }}>
                      {m.email}
                      {m.user_id === myUserId && <span className="muted" style={{ fontWeight: 400 }}> (you)</span>}
                    </td>
                    <td className="muted">{m.name ?? "—"}</td>
                    <td>
                      <StatusBadge status={m.role} />
                    </td>
                    <td className="muted">{formatDate(m.created_at)}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {isOwner && m.user_id !== myUserId ? (
                        <>
                          <select
                            value={m.role}
                            onChange={(e) => void changeRole(m, e.target.value as OrgRole)}
                            style={{ width: 110, fontSize: 12, padding: "3px 6px" }}
                          >
                            <option value="OWNER">Owner</option>
                            <option value="DEVELOPER">Developer</option>
                            <option value="VIEWER">Viewer</option>
                          </select>{" "}
                          <button className="btn btn-secondary btn-sm" onClick={() => void remove(m)}>
                            Remove
                          </button>
                        </>
                      ) : (
                        <span className="muted" style={{ fontSize: 12 }}>
                          {m.user_id === myUserId ? "that's you" : "viewer-only"}
                        </span>
                      )}
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