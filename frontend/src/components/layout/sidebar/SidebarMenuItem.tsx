import { NavLink } from "react-router-dom";

import type { SidebarItem } from "@/types/sidebar";
import { useSidebar } from "@/context/useSidebar";

interface SidebarMenuItemProps {
  item: SidebarItem;
}

export default function SidebarMenuItem({ item }: SidebarMenuItemProps) {
  const { collapsed, setMobileOpen } = useSidebar();
  const hasChildren = (item.children?.length ?? 0) > 0;

  // Group items render as a subtle section label followed by their children
  // as flat menu items. The label is hidden when the sidebar is collapsed so
  // the icon-only rail stays clean.
  if (hasChildren) {
    return (
      <div className="space-y-1">
        {!collapsed ? (
          <p className="px-4 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {item.title}
          </p>
        ) : null}
        <div className="space-y-1">
          {item.children!.map((child) => (
            <SidebarMenuItem key={child.path ?? child.title} item={child} />
          ))}
        </div>
      </div>
    );
  }

  const Icon = item.icon;

  return (
    <NavLink
      to={item.path ?? "#"}
      title={item.title}
      onClick={() => setMobileOpen(false)}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-lg px-4 py-3 transition-all duration-200 ${
          isActive
            ? "bg-[var(--brand-primary)] text-[var(--brand-on-primary)]"
            : "hover:bg-slate-100"
        }`
      }
    >
      {Icon ? <Icon size={20} className="shrink-0" /> : null}

      {!collapsed && <span className="truncate">{item.title}</span>}
    </NavLink>
  );
}
