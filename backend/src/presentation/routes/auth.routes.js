/**
 * Auth routes (design §5.1). Public endpoints are rate-limited; protected
 * endpoints require a valid access token.
 */

const { Router } = require("express");
const { signInDto, refreshDto, signOutDto } = require("../dto/auth.dto");
const { changePasswordDto } = require("../dto/user.dto");
const { mfaVerifyDto } = require("../dto/mfa.dto");
const { ValidationError } = require("../../domain/errors");

function validate(dto) {
  return (req, res, next) => {
    const result = dto.safeParse(req.body);
    if (!result.success) {
      next(
        new ValidationError("Request validation failed.", {
          issues: result.error.issues,
        })
      );
      return;
    }
    req.body = result.data;
    next();
  };
}

function createAuthRoutes({ authController, authenticate, changePassword }) {
  const router = Router();

  router.post("/signin", validate(signInDto), authController.signIn);
  // FR-051: completes a paused sign-in using the challenge token + TOTP code.
  // No authenticate() middleware — the challenge token is the credential.
  router.post("/mfa/verify", validate(mfaVerifyDto), authController.verifyMfa);
  router.post("/refresh", validate(refreshDto), authController.refresh);
  router.post("/signout", validate(signOutDto), authController.signOut);

  router.get("/session", authenticate, authController.getSession);
  router.post("/signout-all", authenticate, authController.signOutAll);
  router.post(
    "/change-password",
    authenticate,
    validate(changePasswordDto),
    changePassword
  );

  return router;
}

module.exports = { createAuthRoutes, validate };
