import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/auth-store";
import Shell from "./components/Shell";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Dashboard from "./pages/Dashboard";
import ProjectsPage from "./pages/ProjectsPage";
import Workflows from "./pages/Workflows";
import WorkflowDetail from "./pages/WorkflowDetail";
import WorkflowEditor from "./pages/WorkflowEditor";
import Runs from "./pages/Runs";
import RunDetail from "./pages/RunDetail";
import ApiKeys from "./pages/ApiKeys";
import Schedules from "./pages/Schedules";
import Members from "./pages/Members";

function Spinner() {
  return (
    <div className="center-screen">
      <div className="spinner" />
      <p className="muted">Loading workspace…</p>
    </div>
  );
}

export default function App() {
  const { session, booting, restore } = useAuth();

  useEffect(() => {
    void restore();
  }, [restore]);

  if (booting) return <Spinner />;

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route element={<Shell />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/workflows" element={<Workflows />} />
        <Route path="/workflows/new" element={<WorkflowEditor />} />
        <Route path="/workflows/:workflowId" element={<WorkflowDetail />} />
        <Route path="/workflows/:workflowId/edit" element={<WorkflowEditor />} />
        <Route path="/runs" element={<Runs />} />
        <Route path="/runs/:runId" element={<RunDetail />} />
        <Route path="/api-keys" element={<ApiKeys />} />
        <Route path="/schedules" element={<Schedules />} />
        <Route path="/members" element={<Members />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}