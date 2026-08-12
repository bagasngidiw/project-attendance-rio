/**
 * RequestAttachments — FR-010. Reusable attachment list + authenticated
 * download for request detail and approval review ("Tinjau") surfaces.
 *
 * Downloads always go through the authenticated axios session (blob fetch +
 * programmatic download); anonymous `<a href>` URLs are never used so files
 * are never exposed without a valid token. Internal storage keys are never
 * rendered.
 */

import { useQuery } from "@tanstack/react-query";

import type { AttachmentDto } from "@contracts/attachments";

import { attachmentApi } from "@/lib/axios";
import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";
import { toast } from "@/lib/toast";
import { apiErrorMessage } from "@/lib/apiError";

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function downloadAttachment(item: AttachmentDto) {
  try {
    const blob = await attachmentApi.download(item.id);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = item.originalName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    toast.error(apiErrorMessage(err) ?? "Tidak dapat mengunduh lampiran.");
  }
}

export function RequestAttachments({ requestId }: { requestId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["request-attachments", requestId],
    queryFn: () =>
      attachmentApi.list(requestId).then((r) => r.data.data?.items ?? []),
  });

  const items = data ?? [];

  if (isLoading) {
    return (
      <section className="rounded-lg border border-slate-100 bg-slate-50 p-3">
        <h5 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Lampiran
        </h5>
        <div className="flex justify-center py-2">
          <Spinner label="Memuat lampiran..." />
        </div>
      </section>
    );
  }

  if (isError) {
    return (
      <section className="rounded-lg border border-slate-100 bg-slate-50 p-3">
        <h5 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Lampiran
        </h5>
        <p className="text-xs text-red-600">Gagal memuat lampiran.</p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-slate-100 bg-slate-50 p-3">
      <h5 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Lampiran
      </h5>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">Tidak ada lampiran.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-800">
                  {item.originalName}
                </p>
                <p className="text-xs text-slate-400">
                  {formatSize(item.sizeBytes)}
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => downloadAttachment(item)}
              >
                Unduh
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
