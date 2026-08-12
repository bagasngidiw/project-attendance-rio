/**
 * LeaveQuotaService (TODO.md §7) — tracks per-leave-type quota usage.
 *
 * Subscribes to `request.decided`: when a LEAVE request is APPROVED, the
 * employee's quota `usedDays` for the matching leave type is incremented by
 * the number of requested days. The backend is the source of truth for
 * remaining quota (allocated - used).
 */

class LeaveQuotaService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/repositories/user.repository').UserRepository} deps.userRepository
   * @param {import('../infrastructure/repositories/leave-type.repository').LeaveTypeRepository} deps.leaveTypeRepository
   * @param {import('../infrastructure/event-bus').EventBus} deps.eventBus
   */
  constructor({ userRepository, leaveTypeRepository, eventBus }) {
    this.userRepository = userRepository;
    this.leaveTypeRepository = leaveTypeRepository;
    if (eventBus) {
      eventBus.subscribe("request.decided", (payload) => this.onDecided(payload));
    }
  }

  /**
   * @param {{ type?: string, toStatus?: string, requesterId?: string, payload?: object }} payload
   */
  async onDecided({ type, toStatus, requesterId, payload = {} } = {}) {
    if (type !== "LEAVE" || toStatus !== "APPROVED" || !requesterId) return;
    const leaveTypeKey = payload.leaveType;
    if (!leaveTypeKey) return;

    const leaveType = await this.leaveTypeRepository.findByKey(leaveTypeKey);
    if (!leaveType) return;

    const days = requestedDays(payload.startDate, payload.endDate);
    if (days <= 0) return;

    try {
      await this.userRepository.incrementLeaveQuotaUsed(requesterId, {
        leaveTypeId: leaveType.id,
        days,
      });
    } catch {
      // A missing quota row is a no-op (the admin simply has not allocated a
      // quota for this type) — never break the approval flow.
    }
  }
}

/** Inclusive calendar-day count between two YYYY-MM-DD dates. */
function requestedDays(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;
  return Math.round((end - start) / 86400000) + 1;
}

module.exports = { LeaveQuotaService };
