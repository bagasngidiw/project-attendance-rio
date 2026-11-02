/**
 * Domain tests: company-wide approval visibility/override capability.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  canOverrideApprovals,
  canSeeAllApprovalHistory,
  isSuperAdmin,
} = require("../../src/domain/approval-access");

test("SUPER_ADMIN role key grants approval override", () => {
  assert.equal(isSuperAdmin({ actorRoleKeys: ["SUPER_ADMIN"] }), true);
  assert.equal(canOverrideApprovals({ actorRoleKeys: ["SUPER_ADMIN"] }), true);
});

test("wildcard and approval:override permissions grant override", () => {
  assert.equal(canOverrideApprovals({ actorPermissions: ["*"] }), true);
  assert.equal(
    canOverrideApprovals({ actorPermissions: ["approval:override"] }),
    true
  );
});

test("module view-all or approve permissions alone do NOT grant pending override", () => {
  assert.equal(
    canOverrideApprovals({ actorPermissions: ["leave:view_all", "leave:approve"] }),
    false
  );
  assert.equal(canOverrideApprovals({ actorRoleKeys: ["HR_ADMIN"] }), false);
  assert.equal(canOverrideApprovals({ actorRoleKeys: ["ADMIN"] }), false);
});

test("history visibility stays broader: any module view-all is enough", () => {
  assert.equal(
    canSeeAllApprovalHistory({ actorPermissions: ["leave:view_all"] }),
    true
  );
  assert.equal(
    canSeeAllApprovalHistory({ actorPermissions: ["dashboard:view"] }),
    false
  );
  assert.equal(
    canSeeAllApprovalHistory({ actorPermissions: ["approval:override"] }),
    true
  );
});
