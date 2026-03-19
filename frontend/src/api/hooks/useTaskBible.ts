import { useQuery } from '@tanstack/react-query';
import apiClient from '../client';
import type { TaskBibleSummary, TaskBibleEntry } from '../../types';

export function useTaskBible(projectId?: string) {
  return useQuery({
    queryKey: ['taskBible', projectId],
    queryFn: async () => {
      const res = await apiClient.get<{ entries: TaskBibleSummary[] }>(
        `/projects/${projectId}/bible`,
      );
      return res.data.entries;
    },
    enabled: !!projectId,
  });
}

export function useTaskBibleEntry(taskId?: string) {
  return useQuery({
    queryKey: ['taskBibleEntry', taskId],
    queryFn: async () => {
      const res = await apiClient.get<{ entry: TaskBibleEntry }>(`/bible/${taskId}`);
      return res.data.entry;
    },
    enabled: !!taskId,
  });
}
