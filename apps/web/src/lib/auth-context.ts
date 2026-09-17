import { createContext, useContext } from "react";
import type { AuthSession } from "./auth-client";

export type AuthState =
  { status: "loading" } | { status: "signedOut" } | { status: "signedIn"; session: AuthSession };

export interface AuthContextValue {
  state: AuthState;
  sendCode(email: string): Promise<void>;
  verifyCode(email: string, code: string): Promise<void>;
  signOut(): Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
