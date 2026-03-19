import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '../client';
import type {
  EngineConfig,
  EngineSlot,
  EngineUpdatePayload,
  DiversityValidation,
  ModelLineageMap,
} from '../../types';

export function useEngineConfigs() {
  return useQuery({
    queryKey: ['engines'],
    queryFn: async () => {
      const res = await apiClient.get<{ engines: EngineConfig[] }>('/settings/engines');
      return res.data.engines;
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
    staleTime: 300_000, // lineages change rarely — 5 min cache
  });
}
