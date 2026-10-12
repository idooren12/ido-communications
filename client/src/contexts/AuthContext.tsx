import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { apiLogin, apiRegister, apiGetMe, apiChangePassword, ApiError, readToken } from '../utils/api';

function storeToken(token: string | null) {
  try {
    if (token) localStorage.setItem('token', token);
    else localStorage.removeItem('token');
  } catch {
    // Storage unavailable (private mode / blocked): the session lasts for this tab only.
  }
}

interface User {
  id: string;
  username: string;
  preferredLanguage: string;
  createdAt: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => void;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  // Only wait for /me when there is a token to check.
  const [loading, setLoading] = useState(() => readToken() !== null);

  useEffect(() => {
    if (!readToken()) return;
    apiGetMe()
      .then(data => setUser(data.user))
      .catch((err: unknown) => {
        // Log out only when the server actually rejected the token. A network error or a
        // sleeping server (Render free tier) must not throw away a valid session.
        if (err instanceof ApiError && err.isAuthError) {
          storeToken(null);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (username: string, password: string) => {
    const data = await apiLogin(username, password);
    storeToken(data.token);
    setUser(data.user);
  };

  const register = async (username: string, password: string) => {
    const data = await apiRegister(username, password);
    storeToken(data.token);
    setUser(data.user);
  };

  const logout = () => {
    storeToken(null);
    setUser(null);
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    await apiChangePassword(currentPassword, newPassword);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, changePassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
