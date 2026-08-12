import { PanelLeftClose } from "lucide-react";

export default function SidebarCollapse() {
  return (
    <button
      className="
        h-10
        w-10
        rounded-lg
        hover:bg-slate-100
        flex
        items-center
        justify-center
      "
    >
      <PanelLeftClose size={18} />
    </button>
  );
}