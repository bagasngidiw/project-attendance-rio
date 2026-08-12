/**
 * apiErrorMessage — extracts the backend's business error message from an
 * Axios error (falls back to null). The envelope shape is
 * `{ error?: { message?: string } }` across the API.
 */

import axios from "axios";

export function apiErrorMessage(err: unknown): string | null {
  if (axios.isAxiosError<{ error?: { message?: string } }>(err)) {
    return err.response?.data?.error?.message ?? null;
  }
  return null;
}
