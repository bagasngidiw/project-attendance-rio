import { PERMISSIONS } from "@contracts/permissions";
import type { ApprovalTargetValue } from "@contracts/approvals";

import { RequestModulePage } from "@/features/requests/RequestModulePage";
import { requestApi } from "@/lib/axios";

export default function Overtime() {
  return (
    <RequestModulePage
      type="OVERTIME"
      title="Lembur"
      description="Ajukan permintaan lembur dan pantau statusnya."
      submitPermission={PERMISSIONS.OVERTIME_SUBMIT}
      submit={async (
        input,
        approvalTarget: ApprovalTargetValue | null
      ) => {
        const res = await requestApi.submitOvertime({
          ...(input as Parameters<typeof requestApi.submitOvertime>[0]),
          approvalTarget: approvalTarget ?? undefined,
        });
        return res.data.data?.id ?? null;
      }}
    />
  );
}
