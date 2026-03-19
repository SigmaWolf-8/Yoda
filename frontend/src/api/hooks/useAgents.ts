import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '../client';
import type { AgentConfig, AgentUsageStats, AgentWithStats, AgentUpsertPayload, AgentSyncStatus } from '../../types';

export function useAgents(division?: string) {
  return useQuery({
    queryKey: ['agents', division],
    queryFn: async () => {
      const params = division ? { division } : {};
      const res = await apiClient.get<{ agents: AgentConfig[] }>('/agents', { params });
      return res.data.agents;
    },
  });
}

export function useAgent(agentId?: string) {
  return useQuery({
    queryKey: ['agent', agentId],
    queryFn: async () => {
      const res = await apiClient.get<{ agent: AgentConfig }>(`/agents/${agentId}`);
      return res.data.agent;
    },
    enabled: !!agentId,
  });
}

export function useAgentStats() {
  return useQuery({
    queryKey: ['agentStats'],
    queryFn: async () => {
      const res = await apiClient.get<{ stats: AgentUsageStats[] }>('/agents/stats');
      return res.data.stats;
    },
  });
}

export function useAgentsWithStats(division?: string) {
  const agents = useAgents(division);
  const stats = useAgentStats();
  const merged: AgentWithStats[] | undefined =
    agents.data && stats.data
      ? agents.data.map((agent) => ({
          ...agent,
          stats: stats.data.find((s) => s.agent_id === agent.agent_id) ?? {
            agent_id: agent.agent_id,
            total_calls: 0, as_producer: 0, as_reviewer: 0,
            avg_confidence: 0, approval_rate: 0, last_used: null, calls_this_week: 0,
          },
        }))
      : undefined;
  return { data: merged, isLoading: agents.isLoading || stats.isLoading, error: agents.error || stats.error };
}

/** Check upstream for new/updated agents */
export function useAgentSyncStatus() {
  return useQuery({
    queryKey: ['agentSyncStatus'],
    queryFn: async () => {
      const res = await apiClient.get<AgentSyncStatus>('/agents/sync-status');
      return res.data;
    },
    staleTime: 5 * 60_000, // check at most every 5 min
  });
}

/** Import selected upstream agents */
export function useImportAgents() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (agentIds: string[]) => {
      const res = await apiClient.post('/agents/import', { agent_ids: agentIds });
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents'] });
      qc.invalidateQueries({ queryKey: ['agentSyncStatus'] });
    },
  });
}

export function useCreateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: AgentUpsertPayload) => {
      const res = await apiClient.post<{ agent: AgentConfig }>('/agents', data);
      return res.data.agent;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }),
  });
}

export function useUpdateAgent(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Partial<AgentUpsertPayload>) => {
      const res = await apiClient.put<{ agent: AgentConfig }>(`/agents/${agentId}`, data);
      return res.data.agent;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents'] });
      qc.invalidateQueries({ queryKey: ['agent', agentId] });
    },
  });
}

export function useDeleteAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (agentId: string) => { await apiClient.delete(`/agents/${agentId}`); },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }),
  });
}
