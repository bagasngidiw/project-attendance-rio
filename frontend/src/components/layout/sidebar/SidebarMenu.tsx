import type { SidebarItem } from "@/types/sidebar";
import SidebarMenuItem from "./SidebarMenuItem";

interface SidebarMenuProps {
  items: SidebarItem[];
}

export default function SidebarMenu({
  items,
}: SidebarMenuProps) {
  return (
    <nav className="flex-1 p-3 space-y-2">
      {items.map((item) => (
        <SidebarMenuItem
          key={item.path ?? item.title}
          item={item}
        />
      ))}
    </nav>
  );
}
