/**
 * OvertimeAdminService — HR administrative overtime review and correction
 * (FR-055).
 *
 * HR lists overtime requests with employee / department / date / status
 * filters, reads a scoped overtime detail, and applies append-only
 * corrections that never mutate the original request (FR-020 audit-trail
 * semantics). The route layer requires `overtime:manage`.
 */

const { NotFoundError, ValidationError } = require("../domain/errors");

const OVERTIME_TYPE = "OVERTIME";
/** Cap for the underlying query; final pagination happens in the service. */
const LIST_QUERY_CAP = 10000;

class OvertimeAdminService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/repositories/request.repository').RequestRepository} deps.requestRepository
   * @param {import('../infrastructure/repositories/user.repository').UserRepository} deps.userRepository
   * @param {import('../infrastructure/repositories/overtime-correction.repository').OvertimeCorrectionRepository} deps.overtimeCorrectionRepository
   * @param {import('./audit.service').AuditService} deps.auditService
   */
  constructor({
    requestRepository,
    userRepository,
    overtimeCorrectionRepository,
    auditService,
  }) {
    this.requestRepository = requestRepository;
    this.userRepository = userRepository;
    this.overtimeCorrectionRepository = overtimeCorrectionRepository;
    this.auditService = auditService;
  }

  /**
   * Overtime requests with filters, enriched with requester identity. The
   * department filter resolves each requester's department after the initial
   * query, so totals stay correct after scoping.
   *
   * @param {{ employeeId?: string, departmentId?: string, from?: string, to?: string, status?: string, page?: number, pageSize?: number }} filters
   */
  async listOverviews({
    employeeId,
    departmentId,
    from,
    to,
    status,
    page = 1,
    pageSize = 20,
  } = {}) {
    const extra = {};
    if (employeeId) extra["payload.employeeId"] = employeeId;

    const { items } = await this.requestRepository.findWithFilters({
      type: OVERTIME_TYPE,
      status,
      from,
      to,
      page: 1,
      pageSize: LIST_QUERY_CAP,
      extra,
    });

    const rows = await Promise.all(
      items.map(async (item) => ({
        record: item,
        requester: await this.userRepository.findById(item.requesterId),
      }))
    );

    let scoped = rows;
    if (departmentId) {
      scoped = rows.filter(
        (row) =>
          row.requester &&
          String(row.requester.departmentId ?? "") === String(departmentId)
      );
    }

    const total = scoped.length;
    const start = (page - 1) * pageSize;
    return {
      items: scoped
        .slice(start, start + pageSize)
        .map((row) => this.toDto(row.record, row.requester)),
      total,
      page,
      pageSize,
    };
  }

  /**
   * Scoped overtime detail + full correction history. Non-overtime requests
   * answer 404 (no existence leak across request types).
   *
   * @param {string} id
   */
  async getById(id) {
    const request = await this.requestRepository.findById(id);
    if (!request || String(request.type) !== OVERTIME_TYPE) {
      throw new NotFoundError("Overtime request not found.", "REQUEST_NOT_FOUND");
    }

    const requester = await this.userRepository.findById(request.requesterId);
    const corrections = await this.overtimeCorrectionRepository.listByOvertime(id);
    return {
      ...this.toDto(request, requester),
      corrections: corrections.map((correction) =>
        this.correctionDto(correction)
      ),
    };
  }

  /**
   * Appends an overtime correction. The original request is never mutated —
   * the correction is the audit trail (FR-020 semantics). A reason is
   * mandatory.
   *
   * @param {{ overtimeId: string, field: string, oldValue: *, newValue: *, reason: string }} input
   * @param {object} [actor]
   */
  async correct({ overtimeId, field, oldValue, newValue, reason }, actor = {}) {
    const request = await this.requestRepository.findById(overtimeId);
    if (!request || String(request.type) !== OVERTIME_TYPE) {
      throw new NotFoundError("Overtime request not found.", "REQUEST_NOT_FOUND");
    }

    if (!reason || !String(reason).trim()) {
      throw new ValidationError("A correction reason is required.", {
        field: "reason",
      });
    }

    const previous = oldValue ?? null;
    const corrected = newValue ?? null;

    const correction = await this.overtimeCorrectionRepository.create({
      overtimeId,
      field,
      oldValue: previous,
      newValue: corrected,
      reason: String(reason).trim(),
      correctedBy: actor.actorId ?? null,
    });

    await this.auditService.record({
      action: "OVERTIME.CORRECTED",
      actor: {
        userId: actor.actorId ?? null,
        roleKeys: actor.actorRoleKeys ?? [],
      },
      subject: {
        type: "REQUEST",
        id: overtimeId,
        summary: `${request.requesterId ?? ""} ${field}`,
      },
      outcome: "SUCCESS",
      metadata: {
        overtimeId,
        field,
        oldValue: previous,
        newValue: corrected,
      },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return this.correctionDto(correction);
  }

  toDto(request, requester) {
    return {
      id: String(request.id ?? request._id),
      type: request.type,
      requesterId: request.requesterId?.toString?.() ?? request.requesterId,
      requester: requester
        ? { id: requester.id, username: requester.username, name: requester.name }
        : null,
      overtimeDate: request.payload?.overtimeDate ?? null,
      startTime: request.payload?.startTime ?? null,
      endTime: request.payload?.endTime ?? null,
      reason: request.payload?.reason ?? null,
      status: request.status,
      submittedAt: request.submittedAt ?? null,
      decidedAt: request.decidedAt ?? null,
      payload: request.payload ?? {},
      version: request.version,
    };
  }

  correctionDto(correction) {
    return {
      id: String(correction.id ?? correction._id),
      overtimeId: correction.overtimeId?.toString?.() ?? correction.overtimeId,
      field: correction.field,
      oldValue: correction.oldValue ?? null,
      newValue: correction.newValue ?? null,
      reason: correction.reason,
      correctedBy: correction.correctedBy?.toString?.() ?? correction.correctedBy,
      correctedAt: correction.correctedAt
        ? new Date(correction.correctedAt).toISOString()
        : correction.createdAt
          ? new Date(correction.createdAt).toISOString()
          : null,
    };
  }
}

module.exports = { OvertimeAdminService };
