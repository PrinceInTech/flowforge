import { create } from "zustand";
import type { AuthSession, AuthSessionWithTokens } from "../api/types";
import {
  api,
  setOrganizationId,
  setTokens,
  getOrganizationId,
} from "../api/client";

interface AuthState {
  session: AuthSession | null;
  loading: boolean;
  booting: boolean;
  signin: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, name?: string) => Promise<void>;
  signout: () => Promise<void>;
  selectOrganization: (orgId: string) => void;
  restore: () => Promise<void>;
}

export const useAuth = create<AuthState>((set, get) => ({
  session: null,
  loading: false,
  booting: true,

  async signin(email, password) {
    set({ loading: true });
    try {
      const session = await api<AuthSessionWithTokens>("/api/auth/signin", {
        method: "POST",
        skipAuth: true,
        body: JSON.stringify({ email, password }),
      });
      setTokens(session.tokens.accessToken, session.tokens.refreshToken);
      setOrganizationId(session.organizations[0]?.id ?? null);
      set({ session, loading: false });
    } catch (err) {
      set({ loading: false });
      throw err;
    }
  },

  async signup(email, password, name) {
    set({ loading: true });
    try {
      const session = await api<AuthSessionWithTokens>("/api/auth/signup", {
        method: "POST",
        skipAuth: true,
        body: JSON.stringify({ email, password, name }),
      });
      setTokens(session.tokens.accessToken, session.tokens.refreshToken);
      setOrganizationId(session.organizations[0]?.id ?? null);
      set({ session, loading: false });
    } catch (err) {
      set({ loading: false });
      throw err;
    }
  },

  async signout() {
    try {
      await api("/api/auth/signout", { method: "POST", skipAuth: true });
    } catch {
      /* even if the call fails we clear locally */
    }
    localStorage.removeItem("ff.access");
    localStorage.removeItem("ff.refresh");
    localStorage.removeItem("ff.org");
    set({ session: null });
    window.location.href = "/login";
  },

  selectOrganization(orgId) {
    setOrganizationId(orgId);
    const session = get().session;
    if (session) {
      set({
        session: {
          ...session,
          organizations: session.organizations.map((o) =>
            o.id === orgId ? { ...o, selected: true } : { ...o, selected: false },
          ),
        },
      });
    }
  },

  async restore() {
    if (localStorage.getItem("ff.access")) {
      try {
        const session = await api<AuthSession>("/api/auth/session", {
          skipAuth: false,
        }).catch(async () => {
          // Fall back: rebuild session shape from a fresh sign-in is avoided; if
          // the token is dead, the client will redirect to login on first 401.
          throw new Error("session unavailable");
        });
        const orgId = getOrganizationId() ?? session.organizations[0]?.id;
        if (orgId) setOrganizationId(orgId);
        set({
          session: {
            ...session,
            organizations: session.organizations.map((o) => ({
              ...o,
              selected: o.id === orgId,
            })),
          },
          booting: false,
        });
      } catch {
        set({ booting: false });
        clearLocal();
      }
    } else {
      set({ booting: false });
    }
  },
}));

function clearLocal() {
  localStorage.removeItem("ff.access");
  localStorage.removeItem("ff.refresh");
  localStorage.removeItem("ff.org");
}