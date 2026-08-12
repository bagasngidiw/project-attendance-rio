/**
 * QuotaAndScheduleSection — TODO.md FR-001/FR-002/FR-011. Shared "KONFIGURASI
 * CUTI" (Jatah Cuti) + "KONFIGURASI JADWAL KERJA" (hari + jam) block used by
 * Create User and Edit User so both surfaces stay consistent (one model).
 */

export interface QuotaScheduleValue {
  jatahCuti: string;
  workingDays: number[];
  workingStartTime: string;
  workingEndTime: string;
}

// Shared default exported for use by Create/Edit User dialogs (not a component).
// eslint-disable-next-line react-refresh/only-export-components
export const DEFAULT_QUOTA_SCHEDULE: QuotaScheduleValue = {
  jatahCuti: "",
  workingDays: [1, 2, 3, 4, 5], // Senin..Jumat
  workingStartTime: "08:00",
  workingEndTime: "17:00",
};

const DAY_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 1, label: "Sen" },
  { value: 2, label: "Sel" },
  { value: 3, label: "Rab" },
  { value: 4, label: "Kam" },
  { value: 5, label: "Jum" },
  { value: 6, label: "Sab" },
  { value: 0, label: "Min" },
];

export function QuotaAndScheduleSection({
  value,
  onChange,
  disabled = false,
}: {
  value: QuotaScheduleValue;
  onChange: (next: QuotaScheduleValue) => void;
  disabled?: boolean;
}) {
  function toggleDay(day: number) {
    if (disabled) return;
    const next = new Set(value.workingDays);
    if (next.has(day)) next.delete(day);
    else next.add(day);
    onChange({ ...value, workingDays: [...next].sort((a, b) => a - b) });
  }

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 p-4">
      <div>
        <h4 className="font-semibold">Konfigurasi Cuti</h4>
        <div className="mt-2">
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Jatah Cuti (Hari)
          </label>
          <input
            type="number"
            min={0}
            max={365}
            value={value.jatahCuti}
            onChange={(e) => onChange({ ...value, jatahCuti: e.target.value })}
            placeholder="mis. 12"
            disabled={disabled}
            className="h-10 w-full rounded-lg border border-slate-200 bg-[var(--brand-surface)] px-3 text-sm focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 disabled:cursor-not-allowed disabled:bg-slate-50"
          />
        </div>
      </div>

      <div>
        <h4 className="font-semibold">Konfigurasi Jadwal Kerja</h4>
        <div className="mt-2">
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Hari kerja
          </label>
          <div className="flex flex-wrap gap-1.5">
            {DAY_OPTIONS.map((day) => (
              <label
                key={day.value}
                className={`flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm has-checked:border-slate-900 has-checked:bg-slate-50 ${
                  disabled ? "cursor-not-allowed opacity-60" : ""
                }`}
              >
                <input
                  type="checkbox"
                  checked={value.workingDays.includes(day.value)}
                  onChange={() => toggleDay(day.value)}
                  disabled={disabled}
                  className="size-4 accent-slate-900"
                />
                {day.label}
              </label>
            ))}
          </div>
        </div>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              Jam masuk
            </label>
            <input
              type="time"
              value={value.workingStartTime}
              onChange={(e) => onChange({ ...value, workingStartTime: e.target.value })}
              disabled={disabled}
              className="h-10 w-full rounded-lg border border-slate-200 bg-[var(--brand-surface)] px-3 text-sm focus:border-slate-900 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-50"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              Jam selesai
            </label>
            <input
              type="time"
              value={value.workingEndTime}
              onChange={(e) => onChange({ ...value, workingEndTime: e.target.value })}
              disabled={disabled}
              className="h-10 w-full rounded-lg border border-slate-200 bg-[var(--brand-surface)] px-3 text-sm focus:border-slate-900 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-50"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
