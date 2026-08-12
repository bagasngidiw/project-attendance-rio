/**
 * User admin DTO types (FR-029) mirroring the backend `toUserDto` shape.
 */

export interface UserListItem {
  id: string;
  username: string;
  email: string;
  name: string;
  status: "ACTIVE" | "INACTIVE" | "PENDING";
  mustChangePassword: boolean;
  departmentId?: string | null;
  positionId?: string | null;
  managerId?: string | null;
  // Role relation (join mirror) + human-readable relation names so the table
  // never shows raw ObjectIds.
  roleIds: string[];
  roles: string[];
  departmentName?: string | null;
  positionName?: string | null;
  managerName?: string | null;
}
