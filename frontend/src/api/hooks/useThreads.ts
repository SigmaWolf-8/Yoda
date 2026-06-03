import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '../client';
import type { Thread } from '../../types/thread';

interface ListOpts {
  includeArchived?: boolean;
  search?: string;
}

export function useThreads(projectId?: string, opts: ListOpts = {}) {
  const { includeArchived = false, search = '' } = opts;
  return useQuery<Thread[]>({
    queryKey: ['threads', projectId, includeArchived, search],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (includeArchived) params.archived = 'true';
      if (search.trim()) params.q = search.trim();
      const res = await apiClient.get<{ threads: Thread[] }>(
        `/projects/${projectId}/threads`,
        { params },
      );
      return res.data.threads;
    },
    enabled: !!projectId,
    refetchInterval: 5_000,
  });
}

interface UpdateThreadInput {
  threadId: string;
  title?: string;
  pinned?: boolean;
  archived?: boolean;
}

export function useUpdateThread(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ threadId, ...patch }: UpdateThreadInput) => {
      const res = await apiClient.patch<{ ok: boolean; thread_id: string }>(
        `/projects/${projectId}/threads/${threadId}`,
        patch,
      );
      return res.data;
    },
    onMutate: async ({ threadId, title, pinned, archived }) => {
      await qc.cancelQueries({ queryKey: ['threads', projectId] });
      const snapshots = qc.getQueriesData<Thread[]>({ queryKey: ['threads', projectId] });
      for (const [key, threads] of snapshots) {
        if (!threads) continue;
        qc.setQueryData<Thread[]>(key, threads.map(t =>
          t.id === threadId
            ? {
                ...t,
                title: title ?? t.title,
                pinned: pinned ?? t.pinned,
                archived: archived ?? t.archived,
                // Restoring (archived=false) clears any pending deletion timer.
                deletion_scheduled_at: archived === false ? null : t.deletion_scheduled_at,
              }
            : t,
        ));
      }
      return { snapshots };
    },
    onError: (_e, _v, ctx) => {
      if (!ctx) return;
      for (const [key, data] of ctx.snapshots) qc.setQueryData(key, data);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['threads', projectId] });
      qc.invalidateQueries({ queryKey: ['tasks', projectId] });
    },
  });
}

interface DeleteThreadInput {
  threadId: string;
  permanent?: boolean;
}

export function useDeleteThread(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ threadId, permanent = false }: DeleteThreadInput) => {
      const params = permanent ? { permanent: 'true' } : {};
      const res = await apiClient.delete<{
        ok: boolean;
        thread_id: string;
        permanent: boolean;
        deletion_scheduled_at?: string;
      }>(`/projects/${projectId}/threads/${threadId}`, { params });
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['threads', projectId] });
      qc.invalidateQueries({ queryKey: ['tasks', projectId] });
    },
  });
}
