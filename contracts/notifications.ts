/**
 * Notification DTO types (FR-014 / FR-015).
 */

import type { ApiEnvelope } from "./auth";

export interface NotificationDto {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string;
  relatedRequestId: string | null;
  readAt: string | null;
  createdAt: string | null;
}

export interface NotificationListResult {
  items: NotificationDto[];
  page: number;
  pageSize: number;
  total: number;
}

export interface NotificationPreferencesDto {
  optOutTypes: string[];
  mandatoryTypes: string[];
}

export type NotificationListResponse = ApiEnvelope<NotificationListResult>;
export type UnreadCountResponse = ApiEnvelope<{ unread: number }>;
export type NotificationPreferencesResponse = ApiEnvelope<NotificationPreferencesDto>;
