import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '../client';
import type { KBEntry, KBUpdatePayload, KBSearchParams } from '../../types';

export function useKnowledgeBase(projectId?: string, params?: KBSearchParams) {
  return useQuery({
    queryKey: ['kb', projectId, params],
    queryFn: async () => {
      const res = await apiClient.get<{ entries: KBEntry[] }>(
        `/projects/${projectId}/kb`,
        { params },
      );
      return res.data.entries;
    },
    enabled: !!projectId,
  });
}

export function useUpdateKBEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: KBUpdatePayload & { id: string }) => {
      const res = await apiClient.put<{ entry: KBEntry }>(`/kb/${id}`, payload);
      return res.data.entry;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kb'] }),
  });
}

export function useDeleteKBEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/kb/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kb'] }),
  });
}
