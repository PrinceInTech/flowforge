import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/auth-store";

const NAV = [
  { to: "/", label: "Dashboard", icon: "◧", end: true },
  { to: "/projects", label: "Projects", icon: "▤" },
  { to: "/workflows", label: "Workflows", icon: "◈" },
  { to: "/runs", label: "Runs", icon: "▷" },
  { to: "/api-keys", label: "API keys", icon: "⚿" },
  { to: "/schedules", label: "Schedules", icon: "◷" },
  { to: "/members", label: "Members", icon: "⚑" },
];

function initials(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

export default function Shell() {
  const { session, selectOrganization, signout } = useAuth();
  const [orgOpen, setOrgOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);

  if (!session) return null;
  const { user, organizations } = session;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">FF</span>
          <span className="brand-name">FlowForge</span>
        </div>

        <div className="org-switcher" onClick={() => setOrgOpen((v) => !v)}>
          <span className="org-name">
            {(organizations.find((o) => (o as unknown as { selected?: boolean }).selected)?.name ??
              organizations[0]?.name) ?? "No organization"}
          </span>
          <span className="caret">▾</span>
          {orgOpen && (
            <div className="menu">
              {organizations.map((o) => (
                <button
                  key={o.id}
                  className="menu-item"
                  onClick={() => {
                    selectOrganization(o.id);
                    setOrgOpen(false);
                  }}
                >
                  {o.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <nav className="nav">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="user-chip" onClick={() => setUserOpen((v) => !v)}>
            <span className="avatar">{initials(user.name, user.email)}</span>
            <div className="user-meta">
              <span className="user-name">{user.name ?? user.email}</span>
              <span className="user-email">{user.email}</span>
            </div>
            <span className="caret">▾</span>
            {userOpen && (
              <div className="menu right">
                <button className="menu-item" onClick={() => void signout()}>
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}