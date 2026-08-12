/**
 * Auth token storage helpers.
 *
 * Access token is kept in memory (never localStorage) to reduce XSS exposure;
 * the refresh token is persisted so sessions survive page reloads (design
 * §6.4 documented trade-off; httpOnly cookies are a production hardening
 * path for a follow-up).
 */

const REFRESH_TOKEN_KEY = "hris.refreshToken";
const SESSION_ID_KEY = "hris.sessionId";

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setRefreshToken(token: string): void {
  localStorage.setItem(REFRESH_TOKEN_KEY, token);
}

export function getSessionId(): string | null {
  return localStorage.getItem(SESSION_ID_KEY);
}

export function setSessionId(sessionId: string): void {
  localStorage.setItem(SESSION_ID_KEY, sessionId);
}

export function clearAuthStorage(): void {
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(SESSION_ID_KEY);
}
