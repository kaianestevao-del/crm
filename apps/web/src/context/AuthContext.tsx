import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { Role } from "@crm/shared";
import { api, setAuthToken } from "../lib/api";
import { connectSocket, disconnectSocket } from "../lib/socket";

interface AuthUser {
  id: string;
  name: string;
  email: string;
  signatureEnabled: boolean;
  signatureName: string | null;
}

interface AuthOrganization {
  id: string;
  name: string;
  role: Role;
  allowedModules: string[];
}

interface AuthContextValue {
  token: string | null;
  user: AuthUser | null;
  organization: AuthOrganization | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string, organizationName: string) => Promise<void>;
  logout: () => void;
  updateSignature: (patch: { signatureEnabled?: boolean; signatureName?: string | null }) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const STORAGE_KEY = "crm_wa_token";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));
  const [user, setUser] = useState<AuthUser | null>(null);
  const [organization, setOrganization] = useState<AuthOrganization | null>(null);
  const [loading, setLoading] = useState(true);

  const applySession = useCallback((newToken: string, newUser: AuthUser, newOrg: AuthOrganization) => {
    localStorage.setItem(STORAGE_KEY, newToken);
    setAuthToken(newToken);
    setToken(newToken);
    setUser(newUser);
    setOrganization(newOrg);
    connectSocket(newToken);
  }, []);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    setAuthToken(token);
    api
      .get("/auth/me")
      .then((res) => {
        setUser(res.data.user);
        setOrganization(res.data.organization);
        connectSocket(token);
      })
      .catch(() => {
        localStorage.removeItem(STORAGE_KEY);
        setToken(null);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api.post("/auth/login", { email, password });
      applySession(res.data.token, res.data.user, res.data.organization);
    },
    [applySession],
  );

  const register = useCallback(
    async (name: string, email: string, password: string, organizationName: string) => {
      const res = await api.post("/auth/register", { name, email, password, organizationName });
      applySession(res.data.token, res.data.user, res.data.organization);
    },
    [applySession],
  );

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setAuthToken(null);
    setToken(null);
    setUser(null);
    setOrganization(null);
    disconnectSocket();
  }, []);

  const updateSignature = useCallback(async (patch: { signatureEnabled?: boolean; signatureName?: string | null }) => {
    const res = await api.patch("/auth/me", patch);
    setUser(res.data);
  }, []);

  const value = useMemo(
    () => ({ token, user, organization, loading, login, register, logout, updateSignature }),
    [token, user, organization, loading, login, register, logout, updateSignature],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
