import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '../client';
import type { AgentWithStats, AgentUpsertPayload, AgentSyncStatus, SyncAgentPreview } from '../../types';

// Shape the backend actually returns from GET /api/agents
interface BackendAgentSummary {
  agent_id: string;
  display_name: string;
  division: string;
  description: string;
  competencies: string[];
  review_criteria: string[];
  compatible_reviewers: string[];
  source: string;
  license: string;
}

interface BackendRosterResponse {
  agents: BackendAgentSummary[];
  total: number;
  by_division: Record<string, number>;
  upstream_count: number;
  capomastro_count: number;
}

// Shape the backend returns from GET /api/agents/sync-status
interface BackendSyncStatus {
  upstream_configured: boolean;
  local_head: string | null;
  upstream_head: string | null;
  updates_available: boolean;
  new_agents: { filename: string; division: string; title: string | null }[];
  modified_agents: string[];
  pending_count: number;
  last_synced: string | null;
}

function mapAgent(a: BackendAgentSummary): AgentWithStats {
  return {
    agent_id: a.agent_id,
    display_name: a.display_name,
    division: a.division as AgentWithStats['division'],
    source: a.source as AgentWithStats['source'],
    license: a.license,
    about: a.description,
    key_skills: a.competencies,
    competencies: a.competencies,
    review_criteria: a.review_criteria,
    compatible_reviewers: a.compatible_reviewers,
    primary_role: 'Both',
    readonly: a.license !== 'MIT',
    stats: {
      agent_id: a.agent_id,
      total_calls: 0,
      as_producer: 0,
      as_reviewer: 0,
      avg_confidence: 0,
      approval_rate: 0,
      last_used: null,
      calls_this_week: 0,
    },
  };
}

export function useAgents(division?: string) {
  return useQuery({
    queryKey: ['agents', division],
    queryFn: async () => {
      const params = division ? { division } : {};
      const res = await apiClient.get<BackendRosterResponse>('/agents', { params });
      return res.data.agents.map(mapAgent);
    },
  });
}

export function useAgent(agentId?: string) {
  return useQuery({
    queryKey: ['agent', agentId],
    queryFn: async () => {
      const res = await apiClient.get<BackendAgentSummary>(`/agents/${agentId}`);
      return mapAgent(res.data);
    },
    enabled: !!agentId,
  });
}

export function useAgentsWithStats(division?: string) {
  return useAgents(division);
}

export function useAgentSyncStatus() {
  return useQuery({
    queryKey: ['agentSyncStatus'],
    queryFn: async () => {
      const res = await apiClient.get<BackendSyncStatus>('/agents/sync-status');
      const d = res.data;

      const newAgents: SyncAgentPreview[] = d.new_agents.map(a => ({
        agent_id: a.filename.replace(/^.*\//, '').replace(/\.md$/, ''),
        display_name: a.title ?? a.filename.replace(/^.*\//, '').replace(/\.md$/, ''),
        division: a.division as SyncAgentPreview['division'],
        change_type: 'new' as const,
      }));

      const updatedAgents: SyncAgentPreview[] = d.modified_agents.map(f => ({
        agent_id: f.replace(/^.*\//, '').replace(/\.md$/, ''),
        display_name: f.replace(/^.*\//, '').replace(/\.md$/, ''),
        division: (f.split('/')[2] ?? 'specialized') as SyncAgentPreview['division'],
        change_type: 'updated' as const,
      }));

      return {
        up_to_date: !d.updates_available,
        last_synced_at: d.last_synced,
        last_commit: d.upstream_head,
        new_agents: newAgents,
        updated_agents: updatedAgents,
      } satisfies AgentSyncStatus;
    },
    staleTime: 5 * 60_000,
  });
}

export function useImportAgents() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (agentIds: string[]) => {
      const res = await apiClient.post('/agents/review', { approve: agentIds, skip: [] });
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
      const res = await apiClient.post<BackendAgentSummary>('/agents', data);
      return mapAgent(res.data);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }),
  });
}

export function useUpdateAgent(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Partial<AgentUpsertPayload>) => {
      const res = await apiClient.put<BackendAgentSummary>(`/agents/${agentId}`, data);
      return mapAgent(res.data);
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
