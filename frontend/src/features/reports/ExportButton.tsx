/**
 * ExportButton — Excel export action (FR-018 §6.3 / FR-005). Downloads the
 * filtered export as a real .xlsx workbook via blob; the server records
 * REPORT.EXPORTED. PDF export was removed (FR-006).
 */

import { useState } from "react";

import { PERMISSIONS } from "@contracts/permissions";
import type { ReportTypeKey, ReportFilters } from "@contracts/reports";

import { reportApi } from "@/lib/axios";
import { apiErrorMessage } from "@/lib/apiError";
import { toast } from "@/lib/toast";
import { Can } from "@/features/auth/Can";
import { Button } from "@/components/ui/Button";

export function ExportButton({
  type,
  filters,
}: {
  type: ReportTypeKey;
  filters: Partial<ReportFilters>;
}) {
  const [busy, setBusy] = useState(false);

  async function handleExport() {
    setBusy(true);
    try {
      const res = await reportApi.export(type, "excel", filters);
      const blob = res.data as Blob;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${type.toLowerCase()}-report.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Ekspor Excel diunduh.");
    } catch (err) {
      toast.error(apiErrorMessage(err) ?? "Ekspor gagal. Periksa izin ekspor Anda.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex gap-2">
      <Can permission={PERMISSIONS.REPORTING_EXPORT_EXCEL}>
        <Button
          size="sm"
          variant="secondary"
          loading={busy}
          onClick={handleExport}
        >
          Ekspor Excel
        </Button>
      </Can>
    </div>
  );
}
