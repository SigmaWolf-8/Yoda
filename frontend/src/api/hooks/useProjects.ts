import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '../client';
import type { Project, ProjectSettings } from '../../types';

export function useProjects(orgId?: string) {
  return useQuery({
    queryKey: ['projects', orgId],
    queryFn: async () => {
      const params = orgId ? { org_id: orgId } : {};
      const res = await apiClient.get<{ projects: Project[] }>('/projects', { params });
      return res.data.projects;
    },
    enabled: !!orgId,
  });
}

export function useProject(id?: string) {
  return useQuery({
    queryKey: ['project', id],
    queryFn: async () => {
      const res = await apiClient.get<{ project: Project }>(`/projects/${id}`);
      return res.data.project;
    },
    enabled: !!id,
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { name: string; mode: 'yoda' | 'ronin'; org_id: string }) => {
      const res = await apiClient.post<{ project: Project }>('/projects', data);
      return res.data.project;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  });
}

export function useUpdateProject(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { name?: string; mode?: 'yoda' | 'ronin'; settings?: Partial<ProjectSettings> }) => {
      const res = await apiClient.put<{ project: Project }>(`/projects/${id}`, data);
      return res.data.project;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', id] });
      qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/projects/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  });
}
