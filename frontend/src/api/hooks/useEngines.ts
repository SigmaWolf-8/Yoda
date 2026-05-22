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
      return res.data.engines;
    },
    refetchInterval: options.refetchInterval,
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

export function useMarkEngineOnline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (slot: EngineSlot) => {
      await apiClient.post(`/settings/engines/${slot}/mark-online`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['engines'] }),
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
