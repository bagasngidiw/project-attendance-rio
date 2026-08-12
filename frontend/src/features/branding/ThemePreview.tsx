/**
 * ThemePreview (FR-005 + UIUXDESIGN.md) — a representative preview of the
 * customer IDENTITY rendered on the FIXED SIMBIKA product palette. There are
 * no color controls here: the product owns the design.
 */

interface ThemePreviewProps {
  applicationName: string;
  applicationShortName: string;
  logoUrl: string | null;
}

export function ThemePreview({ applicationName, applicationShortName, logoUrl }: ThemePreviewProps) {
  return (
    <div className="mt-6 rounded-xl border border-[var(--brand-border)] p-4">
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--brand-text-muted)]">
        Pratinjau
      </h4>

      <div className="overflow-hidden rounded-xl border border-[var(--brand-border)] bg-[var(--brand-surface)]">
        <div className="flex">
          {/* Mini sidebar — fixed palette, red active nav */}
          <div className="w-24 shrink-0 border-r border-[var(--brand-border)] bg-[var(--brand-surface)] p-3">
            <div className="mb-4 flex items-center gap-1.5">
              {logoUrl ? (
                <img src={logoUrl} alt="Logo" className="max-h-6 max-w-full object-contain" />
              ) : (
                <span className="text-sm font-bold text-[var(--brand-text)]">
                  {applicationShortName}
                </span>
              )}
            </div>
            <div className="mb-1 rounded-md bg-[var(--brand-primary)] px-2 py-1 text-xs font-medium text-[var(--brand-on-primary)]">
              Dasbor
            </div>
            <div className="px-2 py-1 text-xs text-[var(--brand-text-muted)]">Absensi</div>
            <div className="px-2 py-1 text-xs text-[var(--brand-text-muted)]">Laporan</div>
          </div>

          {/* Mini content — fixed neutral surface */}
          <div className="flex-1 space-y-3 bg-[var(--brand-surface)] p-4">
            <p className="text-sm font-semibold text-[var(--brand-text)]">{applicationName}</p>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-lg bg-[var(--brand-primary)] px-3 py-1.5 text-xs font-medium text-[var(--brand-on-primary)]"
              >
                Tombol Utama
              </button>
              <button
                type="button"
                className="rounded-lg bg-[var(--brand-secondary)] px-3 py-1.5 text-xs font-medium text-[var(--brand-on-secondary)]"
              >
                Tombol Sekunder
              </button>
              <button
                type="button"
                className="rounded-lg bg-[var(--brand-danger)] px-3 py-1.5 text-xs font-medium text-white"
              >
                Hapus
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5 text-xs">
              <span className="rounded-full bg-[var(--brand-success)] px-2 py-0.5 font-medium text-white">
                Disetujui
              </span>
              <span className="rounded-full bg-[var(--brand-warning)] px-2 py-0.5 font-medium text-white">
                Menunggu
              </span>
              <span className="rounded-full bg-[var(--brand-danger)] px-2 py-0.5 font-medium text-white">
                Ditolak
              </span>
            </div>

            <input
              type="text"
              readOnly
              value="Contoh input..."
              className="h-8 w-full rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface)] px-2 text-xs text-[var(--brand-text-muted)]"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
