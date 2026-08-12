/**
 * MyAttendanceHistory — the employee's date-ordered personal history with
 * exception badges (FR-035 §6.1).
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import type { AttendanceRecordDto } from "@contracts/attendance";

import { attendanceApi } from "@/lib/axios";
import { attendanceStatusLabel } from "@/lib/labels";
import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";
import { ExceptionChips } from "./ExceptionBadge";
import { PunctualityBadge } from "./PunctualityBadge";
import { AttendanceDetailDialog } from "./AttendanceDetailDialog";

const PAGE_SIZE = 10;

export function MyAttendanceHistory() {
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<AttendanceRecordDto | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["attendance-me", page],
    queryFn: () =>
      attendanceApi.me({ page, pageSize: PAGE_SIZE }).then((r) => r.data.data),
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <h3 className="mb-3 font-semibold">Riwayat absensi saya</h3>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Spinner label="Memuat riwayat..." />
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Gagal memuat riwayat absensi Anda.
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-[var(--brand-surface)] p-8 text-center text-sm text-slate-500">
          Belum ada catatan absensi.
        </div>
      ) : (
        <>
          <div className="table-scroll rounded-xl border border-slate-200 bg-[var(--brand-surface)]">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
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
                      <Button size="sm" variant="secondary" onClick={() => setDetail(record)}>
                        Detail
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex items-center justify-between text-sm text-slate-500">
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

      {detail ? <AttendanceDetailDialog record={detail} onClose={() => setDetail(null)} /> : null}
    </div>
  );
}

/** FR-002: "Cuti" badge for approved-leave attendance rows. */
function LeaveBadge() {
  return (
    <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
      {attendanceStatusLabel("LEAVE")}
    </span>
  );
}
