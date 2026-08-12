/**
 * Notification domain model (FR-014 / FR-015).
 *
 * Notifications are generated declaratively from workflow events via a
 * trigger catalog: each event maps to recipient rules and a template. The
 * notification carries enough context (request id, type, status) to navigate
 * back. Preferences (FR-015) are a per-user opt-out list; mandatory types
 * cannot be opted out.
 */

const MANDATORY_TYPES = Object.freeze(["request.assigned", "auth.password_reset"]);

/** Recipient resolution targets. */
const RECIPIENT_TARGETS = Object.freeze({
  REQUESTER: "REQUESTER",
  APPROVER: "APPROVER",
  MANAGER_OF_REQUESTER: "MANAGER_OF_REQUESTER",
  ROLE: "ROLE",
});

/** Declarative trigger catalog (FR-014 §A.1). */
const TRIGGER_CATALOG = Object.freeze({
  "request.submitted": Object.freeze({
    type: "request.assigned",
    recipients: [
      { target: RECIPIENT_TARGETS.APPROVER },
      { target: RECIPIENT_TARGETS.MANAGER_OF_REQUESTER },
    ],
    title: "Permintaan baru menunggu persetujuan Anda",
  }),
  "request.decided": Object.freeze({
    type: "request.decided",
    recipients: [{ target: RECIPIENT_TARGETS.REQUESTER }],
    title: "Permintaan Anda telah diputuskan",
  }),
  "request.cancelled": Object.freeze({
    type: "request.cancelled",
    recipients: [{ target: RECIPIENT_TARGETS.APPROVER }],
    title: "Sebuah permintaan dibatalkan",
  }),
  "auth.password_reset": Object.freeze({
    type: "auth.password_reset",
    recipients: [{ target: RECIPIENT_TARGETS.REQUESTER }],
    title: "Kata sandi Anda telah direset",
  }),
});

/** Throws when an event has no registered trigger. */
function assertTrigger(event) {
  if (!TRIGGER_CATALOG[event]) {
    throw new Error(`No notification trigger registered for event "${event}".`);
  }
  return TRIGGER_CATALOG[event];
}

/** True when a notification type may not be opted out. */
function isMandatoryType(type) {
  return MANDATORY_TYPES.includes(type);
}

/**
 * Applies preferences to a generated notification: mandatory types always
 * deliver; otherwise opted-out types are skipped (FR-015 §A.7).
 *
 * @param {{ type: string }} notification
 * @param {{ optOutTypes?: string[] }} preferences
 */
function shouldDeliver(notification, preferences = {}) {
  if (isMandatoryType(notification.type)) return true;
  return !(preferences.optOutTypes ?? []).includes(notification.type);
}

module.exports = {
  MANDATORY_TYPES,
  RECIPIENT_TARGETS,
  TRIGGER_CATALOG,
  assertTrigger,
  isMandatoryType,
  shouldDeliver,
};
