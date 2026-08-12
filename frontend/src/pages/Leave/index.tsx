import { PERMISSIONS } from "@contracts/permissions";
import type { ApprovalTargetValue } from "@contracts/approvals";

import { RequestModulePage } from "@/features/requests/RequestModulePage";
import { requestApi } from "@/lib/axios";

export default function Leave() {
  return (
    <RequestModulePage
      type="LEAVE"
      title="Cuti"
      description="Ajukan permintaan cuti sakit, pribadi, atau tahunan dan pantau statusnya."
      submitPermission={PERMISSIONS.LEAVE_SUBMIT}
      submit={async (
        input,
        approvalTarget: ApprovalTargetValue | null
      ) => {
        // FR-009: return the created request id for the optional attachment.
        const res = await requestApi.submitLeave({
          ...(input as Parameters<typeof requestApi.submitLeave>[0]),
          approvalTarget: approvalTarget ?? undefined,
        });
        return res.data.data?.id ?? null;
      }}
    />
  );
}
