import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '../client';
import type { GitHubPATStatus } from '../../types/settings';

export function useGitHubPAT() {
  return useQuery({
    queryKey: ['githubPAT'],
    queryFn: async () => {
      const res = await apiClient.get<GitHubPATStatus>('/settings/github-pat');
      return res.data;
    },
  });
}

export function useUpdateGitHubPAT() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { token: string }) => {
      const res = await apiClient.put<GitHubPATStatus>('/settings/github-pat', data);
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['githubPAT'] }),
  });
}
