/**
 * UserDropdown — current user + roles and sign-out actions (design §6.3
 * UserBadge). Includes "Sign out everywhere" so users can end sessions on
 * other devices (FR-001 open question answered affirmatively).
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, LogOut, MonitorX } from "lucide-react";

import { useAuth } from "@/features/auth/useAuth";
import { ROUTES } from "@/constants/routes";

export default function UserDropdown() {
  const { user, signOut, signOutAll } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  const initials = user.name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  async function handleSignOut() {
    setBusy(true);
    await signOut();
    navigate(ROUTES.LOGIN, { replace: true });
  }

  async function handleSignOutAll() {
    setBusy(true);
    await signOutAll();
    navigate(ROUTES.LOGIN, { replace: true });
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-50"
      >
        <div className="size-10 rounded-full bg-slate-300 flex items-center justify-center text-sm font-semibold text-slate-700">
          {initials}
        </div>

        <div className="text-left hidden sm:block">
          <p className="font-medium leading-tight">{user.name}</p>
          <p className="text-sm text-slate-500 leading-tight">
            {(user.roles ?? []).join(", ")}
          </p>
        </div>

        <ChevronDown size={16} className="text-slate-400" />
      </button>

      {open ? (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            role="menu"
            className="absolute right-0 z-20 mt-2 w-64 max-w-[calc(100vw-1rem)] rounded-xl border border-slate-200 bg-[var(--brand-surface)] p-1.5 shadow-lg"
          >
            <div className="border-b border-slate-100 px-3 py-2">
              <p className="text-sm font-medium">{user.name}</p>
              <p className="text-xs text-slate-500">{user.email}</p>
            </div>

            <button
              role="menuitem"
              onClick={handleSignOut}
              disabled={busy}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              <LogOut size={16} />
              Keluar
            </button>

            <button
              role="menuitem"
              onClick={handleSignOutAll}
              disabled={busy}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              <MonitorX size={16} />
              Keluar dari semua perangkat
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
