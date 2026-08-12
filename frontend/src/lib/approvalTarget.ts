/**
 * approvalTargetTypeFor — maps a request type to the API `type` alias accepted
 * by GET /approval-targets (FR-003). Kept out of the React component module so
 * react-refresh can scope fast refresh to component-only exports.
 */

import type { RequestType } from "@contracts/requests";
import type { ApprovalTargetType } from "@contracts/approvals";

export function approvalTargetTypeFor(type: RequestType): ApprovalTargetType {
  switch (type) {
    case "LEAVE":
      return "leave";
    case "OVERTIME":
      return "overtime";
    case "TRIP":
      return "business_trip";
    case "PERMISSION":
      return "permission";
    case "SAKIT":
      return "sakit";
  }
}
