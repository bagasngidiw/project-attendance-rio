/**
 * Profile DTO types (FR-021).
 */

import type { ApiEnvelope } from "./auth";

export interface ProfileDto {
  id: string;
  username: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  emergencyContact: string;
  personalEmail: string;
  bankAccount: string | null;
  status: string;
  roles: string[];
  departmentId: string | null;
  positionId: string | null;
  managerId: string | null;
  mustChangePassword: boolean;
  notificationPreferences: Record<string, unknown>;
}

/** Self-service editable fields (mirrors the backend registry). */
export interface ProfileUpdateDto {
  email?: string;
  phone?: string;
  address?: string;
  emergencyContact?: string;
  personalEmail?: string;
  bankAccount?: string;
}

export type ProfileResponse = ApiEnvelope<ProfileDto>;
