import { useMutation } from '@tanstack/react-query';
import apiClient, { storeTokens } from '../client';

// ── Response shapes for the 3-Factor (Crystal) auth flow ──
// Backend: crates/yoda-api/src/routes.rs (three_factor_* handlers).

export interface ThreeFactorStartResponse {
  session_id: string;
  moving_factor: number;
  /** Present only in non-production so the demo credential is exercisable. */
  dev_hints: {
    pin: string;
    phone: string;
    codepoint: { x: number; y: number; z: number };
  } | null;
}

export interface FactorAck {
  ok: boolean;
  factor: string;
}

export interface PossessionRequestResponse {
  ok: boolean;
  sent_to: string;
  /** Echoed OTP — only in dev (console sender); null in production. */
  dev_code: number | null;
}

export interface CodepointResponse {
  ok: boolean;
  factor: string;
  status: string;
  presence_scalar: string;
  token: string;
  expires_in_minutes: number;
}

/** Factor 0 — open a session and (in dev) receive the demo hints. */
export function useThreeFactorStart() {
  return useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<ThreeFactorStartResponse>('/3fa/start');
      return res.data;
    },
  });
}

/** Factor 1 — Knowledge (PIN). */
export function useThreeFactorKnowledge() {
  return useMutation({
    mutationFn: async (data: { session_id: string; pin: string }) => {
      const res = await apiClient.post<FactorAck>('/3fa/knowledge', data);
      return res.data;
    },
  });
}

/** Factor 2a — Possession (request the time-windowed code). */
export function useThreeFactorPossessionRequest() {
  return useMutation({
    mutationFn: async (data: { session_id: string }) => {
      const res = await apiClient.post<PossessionRequestResponse>(
        '/3fa/possession/request',
        data,
      );
      return res.data;
    },
  });
}

/** Factor 2b — Possession (verify the code). */
export function useThreeFactorPossessionVerify() {
  return useMutation({
    mutationFn: async (data: { session_id: string; code: number }) => {
      const res = await apiClient.post<FactorAck>('/3fa/possession/verify', data);
      return res.data;
    },
  });
}

/**
 * Factor 3 — Codepoint (select the cube on the Crystal). On success the backend
 * mints a short-lived presence token; store it so the app treats the Friendly
 * Approved Member as connected.
 */
export function useThreeFactorCodepoint() {
  return useMutation({
    mutationFn: async (data: {
      session_id: string;
      x: number;
      y: number;
      z: number;
    }) => {
      const res = await apiClient.post<CodepointResponse>('/3fa/codepoint', data);
      // Presence tokens are single, short-lived capability tokens (no refresh).
      storeTokens(res.data.token, '', false);
      return res.data;
    },
  });
}
