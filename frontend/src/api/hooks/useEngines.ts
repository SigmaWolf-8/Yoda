import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '../client';
import type {
  EngineConfig,
  EngineSlot,
  EngineUpdatePayload,
  DiversityValidation,
  ModelLineageMap,
} from '../../types';

// ── Task #26: Daemon host/ports (Array3 monitor source-of-truth) ──
export interface DaemonsConfig {
  host: string;
  ports: number[];
}

interface EnginesSettingsResponse {
  engines: EngineConfig[];
  daemons: DaemonsConfig;
}

interface UseEngineConfigsOptions {
  refetchInterval?: number | false;
}

export function useEngineConfigs(options: UseEngineConfigsOptions = {}) {
  return useQuery({
    queryKey: ['engines'],
    queryFn: async () => {
      const res = await apiClient.get<EnginesSettingsResponse>('/settings/engines');
      return res.data.engines.map(engine => {
        const operational = !engine.is_disabled && engine.health_status === 'online' &&
          engine.verification?.verified === true &&
          Date.parse(engine.verification.expires_at) > Date.now();
        return { ...engine, operational,
          health_status: engine.health_status === 'online' && !operational ? 'offline' as const : engine.health_status };
      });
    },
    refetchInterval: options.refetchInterval ?? 15_000,
  });
}

export function useDaemons() {
  return useQuery({
    queryKey: ['engines', 'daemons'],
    queryFn: async () => {
      const res = await apiClient.get<EnginesSettingsResponse>('/settings/engines');
      return res.data.daemons;
    },
  });
}

export function useUpdateDaemons() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: DaemonsConfig) => {
      const res = await apiClient.put<{ daemons: DaemonsConfig }>('/settings/engines', {
        daemons: payload,
      });
      return res.data.daemons;
    },
    onSuccess: () => {
      // Same backing endpoint feeds both queries — invalidate both.
      qc.invalidateQueries({ queryKey: ['engines'] });
    },
  });
}

export function useUpdateEngine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ slot, ...payload }: EngineUpdatePayload & { slot: EngineSlot }) => {
      const res = await apiClient.put<{ engine: EngineConfig }>(
        `/settings/engines/${slot}`,
        payload,
      );
      return res.data.engine;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['engines'] }),
  });
}

export function useDeleteEngine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (slot: EngineSlot) => {
      await apiClient.delete(`/settings/engines/${slot}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['engines'] }),
  });
}

export interface EnginePingResult {
  slot: EngineSlot;
  status: string;
  reachable: boolean;
  latency_ms: number;
  error?: string | null;
  note?: string | null;
  verified?: boolean;
  answer?: string;
  peer?: string | null;
  checked_at?: string;
  request_id?: string;
}

async function verifyGeneration(slot: EngineSlot): Promise<EnginePingResult> {
  const { data } = await apiClient.post<EnginePingResult>(`/yoda/engines/${slot}/ping`, {}, { timeout: 15_000 });
  if (data.status !== 'verifying') return data;
  const deadline = Date.now() + 155_000;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    const { data: current } = await apiClient.get<EnginesSettingsResponse>('/settings/engines');
    const proof = current.engines.find(engine => engine.slot === slot)?.verification;
    if (!proof || proof.request_id !== data.request_id) {
      throw new Error('Engine settings or verification changed; this result is no longer current.');
    }
    if (proof.status !== 'verifying') return { ...proof, reachable: proof.verified };
  }
  throw new Error('Verification has not returned a final record. No new certification was issued.');
}

/**
 * On-demand engine health check. Runs the probe server-side and resolves with
 * the fresh status + latency, so a "Test Connection" button can show pass/fail
 * without waiting for the background poll.
 */
export function usePingEngine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (slot: EngineSlot) => {
      return verifyGeneration(slot);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['engines'] }),
  });
}

export function useMarkEngineOnline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (slot: EngineSlot) => {
      const result = await verifyGeneration(slot);
      if (!result.verified) throw new Error(result.error ?? 'Generation verification failed');
      return result;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['engines'] }),
  });
}

export function useMarkEngineOffline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (slot: EngineSlot) => {
      await apiClient.post(`/settings/engines/${slot}/mark-offline`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['engines'] }),
  });
}

export function useDisableEngine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (slot: EngineSlot) => {
      await apiClient.post(`/settings/engines/${slot}/disable`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['engines'] }),
  });
}

export function useEnableEngine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (slot: EngineSlot) => {
      await apiClient.post(`/settings/engines/${slot}/enable`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['engines'] }),
  });
}

export function useValidateDiversity() {
  return useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<DiversityValidation>(
        '/settings/engines/validate-diversity',
      );
      return res.data;
    },
  });
}

export function useModelLineages() {
  return useQuery({
    queryKey: ['lineages'],
    queryFn: async () => {
      const res = await apiClient.get<ModelLineageMap>('/lineages');
      return res.data;
    },
    staleTime: 300_000,
  });
}
