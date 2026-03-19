import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '../client';
import type { Organization, Invitation, OrgMember } from '../../types';

export function useOrganizations() {
  return useQuery({
    queryKey: ['orgs'],
    queryFn: async () => {
      const res = await apiClient.get<{ orgs: Organization[] }>('/orgs');
      return res.data.orgs;
    },
  });
}

export function useCreateOrg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { name: string }) => {
      const res = await apiClient.post<{ org: Organization }>('/orgs', data);
      return res.data.org;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orgs'] }),
  });
}

export function useInviteMember(orgId: string) {
  return useMutation({
    mutationFn: async (data: { email: string; role: 'admin' | 'member' }) => {
      const res = await apiClient.post<{ invitation: Invitation }>(
        `/orgs/${orgId}/invite`,
        data,
      );
      return res.data.invitation;
    },
  });
}

export function useUpdateMemberRole(orgId: string) {
  return useMutation({
    mutationFn: async (data: { userId: string; role: 'owner' | 'admin' | 'member' }) => {
      const res = await apiClient.put<{ member: OrgMember }>(
        `/orgs/${orgId}/members/${data.userId}`,
        { role: data.role },
      );
      return res.data.member;
    },
  });
}
