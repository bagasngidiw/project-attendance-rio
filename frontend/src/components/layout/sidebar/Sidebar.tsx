import type { NavigationNode } from "@contracts/auth";

import { useAuth } from "@/features/auth/useAuth";
import { useNavigation } from "@/features/navigation/useNavigation";
import { MENU } from "@/constants/sidebar";
import { filterSidebarItems } from "@/lib/permission";
import { useSidebar } from "@/context/useSidebar";

import type { SidebarItem } from "@/types/sidebar";

import SidebarLogo from "./SidebarLogo";
import SidebarMenu from "./SidebarMenu";
import SidebarFooter from "./SidebarFooter";

/**
 * Finds a local leaf (or node) by path across the grouped local catalog —
 * leaves live inside group.children, so a flat top-level search would miss
 * them and collapse the whole sidebar.
 */
function findLocalItem(
  items: SidebarItem[],
  path: string | undefined
): SidebarItem | undefined {
  for (const item of items) {
    if (item.path === path) return item;
    if (item.children?.length) {
      const found = findLocalItem(item.children, path);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Resolves a server navigation node into the render shape used by the menu,
 * borrowing the icon from the local catalog (icons are presentational only).
 * Group/section nodes (no path) map to their children and are pruned when
 * every child is filtered out.
 */
function toSidebarItem(
  node: NavigationNode,
  localMenu: SidebarItem[]
): SidebarItem | null {
  if ((node.children?.length ?? 0) > 0) {
    const children = (node.children ?? [])
      .map((child) => toSidebarItem(child, localMenu))
      .filter((child): child is SidebarItem => child !== null);
    if (children.length === 0) return null;
    return {
      title: node.label,
      icon: undefined,
      children,
    };
  }

  const local = findLocalItem(localMenu, node.path);
  if (!local) return null;

  return {
    title: node.label,
    path: node.path,
    icon: local.icon,
    permissions: local.permissions,
  };
}

export default function Sidebar() {
  const { collapsed, mobileOpen, setMobileOpen } = useSidebar();
  const { permissions } = useAuth();
  const { data: serverNav } = useNavigation();

  /**
   * FR-003: navigation is rendered from the server's filtered navigation
   * tree (single source of truth). When the API is unreachable we fall back
   * to local permission filtering so the shell still renders.
   */
  const menu = serverNav
    ? (serverNav
        .map((node) => toSidebarItem(node, MENU))
        .filter((item): item is SidebarItem => item !== null) ?? [])
    : filterSidebarItems(MENU, permissions);

  return (
    <>
      {/* Mobile drawer backdrop — hidden on desktop. */}
      {mobileOpen ? (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      ) : null}

      <aside
        className={`
          fixed
          inset-y-0
          left-0
          z-40
          w-64
          transition-all
          duration-200
          ${collapsed ? "md:w-20" : "md:w-64"}
          ${mobileOpen ? "translate-x-0" : "-translate-x-full"}
          md:static
          md:translate-x-0
          border-r
          bg-[var(--brand-surface)]
          flex
          flex-col
          h-screen
          overflow-hidden
          shrink-0
        `}
      >
        <SidebarLogo />

        {/* Scrollable menu region: only the sidebar scrolls, the logo and the
            footer stay pinned. overscroll-contain stops scroll bouncing to the
            page once the menu reaches either end. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:thin]">
          <SidebarMenu items={menu} />
        </div>

        <SidebarFooter />
      </aside>
    </>
  );
}
