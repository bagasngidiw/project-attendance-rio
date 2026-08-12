/**
 * Password policy helpers (FR-044) — mirror the backend policy rules so every
 * password form can show live validation hints from the public policy shape.
 */

import type { PasswordPolicyDto } from "@/lib/axios";

/**
 * Client-side validation mirroring `domain/password-policy.validatePassword`.
 * Returns human-readable violation messages (empty when compliant).
 */
export function validatePasswordAgainstPolicy(
  policy: PasswordPolicyDto,
  password: string
): string[] {
  const violations: string[] = [];
  const value = password ?? "";

  if (value.length < policy.minLength) {
    violations.push(`Minimal ${policy.minLength} karakter.`);
  }
  if (value.length > policy.maxLength) {
    violations.push(`Maksimal ${policy.maxLength} karakter.`);
  }
  if (policy.requireUppercase && !/[A-Z]/.test(value)) {
    violations.push("Harus mengandung huruf kapital.");
  }
  if (policy.requireLowercase && !/[a-z]/.test(value)) {
    violations.push("Harus mengandung huruf kecil.");
  }
  if (policy.requireDigit && !/[0-9]/.test(value)) {
    violations.push("Harus mengandung angka.");
  }
  if (policy.requireSpecial && !/[^A-Za-z0-9]/.test(value)) {
    violations.push("Harus mengandung karakter khusus.");
  }

  return violations;
}
