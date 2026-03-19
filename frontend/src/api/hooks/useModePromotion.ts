import { useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '../client';
import type { Project, Task } from '../../types';

export function usePromoteToRonin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (projectId: string) => {
      const res = await apiClient.post<{ project: Project }>(
        `/projects/${projectId}/promote`,
      );
      return res.data.project;
    },
    onSuccess: (project) => {
      qc.invalidateQueries({ queryKey: ['project', project.id] });
      qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

export function useEscalateToYoda() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (taskId: string) => {
      const res = await apiClient.post<{ task: Task; yoda_task_id: string }>(
        `/tasks/${taskId}/escalate-to-yoda`,
      );
      return res.data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['task', data.task.id] });
      qc.invalidateQueries({ queryKey: ['tasks', data.task.project_id] });
    },
  });
}
