import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import * as api from "../lib/api";
import type { User } from "../lib/types";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<string | null>;
  register: (input: api.RegisterInput) => Promise<string | null>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const me = await api.getMe();
    setUser(me);
  };

  useEffect(() => {
    refresh().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login: AuthContextValue["login"] = async (username, password) => {
    try {
      const loggedIn = await api.login(username, password);
      setUser(loggedIn);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  };

  const register: AuthContextValue["register"] = async (input) => {
    try {
      const created = await api.register(input);
      setUser(created);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  };

  const logout = () => {
    api.logout();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
