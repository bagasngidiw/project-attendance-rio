import { Link, useLocation } from "react-router-dom";
import { ChevronRight } from "lucide-react";

/**
 * BreadCrumbs — derives a simple breadcrumb trail from the current path.
 * Only renders segments beyond the root so the dashboard shows none.
 */

const TITLES: Record<string, string> = {
  dashboard: "Dasbor",
  attendance: "Absensi",
  overtime: "Lembur",
  "business-trip": "Perjalanan Dinas",
  leave: "Cuti",
  users: "Pengguna",
  reports: "Laporan",
  profile: "Profil",
  admin: "Administrasi",
  roles: "Peran & Izin",
  rbac: "Peran & Izin",
  settings: "Pengaturan Platform",
};

export default function BreadCrumbs() {
  const { pathname } = useLocation();
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length === 0) return null;

  return (
    <nav aria-label="Jejak halaman" className="mb-4 text-sm text-slate-500">
      <ol className="flex items-center gap-1.5">
        {segments.map((segment, index) => {
          const href = `/${segments.slice(0, index + 1).join("/")}`;
          const isLast = index === segments.length - 1;
          const title = TITLES[segment] ?? segment;

          if (isLast) {
            return (
              <li key={href} aria-current="page" className="font-medium text-slate-800">
                {title}
              </li>
            );
          }

          return (
            <li key={href} className="flex items-center gap-1.5">
              <Link to={href} className="hover:text-slate-800">
                {title}
              </Link>
              <ChevronRight size={14} />
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
