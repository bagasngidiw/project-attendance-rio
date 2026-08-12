import { PERMISSIONS } from "@contracts/permissions";
import type { ApprovalTargetValue } from "@contracts/approvals";

import { RequestModulePage } from "@/features/requests/RequestModulePage";
import { requestApi } from "@/lib/axios";

export default function BusinessTrip() {
  return (
    <RequestModulePage
      type="TRIP"
      title="Perjalanan Dinas"
      description="Ajukan permintaan perjalanan dinas dan pantau statusnya."
      submitPermission={PERMISSIONS.TRIP_SUBMIT}
      submit={async (
        input,
        approvalTarget: ApprovalTargetValue | null
      ) => {
        // FR-009: return the created request id for the optional attachment.
        const res = await requestApi.submitTrip({
          ...(input as Parameters<typeof requestApi.submitTrip>[0]),
          approvalTarget: approvalTarget ?? undefined,
        });
        return res.data.data?.id ?? null;
      }}
    />
  );
}
