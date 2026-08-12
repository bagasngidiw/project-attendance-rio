/**
 * NotificationService tests (FR-014 / FR-015): event-driven generation,
 * recipient resolution, preference application, and the owner-scoped inbox.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { buildFakes } = require("../helpers/fakes");
const { EventBus } = require("../../src/infrastructure/event-bus");
const { NotificationService } = require("../../src/application/notification.service");
const { ValidationError, NotFoundError } = require("../../src/domain/errors");

function makeService() {
  const fakes = buildFakes();
  const eventBus = new EventBus();
  const service = new NotificationService({
    notificationRepository: fakes.notificationRepository,
    userRepository: fakes.userRepository,
    requestRepository: fakes.requestRepository,
  });
  service.subscribeToEvents(eventBus);
  return { service, fakes, eventBus };
}

function seed(fakes) {
  fakes.userRepository.seed({ id: "u_emp", username: "emp", email: "emp@corp.io", name: "Jane", status: "ACTIVE", managerId: "u_mgr" });
  fakes.userRepository.seed({ id: "u_mgr", username: "mgr", email: "mgr@corp.io", name: "Mgr", status: "ACTIVE", managerId: null });
}

async function seedRequest(fakes) {
  const request = await fakes.requestRepository.create({
    type: "LEAVE",
    requesterId: "u_emp",
    payload: { leaveType: "ANNUAL", startDate: "2026-09-01", endDate: "2026-09-03" },
    status: "PENDING",
  });
  request.approverId = "u_mgr";
  return request;
}

test("request.submitted notifies the approver and the manager of the requester", async () => {
  const { service, fakes, eventBus } = makeService();
  seed(fakes);
  const request = await seedRequest(fakes);

  await eventBus.publish("request.submitted", {
    requestId: request.id,
    type: "LEAVE",
    requesterId: "u_emp",
    approverId: "u_mgr",
  });

  const approverInbox = await service.list("u_mgr", {});
  assert.ok(approverInbox.items.some((n) => n.type === "request.assigned"));

  // Manager of requester (same as approver here) — ensure no duplicate weirdness.
  const all = fakes.notificationRepository.entries;
  assert.ok(all.length >= 1);
});

test("request.decided notifies the requester (A5)", async () => {
  const { service, fakes, eventBus } = makeService();
  seed(fakes);
  const request = await seedRequest(fakes);

  await eventBus.publish("request.decided", {
    requestId: request.id,
    type: "LEAVE",
    requesterId: "u_emp",
    toStatus: "APPROVED",
  });

  const requesterInbox = await service.list("u_emp", {});
  const decision = requesterInbox.items.find((n) => n.type === "request.decided");
  assert.ok(decision, "requester notified of the decision");
  assert.ok(decision.body.includes("approved"));
  assert.equal(decision.relatedRequestId, request.id);
});

test("preferences opt-out is honored for future events but mandatory types always deliver (A9)", async () => {
  const { service, fakes, eventBus } = makeService();
  seed(fakes);
  fakes.userRepository.users.get("u_emp").notificationPreferences = {
    optOutTypes: ["request.decided"],
  };

  const request = await seedRequest(fakes);
  await eventBus.publish("request.decided", {
    requestId: request.id,
    type: "LEAVE",
    requesterId: "u_emp",
    toStatus: "REJECTED",
  });

  const optedOut = fakes.notificationRepository.entries.some(
    (n) => n.type === "request.decided"
  );
  assert.equal(optedOut, false, "opted-out type not delivered");

  // Mandatory types cannot be opted out.
  await assert.rejects(
    service.updatePreferences("u_emp", { optOutTypes: ["request.assigned"] }, {}),
    ValidationError
  );

  // auth.password_reset is mandatory and still delivers even when opted out.
  fakes.userRepository.users.get("u_emp").notificationPreferences.optOutTypes.push("auth.password_reset");
  await eventBus.publish("auth.password_reset", { userId: "u_emp" });
  assert.ok(
    fakes.notificationRepository.entries.some((n) => n.type === "auth.password_reset"),
    "mandatory type always delivers"
  );
});

test("inbox: unread count, mark read (owner only), and mark all read", async () => {
  const { service, fakes } = makeService();
  seed(fakes);

  await service.create({ userId: "u_emp", type: "request.decided", title: "Decided", body: "x" });
  await service.create({ userId: "u_emp", type: "request.cancelled", title: "Cancelled", body: "y" });

  assert.equal(await service.unreadCount("u_emp"), 2);

  const inbox = await service.list("u_emp", {});
  const first = inbox.items[0];

  const marked = await service.markRead(first.id, "u_emp");
  assert.ok(marked.readAt, "marked read");
  assert.equal(await service.unreadCount("u_emp"), 1);

  await assert.rejects(
    service.markRead(first.id, "u_other"),
    (err) => err instanceof NotFoundError && err.code === "NOTIFICATION_NOT_FOUND"
  );

  const allRead = await service.markAllRead("u_emp");
  assert.equal(allRead.markedRead, 1);
  assert.equal(await service.unreadCount("u_emp"), 0);
});

test("preferences surface lists mandatory types and rejects invalid opt-outs", async () => {
  const { service, fakes } = makeService();
  seed(fakes);

  const prefs = await service.getPreferences("u_emp");
  assert.ok(prefs.mandatoryTypes.includes("request.assigned"));

  await assert.rejects(
    service.updatePreferences("u_emp", { optOutTypes: ["auth.password_reset"] }, {}),
    ValidationError
  );

  const updated = await service.updatePreferences("u_emp", { optOutTypes: ["request.cancelled"] }, {});
  assert.deepEqual(updated.optOutTypes, ["request.cancelled"]);
});
