/**
 * 403 Forbidden page (design §6.1 / FR-033): shown when an authenticated user
 * navigates to a page outside their permission set. No sensitive details are
 * revealed.
 */

import { Link } from "react-router-dom";
import { ShieldX } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { ROUTES } from "@/constants/routes";

export default function Forbidden() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="max-w-md rounded-2xl border border-slate-200 bg-[var(--brand-surface)] p-10 text-center shadow-sm">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-red-50 text-red-600">
          <ShieldX size={28} />
        </div>

        <h1 className="text-2xl font-bold">Akses ditolak</h1>
        <p className="mt-2 text-sm text-slate-500">
          Anda tidak memiliki izin untuk melihat halaman ini. Jika Anda merasa
          ini salah, hubungi administrator Anda.
        </p>

        <div className="mt-6">
          <Link to={ROUTES.DASHBOARD}>
            <Button variant="secondary">Kembali ke dasbor</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
