import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '../client';
import type { ProjectSettings } from '../../types';

export function useProjectSettings(projectId?: string) {
  return useQuery({
    queryKey: ['projectSettings', projectId],
    queryFn: async () => {
      const res = await apiClient.get<{ settings: ProjectSettings }>(
        `/settings/project/${projectId}`,
      );
      return res.data.settings;
    },
    enabled: !!projectId,
  });
}

export function useUpdateProjectSettings(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Partial<ProjectSettings> & { mode?: 'yoda' | 'ronin' }) => {
      const res = await apiClient.put<{ settings: ProjectSettings }>(
        `/settings/project/${projectId}`,
        data,
      );
      return res.data.settings;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projectSettings', projectId] });
      qc.invalidateQueries({ queryKey: ['project', projectId] });
    },
  });
}
