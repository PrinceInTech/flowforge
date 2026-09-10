import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/auth-store";

const DEMO_PREFILL = import.meta.env.VITE_DEMO_CREDENTIALS === "true";

export default function Login() {
  const { signin, loading } = useAuth();
  const [email, setEmail] = useState(DEMO_PREFILL ? "demo@flowforge.dev" : "");
  const [password, setPassword] = useState(DEMO_PREFILL ? "flowforge-demo" : "");
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await signin(email, password);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="brand">
          <span className="brand-mark">FF</span>
          <span className="brand-name">FlowForge</span>
        </div>
        <h2 className="auth-title">Sign in</h2>
        <p className="auth-sub">Multi-tenant workflow orchestration</p>
        {error && <div className="form-error">{error}</div>}
        <form onSubmit={onSubmit}>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </label>
          <button
            className="btn btn-primary"
            disabled={loading}
            style={{ width: "100%" }}
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="muted" style={{ textAlign: "center", marginTop: 16 }}>
          No account?{" "}
          <Link to="/signup" style={{ fontWeight: 550 }}>
            Create one
          </Link>
        </p>
        <div className="demo-hint">
          Demo credentials are pre-filled only when the build is compiled with{" "}
          <code>VITE_DEMO_CREDENTIALS=true</code>. Run <code>pnpm seed</code> once to
          create the demo org, project, API keys, and example workflows.
        </div>
      </div>
    </div>
  );
}
