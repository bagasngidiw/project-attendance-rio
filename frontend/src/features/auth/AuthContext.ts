import { createContext } from "react";

import type { AuthUser, SignInResponse } from "@contracts/auth";
import type { PermissionKey } from "@contracts/permissions";

export interface AuthContextValue {
  user: AuthUser | null;
  permissions: PermissionKey[];
  roles: string[];
  isAuthenticated: boolean;
  isBootstrapping: boolean;
  signIn: (username: string, password: string) => Promise<SignInResponse>;
  signOut: () => Promise<void>;
  signOutAll: () => Promise<void>;
  hasPermission: (required: PermissionKey | PermissionKey[]) => boolean;
  refreshSession: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(
  undefined
);
