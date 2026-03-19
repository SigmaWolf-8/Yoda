import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '../client';
import type { ApiKeyRecord } from '../../types';

export function useApiKeys() {
  return useQuery({
    queryKey: ['apiKeys'],
    queryFn: async () => {
      const res = await apiClient.get<{ keys: ApiKeyRecord[] }>('/keys');
      return res.data.keys;
    },
  });
}

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { name: string }) => {
      const res = await apiClient.post<{ key: ApiKeyRecord; secret: string }>('/keys', data);
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['apiKeys'] }),
  });
}

export function useDeleteApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/keys/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['apiKeys'] }),
  });
}
