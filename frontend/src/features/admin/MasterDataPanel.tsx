/**
 * MasterDataPanel — reusable superadmin master-data surface for Cuti types
 * and Sakit types (FR-058 / TODO.md §5-§6). Lists the registry (including
 * PENDING suggestions from "Tambahkan sendiri"), creates new types, and
 * toggles ACTIVE/INACTIVE. Mutations are audited by the backend.
 */

import { useState, type FormEvent } from "react";

import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { apiErrorMessage } from "@/lib/apiError";
import { toast } from "@/lib/toast";

export interface MasterItem {
  id: string;
  key: string;
  name: string;
  description: string;
  status: "ACTIVE" | "PENDING" | "INACTIVE";
  isSystem: boolean;
  isBalanceBased?: boolean;
  maxDaysPerRequest?: number | null;
  requiredSupportingInfo?: boolean;
}

export interface MasterCreatePayload {
  key: string;
  name: string;
  description: string;
  isBalanceBased?: boolean;
  requiredSupportingInfo?: boolean;
}

const STATUS_BADGES: Record<MasterItem["status"], string> = {
  ACTIVE: "bg-emerald-50 text-emerald-700 border-emerald-200",
  PENDING: "bg-amber-50 text-amber-700 border-amber-200",
  INACTIVE: "bg-slate-100 text-slate-500 border-slate-200",
};

const STATUS_LABELS: Record<MasterItem["status"], string> = {
  ACTIVE: "Aktif",
  PENDING: "Menunggu aktivasi",
  INACTIVE: "Nonaktif",
};

export function MasterDataPanel({
  title,
  description,
  items,
  loading,
  error,
  showBalanceFields = false,
  onCreate,
  onActivate,
  onDeactivate,
}: {
  title: string;
  description: string;
  items: MasterItem[];
  loading: boolean;
  error: boolean;
  showBalanceFields?: boolean;
  onCreate: (payload: MasterCreatePayload) => Promise<void>;
  onActivate: (id: string) => Promise<void>;
  onDeactivate: (id: string) => Promise<void>;
}) {
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [isBalanceBased, setIsBalanceBased] = useState(false);
  const [requireInfo, setRequireInfo] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setCreateError("Nama wajib diisi.");
      return;
    }
    if (!key.trim()) {
      setCreateError("Kode (key) wajib diisi, mis. DEMAM_BERDARAH.");
      return;
    }
    setCreateError(null);
    setSubmitting(true);
    try {
      await onCreate({
        key: key.trim().toUpperCase().replace(/\s+/g, "_"),
        name: name.trim(),
        description: desc.trim() || "",
        ...(showBalanceFields
          ? {
              isBalanceBased,
              requiredSupportingInfo: requireInfo,
            }
          : {}),
      });
      toast.success(`${title} berhasil dibuat dan diaudit.`);
      setKey("");
      setName("");
      setDesc("");
      setIsBalanceBased(false);
      setRequireInfo(false);
    } catch (err) {
      setCreateError(apiErrorMessage(err) ?? "Tidak dapat menyimpan data master.");
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleStatus(item: MasterItem) {
    setBusyId(item.id);
    setCreateError(null);
    try {
      if (item.status === "ACTIVE") {
        await onDeactivate(item.id);
        toast.info(`"${item.name}" dinonaktifkan.`);
      } else {
        await onActivate(item.id);
        toast.success(`"${item.name}" diaktifkan.`);
      }
    } catch (err) {
      setCreateError(apiErrorMessage(err) ?? "Tidak dapat mengubah status.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-[var(--brand-surface)]">
      <div className="border-b border-slate-100 p-5">
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-0.5 text-sm text-slate-500">{description}</p>
      </div>

      <form onSubmit={handleCreate} className="grid gap-4 border-b border-slate-100 p-5 sm:grid-cols-2">
        <Input
          label="Kode (key)"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Mis. DEMAM_BERDARAH"
          required
        />
        <Input
          label="Nama"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Mis. Demam Berdarah"
          required
        />
        <div className="sm:col-span-2">
          <Input
            label="Deskripsi"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Penjelasan singkat (opsional)"
          />
        </div>

        {showBalanceFields ? (
          <>
            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Model jatah cuti
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="flex cursor-pointer flex-col gap-1.5 rounded-lg border border-slate-200 p-3 text-sm has-checked:border-slate-900 has-checked:bg-slate-50">
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="modelJatah"
                      checked={isBalanceBased === true}
                      onChange={() => setIsBalanceBased(true)}
                      className="size-4 accent-slate-900"
                    />
                    <span className="font-medium">
                      Berjatah (memakai saldo per karyawan)
                    </span>
                  </span>
                  <p className="text-xs text-slate-500">
                    Setiap karyawan punya jatah pribadi — diisi saat
                    membuat/mengedit pengguna (mis. 12 hari/tahun). Saat
                    mengajukan cuti tipe ini, sisa jatah diperiksa: ditolak
                    bila tidak cukup, dan jatah berkurang setelah disetujui.
                    Contoh: Cuti Tahunan.
                  </p>
                </label>
                <label className="flex cursor-pointer flex-col gap-1.5 rounded-lg border border-slate-200 p-3 text-sm has-checked:border-slate-900 has-checked:bg-slate-50">
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="modelJatah"
                      checked={isBalanceBased === false}
                      onChange={() => setIsBalanceBased(false)}
                      className="size-4 accent-slate-900"
                    />
                    <span className="font-medium">Tanpa jatah</span>
                  </span>
                  <p className="text-xs text-slate-500">
                    Tidak ada saldo; pengajuan tipe ini tidak dibatasi kuota.
                    Contoh: Cuti Sakit.
                  </p>
                </label>
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={requireInfo}
                onChange={(e) => setRequireInfo(e.target.checked)}
                className="size-4 accent-slate-900"
              />
              Wajib dokumen pendukung
            </label>
          </>
        ) : null}

        <div className="flex items-end justify-end sm:col-span-2">
          <Button type="submit" loading={submitting}>
            Buat {title}
          </Button>
        </div>
      </form>

      {createError ? (
        <div
          role="alert"
          className="border-b border-red-100 bg-red-50 px-5 py-3 text-sm text-red-700"
        >
          {createError}
        </div>
      ) : null}

      <div className="p-5">
        {loading ? (
          <div className="flex justify-center py-10">
            <Spinner label="Memuat data master..." />
          </div>
        ) : error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Gagal memuat {title.toLowerCase()}.
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-500">
            Belum ada {title.toLowerCase()}. Buat satu melalui form di atas, atau
            tunggu usulan "Tambahkan sendiri" dari karyawan.
          </div>
        ) : (
          <div className="table-scroll rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Nama</th>
                  <th className="px-4 py-3">Kode</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Keterangan</th>
                  <th className="px-4 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <p className="font-medium">{item.name}</p>
                      {item.isSystem ? (
                        <p className="text-xs text-slate-400">Sistem</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{item.key}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_BADGES[item.status]}`}
                      >
                        {STATUS_LABELS[item.status]}
                      </span>
                    </td>
                    <td className="max-w-[16rem] px-4 py-3 text-xs text-slate-500">
                      {item.description || "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={busyId === item.id}
                        disabled={item.isSystem}
                        onClick={() => toggleStatus(item)}
                      >
                        {item.status === "ACTIVE" ? "Nonaktifkan" : "Aktifkan"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
