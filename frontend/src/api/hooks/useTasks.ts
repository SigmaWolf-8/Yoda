import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '../client';
import type { Task, QueryResult } from '../../types';
import type { TaskResult } from '../../types/task-result';
import type { TaskReview } from '../../types/task-review';

export function useTasks(projectId?: string) {
  return useQuery({
    queryKey: ['tasks', projectId],
    queryFn: async () => {
      const res = await apiClient.get<{ tasks: Task[] }>(`/projects/${projectId}/tasks`);
      return res.data.tasks;
    },
    enabled: !!projectId,
    refetchInterval: 5_000, // poll while pipeline is running
  });
}

export function useTask(taskId?: string) {
  return useQuery({
    queryKey: ['task', taskId],
    queryFn: async () => {
      const res = await apiClient.get<{
        task: Task;
        results: TaskResult[];
        reviews: TaskReview[];
      }>(`/tasks/${taskId}`);
      return res.data;
    },
    enabled: !!taskId,
  });
}

export function useSubmitQuery(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { text: string; mode: 'yoda' | 'ronin' }) => {
      const res = await apiClient.post<QueryResult>(`/projects/${projectId}/query`, data);
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', projectId] }),
  });
}

export function useApproveDecomposition(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { task_tree: unknown }) => {
      const res = await apiClient.post<QueryResult>(
        `/projects/${projectId}/query/approve`,
        data,
      );
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', projectId] }),
  });
}

export function useRetryTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (taskId: string) => {
      const res = await apiClient.post<{ task: Task }>(`/tasks/${taskId}/retry`);
      return res.data.task;
    },
    onSuccess: (task) => {
      qc.invalidateQueries({ queryKey: ['task', task.id] });
      qc.invalidateQueries({ queryKey: ['tasks', task.project_id] });
    },
  });
}

export function useEscalateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (taskId: string) => {
      const res = await apiClient.post<{ task: Task }>(`/tasks/${taskId}/escalate`);
      return res.data.task;
    },
    onSuccess: (task) => {
      qc.invalidateQueries({ queryKey: ['task', task.id] });
      qc.invalidateQueries({ queryKey: ['tasks', task.project_id] });
    },
  });
}

export function useCancelTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (taskId: string) => {
      const res = await apiClient.post<{ task: Task }>(`/tasks/${taskId}/cancel`);
      return res.data.task;
    },
    onSuccess: (task) => {
      qc.invalidateQueries({ queryKey: ['task', task.id] });
      qc.invalidateQueries({ queryKey: ['tasks', task.project_id] });
    },
  });
}
