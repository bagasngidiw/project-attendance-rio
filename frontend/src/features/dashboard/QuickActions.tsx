/**
 * QuickActions — permission-gated shortcuts surfaced by the backend
 * quick-action keys (FR-025 §6.2 / FR-003/004).
 */

import { Link } from "react-router-dom";

import { ROUTES } from "@/constants/routes";

const ACTION_LINKS: Record<string, { label: string; to: string }> = {
  "attendance:clock_in": { label: "Absen Masuk", to: ROUTES.ATTENDANCE },
  "attendance:clock_out": { label: "Absen Keluar", to: ROUTES.ATTENDANCE },
  "leave:submit": { label: "Ajukan Cuti", to: ROUTES.LEAVE },
  "overtime:submit": { label: "Ajukan Lembur", to: ROUTES.OVERTIME },
  "trip:submit": { label: "Ajukan Perjalanan Dinas", to: ROUTES.BUSINESS_TRIP },
};

export function QuickActions({ actions }: { actions: string[] }) {
  const visible = actions
    .map((key) => ({ key, ...ACTION_LINKS[key] }))
    .filter((action) => action.label);

  if (visible.length === 0) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-[var(--brand-surface)] p-5">
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">
        Aksi cepat
      </p>
      <div className="flex flex-wrap gap-2">
        {visible.map((action) => (
          <Link
            key={action.key}
            to={action.to}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {action.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
