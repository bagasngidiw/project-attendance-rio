/**
 * PermissionGate — action-level UI gating (design §6.2 `<Can>` / FR-004
 * foundation). Renders children only when the user holds the required
 * permission, otherwise renders nothing (or an optional fallback).
 *
 * Deprecated alias: use `Can` from "./Can" instead.
 */

import { Can } from "./Can";

export function PermissionGate(props: {
  permission: Parameters<typeof Can>[0]["permission"];
  fallback?: Parameters<typeof Can>[0]["fallback"];
  children: Parameters<typeof Can>[0]["children"];
}) {
  return <Can {...props} />;
}
