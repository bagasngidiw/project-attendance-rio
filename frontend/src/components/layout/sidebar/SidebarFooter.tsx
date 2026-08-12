import { useAuth } from "@/features/auth/useAuth";
import { useSidebar } from "@/context/useSidebar";

export default function SidebarFooter() {
  const { collapsed } = useSidebar();
  const { user } = useAuth();

  const initials = user?.name
    ? user.name
        .split(" ")
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "?";

  return (
    <div className="border-t p-4 shrink-0">
      <div className="flex items-center gap-3">
        <div className="size-10 rounded-full bg-slate-300 flex items-center justify-center text-sm font-semibold text-slate-700">
          {initials}
        </div>

        {!collapsed && (
          <div className="min-w-0">
            <p className="font-medium truncate">{user?.name ?? "Tamu"}</p>
            <p className="text-sm text-slate-500 truncate">
              {(user?.roles ?? []).join(", ")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
