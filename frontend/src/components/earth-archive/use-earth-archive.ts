import { useRef, useState } from 'react';
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

export function useEarthArchiveStatus(installerIssued = false) {
  return useQuery({
    queryKey: statusKey,
    queryFn: async () => (await apiClient.get<ArchiveStatus>(
      '/earth-archive/status', { withCredentials: true },
    )).data,
    refetchInterval: query => installerIssued || query.state.data?.installation ? 15_000 : false,
    retry: false,
  });
}

export function useArchiveInstaller() {
  const client = useQueryClient();
  const inFlight = useRef(false);
  const [hasIssued, setHasIssued] = useState(false);
  const mutation = useMutation({
    mutationFn: async () => {
      // This blob contains a reporting credential. Never inspect or log its contents.
      const response = await apiClient.post<Blob>('/earth-archive/installer', undefined, {
        withCredentials: true,
        responseType: 'blob',
      });
      const url = URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'Yoda-Earth-Setup.cmd';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    },
    onSuccess: () => {
      setHasIssued(true);
      void client.invalidateQueries({ queryKey: statusKey });
    },
    onSettled: () => { inFlight.current = false; },
  });
  return {
    ...mutation,
    hasIssued,
    mutate: () => {
      if (inFlight.current) return;
      inFlight.current = true;
      mutation.mutate();
    },
  };
}
