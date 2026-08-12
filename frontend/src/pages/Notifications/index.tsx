/**
 * NotificationInboxPage — full notification list with mark-read and
 * preferences (FR-015). Click-through to the related request.
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { notificationApi } from "@/lib/axios";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";

const PAGE_SIZE = 20;

export default function NotificationInboxPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);

  const inbox = useQuery({
    queryKey: ["notifications", page],
    queryFn: () => notificationApi.list({ page, pageSize: PAGE_SIZE }).then((r) => r.data.data),
  });

  const prefs = useQuery({
    queryKey: ["notification-preferences"],
    queryFn: () => notificationApi.preferences().then((r) => r.data.data),
  });

  const items = inbox.data?.items ?? [];
  const total = inbox.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
    queryClient.invalidateQueries({ queryKey: ["notifications-unread"] });
  }

  async function openNotification(notification: { id: string; link: string; readAt: string | null }) {
    if (!notification.readAt) {
      await notificationApi.markRead(notification.id);
      invalidate();
    }
    navigate(notification.link || "#");
  }

  async function handleMarkAll() {
    await notificationApi.markAllRead();
    toast.success("Semua notifikasi ditandai sebagai sudah dibaca.");
    invalidate();
  }

  async function toggleOptOut(type: string) {
    const current = prefs.data?.optOutTypes ?? [];
    const next = current.includes(type)
      ? current.filter((t) => t !== type)
      : [...current, type];
    await notificationApi.updatePreferences(next);
    toast.success("Preferensi notifikasi diperbarui.");
    prefs.refetch();
  }
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Notifikasi</h2>
          <p className="text-sm text-slate-500">Pembaruan tentang permintaan dan persetujuan Anda.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={handleMarkAll}>
          Tandai semua sudah dibaca
        </Button>
      </div>

      {inbox.isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner label="Memuat notifikasi..." />
        </div>
      ) : inbox.isError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Gagal memuat notifikasi.
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-[var(--brand-surface)] p-8 text-center text-sm text-slate-500">
          Belum ada notifikasi.
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((notification) => (
            <li key={notification.id}>
              <button
                onClick={() => openNotification(notification)}
                className={`w-full rounded-xl border border-slate-200 bg-[var(--brand-surface)] p-4 text-left hover:bg-slate-50 ${
                  notification.readAt ? "opacity-60" : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <p className="font-medium">
                    {notification.title}
                    {!notification.readAt ? (
                      <span className="ml-2 inline-block size-2 rounded-full bg-red-500" />
                    ) : null}
                  </p>
                  <span className="text-xs text-slate-400">
                    {notification.createdAt
                      ? new Date(notification.createdAt).toLocaleString()
                      : ""}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-600">{notification.body}</p>
              </button>
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 ? (
        <div className="flex items-center justify-end gap-2 text-sm text-slate-500">
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
      ) : null}

      {prefs.data ? (
        <div className="rounded-xl border border-slate-200 bg-[var(--brand-surface)] p-5">
          <h3 className="mb-1 font-semibold">Preferensi</h3>
          <p className="mb-3 text-sm text-slate-500">
            Pilih jenis notifikasi yang ingin Anda terima. Jenis wajib tidak dapat dinonaktifkan.
          </p>
          <div className="space-y-2">
            {[
              ["request.assigned", "Persetujuan ditugaskan"],
              ["request.decided", "Permintaan diputuskan"],
              ["request.cancelled", "Permintaan dibatalkan"],
              ["auth.password_reset", "Reset kata sandi"],
            ].map(([type, label]) => {
              const mandatory = prefs.data?.mandatoryTypes.includes(type) ?? false;
              const optedOut = prefs.data?.optOutTypes.includes(type) ?? false;
              return (
                <label key={type} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!optedOut}
                    disabled={mandatory}
                    onChange={() => toggleOptOut(type)}
                    className="size-4 accent-slate-900 disabled:opacity-50"
                  />
                  {label}
                  {mandatory ? (
                    <span className="text-xs text-slate-400">(wajib)</span>
                  ) : null}
                </label>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
