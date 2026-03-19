export interface ApiError {
  error: string;
  code: string;
  details?: Record<string, unknown>;
}

/** Extract human-readable message from an axios error or fallback. */
export function extractErrorMessage(err: unknown, fallback = 'An error occurred'): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const axiosErr = err as { response?: { data?: ApiError } };
    return axiosErr.response?.data?.error ?? fallback;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}
