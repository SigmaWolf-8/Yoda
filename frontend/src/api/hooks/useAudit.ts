import { useQuery, useMutation } from '@tanstack/react-query';
import apiClient from '../client';
import type { AuditRecord } from '../../types';

export function useAuditLog(taskId?: string) {
  return useQuery({
    queryKey: ['audit', taskId],
    queryFn: async () => {
      const res = await apiClient.get<{ records: AuditRecord[] }>(`/audit/${taskId}`);
      return res.data.records;
    },
    enabled: !!taskId,
  });
}

export function useExportAuditJSON() {
  return useMutation({
    mutationFn: async (taskId: string) => {
      const res = await apiClient.get(`/audit/${taskId}/export/json`, {
        responseType: 'blob',
      });
      // Trigger browser download
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-${taskId}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
  });
}
