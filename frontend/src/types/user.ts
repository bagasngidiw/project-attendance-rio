import type { PermissionKey } from "@contracts/permissions";
import type { RoleKey } from "@contracts/auth";

export interface User {
  id: string;
  username: string;
  email: string;
  name: string;
  status: "ACTIVE" | "INACTIVE" | "PENDING";
  mustChangePassword: boolean;
  roles: RoleKey[];
  permissions: PermissionKey[];
}
