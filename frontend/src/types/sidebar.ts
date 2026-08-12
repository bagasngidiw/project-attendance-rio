import type { LucideIcon } from "lucide-react";
import type { PermissionKey } from "@contracts/permissions";

export interface SidebarItem {
  title: string;
  /** Leaf items carry a route; group/section items do not. */
  path?: string;
  /** Icons are presentational only; groups render as text section labels. */
  icon?: LucideIcon;
  /**
   * A user may see this menu item when they hold ANY of these permissions.
   * The sidebar is rendered dynamically from the signed-in user's effective
   * permission set (FR-003). Group items may omit this — visibility is
   * derived from their children.
   */
  permissions?: PermissionKey[];
  /** Group sub-items; a group is pruned when none of its children are visible. */
  children?: SidebarItem[];
}
