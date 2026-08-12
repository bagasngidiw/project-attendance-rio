/**
 * Claim-first helpers (FR-008): a ROLE-targeted request that has not been
 * claimed must be claimed before an approver can Setujui/Tolak. The decision
 * buttons are disabled with a tooltip that explains the required action.
 */

import type { RequestDto } from "@contracts/requests";

import { requestTypeLabel } from "@/lib/labels";

/** True when the request is role-targeted and not yet claimed by anyone. */
export function needsClaimFirst(request: RequestDto): boolean {
  return (
    request.status === "PENDING_APPROVAL" &&
    request.approval?.targetType === "ROLE" &&
    !request.approval?.assignedUserId
  );
}

/** Tooltip shown on the disabled Setujui/Tolak buttons. */
export function claimFirstTooltip(request: RequestDto): string {
  const label = requestTypeLabel(request.type).toLowerCase();
  return `Klaim ${label} ini terlebih dahulu, agar bisa Setujui/Tolak permintaan ini`;
}
