import axios from 'axios';
import type { AxiosError, InternalAxiosRequestConfig } from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30_000,
});

// ── Token helpers ──

const TOKEN_KEY = 'yoda_token';
const REFRESH_KEY = 'yoda_refresh_token';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY);
}

export function getStoredRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY) ?? sessionStorage.getItem(REFRESH_KEY);
}

/**
 * Store the bearer credential. The classic login supplies a JWT plus a refresh
 * token; the Torus Gate supplies an opaque handle and no refresh token at all
 * (there is nothing to refresh — a handle is server-side state that is either
 * live or revoked). Omit `refreshToken` in that case.
 */
export function storeTokens(
  token: string,
  refreshToken?: string | null,
  persist: boolean = true
) {
  const storage = persist ? localStorage : sessionStorage;
  storage.setItem(TOKEN_KEY, token);
  if (refreshToken) {
    storage.setItem(REFRESH_KEY, refreshToken);
  } else {
    // A stale refresh token from a previous JWT session must not survive
    // alongside a gate handle, or the 401 path would try to revive it.
    localStorage.removeItem(REFRESH_KEY);
    sessionStorage.removeItem(REFRESH_KEY);
  }
}

export function clearTokens() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(REFRESH_KEY);
}

// ── Request interceptor: attach JWT ──

apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getStoredToken();
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── Response interceptor: handle 401 with token refresh ──

let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
}> = [];

function processQueue(error: unknown, token: string | null = null) {
  failedQueue.forEach((prom) => {
    if (token) {
      prom.resolve(token);
    } else {
      prom.reject(error);
    }
  });
  failedQueue = [];
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
    };

    // Only attempt refresh on 401, and not on auth endpoints themselves
    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !originalRequest.url?.includes('/auth/')
    ) {
      if (isRefreshing) {
        // Queue this request until the refresh completes
        return new Promise((resolve, reject) => {
          failedQueue.push({
            resolve: (token: string) => {
              if (originalRequest.headers) {
                originalRequest.headers.Authorization = `Bearer ${token}`;
              }
              resolve(apiClient(originalRequest));
            },
            reject,
          });
        });
      }

      originalRequest._retry = true;

      // Torus Gate sessions are opaque handles with no refresh token — when
      // one expires or is revoked there is nothing to renew, so bail straight
      // to the gate. This is checked BEFORE claiming the refresh lock: taking
      // `isRefreshing` here and returning early would strand every queued
      // request until a full page load.
      const refreshToken = getStoredRefreshToken();
      if (!refreshToken) {
        processQueue(error, null);
        clearTokens();
        window.location.href = '/login';
        return Promise.reject(error);
      }

      isRefreshing = true;

      try {
        const { data } = await axios.post(`${API_BASE_URL}/auth/refresh`, {
          refresh_token: refreshToken,
        });

        const persist = localStorage.getItem(TOKEN_KEY) !== null;
        storeTokens(data.token, data.refresh_token, persist);

        processQueue(null, data.token);

        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${data.token}`;
        }
        return apiClient(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        clearTokens();
        window.location.href = '/login';
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

export default apiClient;
