import { useSidebar } from "@/context/useSidebar";
import { useBranding } from "@/lib/branding";

export default function SidebarLogo() {
  const { collapsed } = useSidebar();
  const { applicationShortName, logoUrl } = useBranding();

  const shortName = applicationShortName || "HRIS";

  return (
    <div className="flex h-20 shrink-0 items-center justify-center gap-2 overflow-hidden border-b px-3">
      {logoUrl ? (
        <img
          src={logoUrl}
          alt={shortName}
          className="max-h-8 max-w-8 shrink-0 object-contain"
        />
      ) : collapsed ? (
        <h1 className="text-xl font-bold">{shortName.charAt(0)}</h1>
      ) : null}
      {!collapsed ? (
        <span className="truncate text-lg font-bold">{shortName}</span>
      ) : null}
    </div>
  );
}
