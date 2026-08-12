/**
 * Data-scope guard middleware (FR-056) — enforces record visibility at the
 * authorization boundary in addition to permission checks.
 *
 * Two guards are produced:
 *   - `requireScope(minimum)`  : rejects a request whose resolved data scope is
 *     narrower than `minimum` (e.g. COMPANY-only list endpoints).
 *   - `assertInScope(fetchTargetUserId)` : loads the target user and 404s when
 *     the principal may not access that user's records (no existence leak),
 *     matching the platform's out-of-scope convention.
 *
 * Every denial is recorded as `SCOPE.DENIED` on the audit surface so blocked
 * access attempts remain observable.
 */

const { resolveScope, scopeSatisfies, canAccessTarget } = require("../../domain/data-scope");
const { UnauthenticatedError } = require("../../domain/errors");

/** Targets are looked up from params (userId) or fall back to self. */
function defaultTargetResolver(req) {
  return req.params.userId ?? req.params.memberId ?? req.auth?.userId ?? null;
}

function createScopeGuard({ userRepository, auditService }) {
  /**
   * Rejects requests whose effective data scope is narrower than `minimum`.
   * Attaches `req.auth.dataScope` for downstream consumers either way.
   */
  function requireScope(minimum) {
    return async function requireScopeMiddleware(req, res, next) {
      try {
        if (!req.auth) return next(new UnauthenticatedError());

        const dataScope = resolveScope({
          permissions: req.auth.permissions,
          roles: req.auth.roles,
        });
        req.auth.dataScope = dataScope;

        if (!scopeSatisfies(dataScope, minimum)) {
          await recordScopeDenied(req, {
            reason: `requires ${minimum} scope, has ${dataScope}`,
            target: "collection",
          });
          next({
            code: "SCOPE_DENIED",
            message: "You do not have permission to access this data.",
            status: 403,
            details: { requiredScope: minimum, dataScope },
          });
          return;
        }
        next();
      } catch (err) {
        next(err);
      }
    };
  }

  /**
   * Verifies the principal may access the target user's records. When the
   * target is out of scope the request is answered 404 (indistinguishable from
   * "does not exist") and the denial is recorded.
   *
   * @param {(req) => string|null} [fetchTargetUserId]
   */
  function assertInScope(fetchTargetUserId = defaultTargetResolver) {
    return async function assertInScopeMiddleware(req, res, next) {
      try {
        if (!req.auth) return next(new UnauthenticatedError());

        const dataScope = resolveScope({
          permissions: req.auth.permissions,
          roles: req.auth.roles,
        });
        req.auth.dataScope = dataScope;

        const targetUserId = fetchTargetUserId(req);
        if (targetUserId == null) {
          next({
            code: "SCOPE_DENIED",
            message: "A target user must be identified.",
            status: 400,
            details: { dataScope },
          });
          return;
        }

        const targetUser = await userRepository.findById(targetUserId);
        if (!targetUser || !canAccessTarget({ userId: req.auth.userId, dataScope }, targetUser)) {
          await recordScopeDenied(req, {
            reason: "out-of-scope target",
            target: targetUserId,
          });
          next({
            code: "NOT_FOUND",
            message: "The requested resource was not found.",
            status: 404,
          });
          return;
        }

        req.targetUser = targetUser;
        next();
      } catch (err) {
        next(err);
      }
    };
  }

  async function recordScopeDenied(req, details) {
    try {
      await auditService.record({
        action: "SCOPE.DENIED",
        actor: { userId: req.auth.userId, roleKeys: req.auth.roles },
        subject: { type: "DATA", id: details.target ?? "", summary: details.reason },
        outcome: "DENIED",
        metadata: {
          route: req.originalUrl,
          method: req.method,
          dataScope: req.auth?.dataScope ?? null,
          reason: details.reason,
        },
        correlationId: req.correlationId,
        ip: req.ip,
        userAgent: req.headers["user-agent"] || "",
      });
    } catch {
      // Recording a denial must never prevent the denial response.
    }
  }

  return { requireScope, assertInScope };
}

module.exports = { createScopeGuard };
