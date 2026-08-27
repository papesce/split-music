import axios from 'axios'

export const api = axios.create({ baseURL: '/' })

// Centralized error extraction for UI toasts (future)
export function getApiErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const detail = (err.response?.data as { detail?: string })?.detail
    if (detail) return detail
    return err.message
  }
  if (err instanceof Error) return err.message
  return String(err)
}
