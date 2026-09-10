import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/auth-store";

export default function Signup() {
  const { signup, loading } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 10) {
      setError("Password must be at least 10 characters");
      return;
    }
    try {
      await signup(email, password, name || undefined);
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
        <h2 className="auth-title">Create an account</h2>
        <p className="auth-sub">An organization is created for you automatically</p>
        {error && <div className="form-error">{error}</div>}
        <form onSubmit={onSubmit}>
          <label className="field">
            <span>Name (optional)</span>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className="field">
            <span>Password (min 10 chars)</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <button className="btn btn-primary" disabled={loading} style={{ width: "100%" }}>
            {loading ? "Creating account…" : "Create account"}
          </button>
        </form>
        <p className="muted" style={{ textAlign: "center", marginTop: 16 }}>
          Already registered?{" "}
          <Link to="/login" style={{ fontWeight: 550 }}>
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}