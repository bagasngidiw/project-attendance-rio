/**
 * NotificationBell — navbar bell with unread count + recent-notifications
 * dropdown (FR-014 §A.8). Clicking a notification marks it read and
 * navigates to its link.
 */

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

import { notificationApi } from "@/lib/axios";
import { ROUTES } from "@/constants/routes";

export function NotificationBell() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data: unread } = useQuery({
    queryKey: ["notifications-unread"],
    queryFn: () => notificationApi.unreadCount().then((r) => r.data.data?.unread ?? 0),
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  });

  const { data: recent } = useQuery({
    queryKey: ["notifications-recent"],
    queryFn: () => notificationApi.list({ page: 1, pageSize: 5 }).then((r) => r.data.data),
    enabled: open,
  });

  useEffect(() => {
    function onOutsideClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onOutsideClick);
    return () => document.removeEventListener("mousedown", onOutsideClick);
  }, []);

  async function handleOpen(id: string, link: string) {
    setOpen(false);
    await notificationApi.markRead(id);
    queryClient.invalidateQueries({ queryKey: ["notifications-unread"] });
    navigate(link || ROUTES.NOTIFICATIONS);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifikasi"
        className="relative flex size-10 items-center justify-center rounded-lg hover:bg-slate-100"
      >
        <Bell size={20} />
        {unread ? (
          <span className="absolute right-1.5 top-1.5 flex size-4 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-80 rounded-xl border border-slate-200 bg-[var(--brand-surface)] p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold">Notifikasi</p>
            <Link
              to={ROUTES.NOTIFICATIONS}
              className="text-xs text-slate-500 hover:underline"
              onClick={() => setOpen(false)}
            >
              Lihat semua
            </Link>
          </div>
          <ul className="max-h-80 space-y-1 overflow-auto">
            {(recent?.items ?? []).length === 0 ? (
              <li className="py-6 text-center text-sm text-slate-400">
                Belum ada notifikasi.
              </li>
            ) : (
              recent?.items.map((notification) => (
                <li key={notification.id}>
                  <button
                    onClick={() => handleOpen(notification.id, notification.link)}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50 ${
                      notification.readAt ? "opacity-60" : ""
                    }`}
                  >
                    <p className="font-medium">{notification.title}</p>
                    <p className="truncate text-xs text-slate-500">{notification.body}</p>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
