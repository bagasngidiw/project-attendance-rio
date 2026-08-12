/**
 * NotificationService (FR-014 / FR-015).
 *
 * Generates in-app notifications from workflow events via the declarative
 * trigger catalog, resolves recipients (requester, approver, manager-of),
 * applies per-user preferences (mandatory types always deliver), and exposes
 * the owner-scoped inbox + preferences surface.
 */

const {
  TRIGGER_CATALOG,
  RECIPIENT_TARGETS,
  assertTrigger,
  shouldDeliver,
} = require("../domain/notification");
const { ValidationError, NotFoundError } = require("../domain/errors");

const LINK_BY_TYPE = Object.freeze({
  "request.assigned": "/admin/approvals",
  "request.decided": "/my-requests",
  "request.cancelled": "/my-requests",
  "auth.password_reset": "/login",
});

class NotificationService {
  /**
   * @param {import('../infrastructure/repositories/notification.repository').NotificationRepository} deps.notificationRepository
   * @param {import('../infrastructure/repositories/user.repository').UserRepository} deps.userRepository
   * @param {import('../infrastructure/repositories/request.repository').RequestRepository} deps.requestRepository
   */
  constructor({ notificationRepository, userRepository, requestRepository }) {
    this.notificationRepository = notificationRepository;
    this.userRepository = userRepository;
    this.requestRepository = requestRepository;
  }

  /**
   * Creates a notification for one recipient, applying their preferences.
   *
   * @param {object} input
   */
  async create({ userId, type, title, body = "", link = "", relatedRequestId = null }) {
    const user = await this.userRepository.findById(userId);
    if (!user) return null;

    const notification = { type, title, body, link };
    if (!shouldDeliver(notification, user.notificationPreferences ?? {})) {
      return null;
    }
    return this.notificationRepository.create({
      userId,
      type,
      title,
      body,
      link,
      relatedRequestId,
    });
  }

  /**
   * Subscribes the service to the platform EventBus workflow events
   * (FR-014 §A.2). Subscriber failures are caught by the bus.
   *
   * @param {import('../infrastructure/event-bus').EventBus} eventBus
   */
  subscribeToEvents(eventBus) {
    for (const event of Object.keys(TRIGGER_CATALOG)) {
      eventBus.subscribe(event, (payload) => this.onEvent(event, payload));
    }
  }

  /** Handles a workflow event: resolve recipients and notify. */
  async onEvent(event, payload = {}) {
    const trigger = assertTrigger(event);
    const context = await this.resolveContext(event, payload);
    if (!context) return;

    const recipientIds = new Set();
    for (const rule of trigger.recipients) {
      const ids = await this.resolveRecipients(rule.target, context);
      ids.forEach((id) => recipientIds.add(id));
    }

    const body = this.renderBody(event, context);
    for (const userId of recipientIds) {
      await this.create({
        userId,
        type: trigger.type,
        title: trigger.title,
        body,
        link: LINK_BY_TYPE[trigger.type] ?? "",
        relatedRequestId: context.requestId ?? null,
      });
    }
  }

  /** Loads the context needed for recipient resolution + body rendering. */
  async resolveContext(event, payload) {
    if (event === "auth.password_reset") {
      return { userId: payload.userId };
    }
    if (!payload.requestId) return null;

    const request = await this.requestRepository.findById(payload.requestId);
    if (!request) return null;

    const requester = request.requesterId
      ? await this.userRepository.findById(request.requesterId)
      : null;

    return {
      requestId: String(request.id ?? request._id),
      type: request.type,
      status: payload.toStatus ?? request.status,
      requesterId: request.requesterId,
      approverId: request.approverId,
      requesterName: requester?.name ?? "A colleague",
      comment: payload.comment ?? "",
    };
  }

  /** Resolves user ids for a recipient target. */
  async resolveRecipients(target, context) {
    switch (target) {
      case RECIPIENT_TARGETS.REQUESTER:
        return context.userId ? [context.userId] : context.requesterId ? [String(context.requesterId)] : [];
      case RECIPIENT_TARGETS.APPROVER:
        return context.approverId ? [String(context.approverId)] : [];
      case RECIPIENT_TARGETS.MANAGER_OF_REQUESTER: {
        if (!context.requesterId) return [];
        const requester = await this.userRepository.findById(context.requesterId);
        return requester?.managerId ? [String(requester.managerId)] : [];
      }
      default:
        return [];
    }
  }

  /** Renders a short body describing the event. */
  renderBody(event, context) {
    switch (event) {
      case "request.submitted":
        return `${context.requesterName} submitted a ${context.type} request awaiting your approval.`;
      case "request.decided":
        return `Your ${context.type} request was ${String(context.status ?? "").toLowerCase()}.`;
      case "request.cancelled":
        return `A ${context.type} request was cancelled.`;
      case "auth.password_reset":
        return "Your password was reset by an administrator. Set a new one at next sign-in.";
      default:
        return "";
    }
  }

  /* ---------------- Inbox ---------------- */

  async list(userId, filters = {}) {
    const { items, total } = await this.notificationRepository.listByUser(userId, filters);
    return {
      items: items.map((item) => this.toDto(item)),
      total,
      page: filters.page ?? 1,
      pageSize: filters.pageSize ?? 20,
    };
  }

  async unreadCount(userId) {
    return this.notificationRepository.countUnread(userId);
  }

  /** Marks one owned notification read; other users get 404. */
  async markRead(id, userId) {
    const updated = await this.notificationRepository.markRead(id, userId);
    if (!updated) {
      throw new NotFoundError("Notification not found.", "NOTIFICATION_NOT_FOUND");
    }
    return this.toDto(updated);
  }

  async markAllRead(userId) {
    return { markedRead: await this.notificationRepository.markAllRead(userId) };
  }

  /* ---------------- Preferences (FR-015) ---------------- */

  async getPreferences(userId) {
    const user = await this.userRepository.assertExists(userId);
    return {
      optOutTypes: user.notificationPreferences?.optOutTypes ?? [],
      mandatoryTypes: require("../domain/notification").MANDATORY_TYPES,
    };
  }

  async updatePreferences(userId, { optOutTypes = [] }, actor = {}) {
    const user = await this.userRepository.assertExists(userId);
    if (!Array.isArray(optOutTypes)) {
      throw new ValidationError("optOutTypes must be an array.", { field: "optOutTypes" });
    }
    const mandatory = require("../domain/notification").MANDATORY_TYPES;
    const invalid = optOutTypes.filter((t) => mandatory.includes(t));
    if (invalid.length > 0) {
      throw new ValidationError(
        `Mandatory notification types cannot be opted out: ${invalid.join(", ")}.`,
        { field: "optOutTypes" }
      );
    }
    user.notificationPreferences = {
      ...(user.notificationPreferences ?? {}),
      optOutTypes: [...new Set(optOutTypes)],
    };
    await user.save();
    return { optOutTypes: user.notificationPreferences.optOutTypes };
  }

  toDto(notification) {
    return {
      id: String(notification.id ?? notification._id),
      type: notification.type,
      title: notification.title,
      body: notification.body,
      link: notification.link,
      relatedRequestId: notification.relatedRequestId?.toString?.() ?? notification.relatedRequestId,
      readAt: notification.readAt ?? null,
      createdAt: notification.createdAt ?? null,
    };
  }
}

module.exports = { NotificationService };
