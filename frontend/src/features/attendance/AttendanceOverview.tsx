/**
 * AttendanceOverview — HR attendance management surface (FR-041): filters
 * (employee, department, date range, exception), paginated table with
 * exception badges, and a Correct action (FR-020).
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import type { AttendanceRecordDto } from "@contracts/attendance";

import { attendanceApi } from "@/lib/axios";
import { attendanceStatusLabel } from "@/lib/labels";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { ExceptionChips } from "./ExceptionBadge";
import { PunctualityBadge } from "./PunctualityBadge";
import { CorrectionDialog } from "./CorrectionDialog";

const PAGE_SIZE = 10;

export function AttendanceOverview() {
  const [employeeId, setEmployeeId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [exception, setException] = useState("");
  const [page, setPage] = useState(1);
  const [correcting, setCorrecting] = useState<AttendanceRecordDto | null>(null);

  const params = {
    employeeId: employeeId || undefined,
    departmentId: departmentId || undefined,
    from: from || undefined,
    to: to || undefined,
    exception: exception || undefined,
    page,
    pageSize: PAGE_SIZE,
  };

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["attendance-overview", params],
    queryFn: () => attendanceApi.overview(params).then((r) => r.data.data),
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function resetAndRefetch() {
    setPage(1);
    refetch();
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-xl font-bold">Ikhtisar Absensi</h2>
        <p className="text-sm text-slate-500">
          Absensi seluruh karyawan dalam lingkup Anda, dengan penanda pengecualian.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          resetAndRefetch();
        }}
        className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-[var(--brand-surface)] p-4"
      >
        <div className="w-full sm:w-56">
          <Input
            label="ID karyawan"
            placeholder="ID pengguna"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
          />
        </div>
        <div className="w-full sm:w-56">
          <Input
            label="ID departemen"
            placeholder="ID departemen"
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
          />
        </div>
        <div className="w-full sm:w-44">
          <Input type="date" label="Dari" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="w-full sm:w-44">
          <Input type="date" label="Sampai" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="w-full sm:w-44">
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Pengecualian
          </label>
          <select
            className="h-10 w-full rounded-lg border border-slate-200 bg-[var(--brand-surface)] px-3 text-sm focus:border-slate-900 focus:outline-none"
            value={exception}
            onChange={(e) => setException(e.target.value)}
          >
            <option value="">Semua</option>
            <option value="MISSING_CLOCK_IN">Absen masuk tidak ada</option>
            <option value="MISSING_CLOCK_OUT">Absen keluar tidak ada</option>
            <option value="DUPLICATE">Duplikat</option>
            <option value="CONFLICT">Konflik</option>
            <option value="ANOMALY">Anomali</option>
          </select>
        </div>
        <Button type="submit" size="md">
          Terapkan
        </Button>
      </form>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner label="Memuat absensi..." />
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Gagal memuat absensi.
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-[var(--brand-surface)] p-8 text-center text-sm text-slate-500">
          Tidak ada catatan absensi yang sesuai dengan filter.
        </div>
      ) : (
        <>
          <div className="table-scroll rounded-xl border border-slate-200 bg-[var(--brand-surface)]">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Karyawan</th>
                  <th className="px-4 py-3">Tanggal</th>
                  <th className="px-4 py-3">Absen masuk</th>
                  <th className="px-4 py-3">Absen keluar</th>
                  <th className="px-4 py-3">Ketepatan</th>
                  <th className="px-4 py-3">Pengecualian</th>
                  <th className="px-4 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((record) => (
                  <tr key={record.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <p className="font-medium">{record.user?.name ?? record.userId}</p>
                      <p className="font-mono text-xs text-slate-400">{record.user?.username}</p>
                    </td>
                    <td className="px-4 py-3 font-medium">{record.date}</td>
                    <td className="px-4 py-3">
                      {record.status === "LEAVE"
                        ? "—"
                        : record.clockInAt
                          ? new Date(record.clockInAt).toLocaleTimeString()
                          : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {record.status === "LEAVE"
                        ? "—"
                        : record.clockOutAt
                          ? new Date(record.clockOutAt).toLocaleTimeString()
                          : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {record.status === "LEAVE" ? (
                        <LeaveBadge />
                      ) : (
                        <PunctualityBadge punctuality={record.punctuality} />
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {record.status === "LEAVE" ? (
                        <span className="text-xs text-slate-400">—</span>
                      ) : (
                        <ExceptionChips types={record.exceptionTypes} />
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="secondary" onClick={() => setCorrecting(record)}>
                        Koreksi
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
            <span>{total} catatan</span>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40 hover:bg-slate-50"
              >
                Sebelumnya
              </button>
              <span>
                Halaman {page} dari {totalPages}
              </span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40 hover:bg-slate-50"
              >
                Berikutnya
              </button>
            </div>
          </div>
        </>
      )}

      {correcting ? (
        <CorrectionDialog
          record={correcting}
          onClose={() => setCorrecting(null)}
          onSaved={() => {
            setCorrecting(null);
            refetch();
          }}
        />
      ) : null}
    </div>
  );
}

/** FR-002: "Cuti" badge for approved-leave attendance rows in the HR overview. */
function LeaveBadge() {
  return (
    <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
      {attendanceStatusLabel("LEAVE")}
    </span>
  );
}
