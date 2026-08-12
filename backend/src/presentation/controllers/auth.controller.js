/**
 * AuthController — maps HTTP requests to AuthService and formats responses
 * using the standard `{ data?, error? }` envelope (design §5.2).
 */

const { TokenInvalidError, ValidationError } = require("../../domain/errors");

class AuthController {
  constructor({ authService, mfaService }) {
    this.authService = authService;
    this.mfaService = mfaService;
  }

  signIn = async (req, res, next) => {
    try {
      const data = await this.authService.signIn({
        username: req.body.username,
        password: req.body.password,
        device: this.describeDevice(req),
      });
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  refresh = async (req, res, next) => {
    try {
      const data = await this.authService.refresh({
        refreshToken: req.body.refreshToken,
        device: this.describeDevice(req),
      });
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  signOut = async (req, res, next) => {
    try {
      await this.authService.signOut({ refreshToken: req.body.refreshToken });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  };

  getSession = async (req, res, next) => {
    try {
      const data = await this.authService.getSession(
        req.auth.accessToken ?? ""
      );
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  signOutAll = async (req, res, next) => {
    try {
      const revoked = await this.authService.signOutAll(req.auth.userId, {
        actorUsername: req.auth.username,
      });
      res.status(200).json({ data: { revokedSessions: revoked } });
    } catch (err) {
      next(err);
    }
  };

  /**
   * POST /auth/mfa/verify — completes a sign-in after a successful MFA
   * challenge (FR-051). Public (no Bearer token): the short-lived challenge
   * token from sign-in is the credential. Rate-limited at the router level.
   */
  verifyMfa = async (req, res, next) => {
    try {
      if (!this.mfaService) {
        throw new TokenInvalidError("MFA verification is not available.");
      }
      const { mfaChallengeToken, code } = req.body;
      const { userId } = await this.mfaService.verifyChallengeToken(
        mfaChallengeToken
      );
      const passed = await this.mfaService.challenge({
        userId,
        code,
        device: this.describeDevice(req),
      });
      if (!passed) {
        throw new ValidationError("Invalid verification code.");
      }
      const data = await this.authService.completeMfaSignIn({
        userId,
        device: this.describeDevice(req),
      });
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  };

  describeDevice(req) {
    return {
      userAgent: req.headers["user-agent"] || "",
      ip: req.ip || "",
      correlationId: req.correlationId || "",
    };
  }
}

module.exports = { AuthController };
