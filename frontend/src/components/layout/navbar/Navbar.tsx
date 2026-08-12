import { Menu, PanelLeft } from "lucide-react";

import { useSidebar } from "@/context/useSidebar";
import { NotificationBell } from "@/components/layout/notifications/NotificationBell";
import UserDropdown from "@/components/layout/UserDropdown";
import { useBranding } from "@/lib/branding";

export default function Navbar() {
  const { toggleSidebar, setMobileOpen } = useSidebar();
  const { applicationName, applicationShortName, logoUrl } = useBranding();

  return (
    <header className="flex h-16 items-center justify-between border-b border-[var(--brand-border)] bg-[var(--brand-surface)] px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-4">
        {/* Mobile hamburger — opens the drawer sidebar. */}
        <button
          onClick={() => setMobileOpen(true)}
          aria-label="Buka menu"
          className="
            h-10
            w-10
            rounded-lg
            hover:bg-slate-100
            flex
            items-center
            justify-center
            md:hidden
          "
        >
          <Menu size={20} />
        </button>

        {/* Desktop collapse toggle. */}
        <button
          onClick={toggleSidebar}
          aria-label="Beralih sidebar"
          className="
            h-10
            w-10
            rounded-lg
            hover:bg-slate-100
            hidden
            md:flex
            items-center
            justify-center
          "
        >
          <PanelLeft size={20} />
        </button>

        <div className="flex min-w-0 items-center gap-2.5">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt=""
              className="h-8 w-8 shrink-0 object-contain"
            />
          ) : null}
          <div className="leading-tight">
            <p className="truncate text-sm font-semibold">
              {applicationShortName || "HRIS"}
            </p>
            <p className="max-w-64 truncate text-xs text-slate-500">
              {applicationName}
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <NotificationBell />
        <UserDropdown />
      </div>
    </header>
  );
}
