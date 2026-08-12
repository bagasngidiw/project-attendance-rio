/**
 * authenticate middleware (design §4.4).
 *
 * Verifies the Bearer access token (signature, issuer, audience, expiry) and
 * the `ver` claim against the user's current tokenVersion. Also verifies the
 * session is not revoked and is within the inactivity window. On success it
 * attaches `req.auth` with the AuthPrincipal.
 */

const { UnauthenticatedError, TokenInvalidError } = require("../../domain/errors");
const { hasPermission } = require("../../domain/permissions");
const { resolveScope } = require("../../domain/data-scope");

/**
 * Paths a user who must change their password may still reach when the
 * first-sign-in gate is enforced (FR-028 §5.2). Matched against the full
 * `originalUrl` so the check is robust regardless of router mounting.
 */
const FIRST_SIGN_IN_GATE_EXEMPT = new Set([
  "/api/v1/auth/change-password",
  "/api/v1/auth/session",
  "/api/v1/auth/signout",
  "/api/v1/auth/signout-all",
]);

function createAuthenticate({ tokenProvider, userRepository, sessionService, config }) {
  return async function authenticate(req, res, next) {
    try {
      const header = req.headers.authorization || "";
      const [scheme, token] = header.split(" ");
      if (scheme !== "Bearer" || !token) {
        throw new UnauthenticatedError();
      }

      let payload;
      try {
        payload = tokenProvider.verify(token);
      } catch {
        // Never let raw JWT errors (expiry, bad signature, malformed) reach
        // the wire — they are always surfaced as a generic token error.
        throw new TokenInvalidError();
      }

      const user = await userRepository.findById(payload.sub);
      if (!user || user.status !== "ACTIVE") {
        throw new TokenInvalidError("User no longer active.");
      }
      if (user.tokenVersion !== payload.ver) {
        throw new TokenInvalidError("Session token superseded.");
      }

      const session = await sessionService.findSessionById(payload.sessionId);
      if (!session) {
        // A token whose session record no longer exists (TTL cleanup, DB
        // restore, manual revocation) must fail closed — never pass silently.
        throw new TokenInvalidError("Session not found.");
      }
      await sessionService.assertSessionUsable(session);

      req.auth = {
        userId: user.id,
        username: user.username,
        email: user.email,
        roles: Array.isArray(payload.roles) ? payload.roles : [],
        permissions: Array.isArray(payload.permissions)
          ? payload.permissions
          : [],
        sessionId: payload.sessionId,
        accessToken: token,
        mustChangePassword: user.mustChangePassword,
        dataScope: resolveScope({
          permissions: Array.isArray(payload.permissions) ? payload.permissions : [],
          roles: Array.isArray(payload.roles) ? payload.roles : [],
        }),
        hasPermission: (permissionKey) =>
          hasPermission(req.auth.permissions, permissionKey),
      };

      // Optional first-sign-in gate (FR-028 §5.2, config toggle). When enabled,
      // a user who has not yet set their own password can only reach the
      // change-password / session endpoints until they do.
      if (
        config?.security?.enforceFirstSignInGate &&
        user.mustChangePassword &&
        !FIRST_SIGN_IN_GATE_EXEMPT.has(req.originalUrl)
      ) {
        res.status(403).json({
          error: {
            code: "PASSWORD_CHANGE_REQUIRED",
            message: "You must change your password before continuing.",
          },
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
 * authorize middleware factory (design §4.4 / FR-005).
 *
 * Usage: `router.get("/", authorize("users:view"), handler)`.
 * Denied requests are recorded to the audit trail and answered 403.
 */
function createAuthorize({ auditService }) {
  return function authorize(...requiredPermissions) {
    return async function authorizeMiddleware(req, res, next) {
      if (!req.auth) {
        next(new UnauthenticatedError());
        return;
      }

      const granted = requiredPermissions.some((key) =>
        req.auth.hasPermission(key)
      );

      if (!granted) {
        const deniedKeys = requiredPermissions.filter(
          (key) => !req.auth.hasPermission(key)
        );
        try {
          await auditService.record({
            action: "AUTH.DENIED",
            actor: {
              userId: req.auth.userId,
              roleKeys: req.auth.roles,
            },
            subject: {
              type: "ROUTE",
              id: req.originalUrl,
              summary: deniedKeys[0] ?? "",
            },
            outcome: "DENIED",
            metadata: { requiredPermissions, deniedKeys },
            correlationId: req.correlationId,
            ip: req.ip,
            userAgent: req.headers["user-agent"] || "",
          });
        } catch {
          // Audit must never block the denial response.
        }
        next({
          code: "AUTH_DENIED",
          message: "You do not have permission to perform this action.",
          status: 403,
          details: { permissionKey: deniedKeys[0] },
        });
        return;
      }

      next();
    };
  };
}

module.exports = { createAuthenticate, createAuthorize };
