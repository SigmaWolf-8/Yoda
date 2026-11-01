import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';

export interface ArchiveReport {
  sources?: Partial<Record<'copernicus' | 'gebco' | 'egm2008', {
    complete: boolean;
    objects: number;
    at: string;
    error_type?: string | null;
  }>>;
  phase?: string;
  catalog_complete?: boolean;
  catalog_objects?: number;
  catalog_bytes?: number;
  verified_objects?: number;
  verified_bytes?: number;
  failures?: number;
  message?: string;
  reported_at?: string;
  archive_complete?: boolean;
  engine_ready?: boolean;
}

export interface ArchiveStatus {
  installation: null | {
    id: string;
    created_at: string;
    last_report_at: string | null;
    expires_at: string;
    report: ArchiveReport | null;
  };
  coverage: string;
  renderer_tier: string;
  server_verified: boolean;
}

const statusKey = ['earth-archive', 'status'] as const;

export function useEarthArchiveStatus() {
  return useQuery({
    queryKey: statusKey,
    queryFn: async () => (await apiClient.get<ArchiveStatus>(
      '/earth-archive/status', { withCredentials: true },
    )).data,
    refetchInterval: query => query.state.data?.installation ? 15_000 : false,
    retry: false,
  });
}

export function useArchiveInstaller() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      // This blob contains a reporting credential. Never inspect or log its contents.
      const response = await apiClient.post<Blob>('/earth-archive/installer', undefined, {
        withCredentials: true,
        responseType: 'blob',
      });
      const url = URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'install-yoda-earth.ps1';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    },
    onSuccess: () => { void client.invalidateQueries({ queryKey: statusKey }); },
  });
}
