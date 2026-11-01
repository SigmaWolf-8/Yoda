import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { apiClient } from '../../api/client';

export interface EvidenceFormula {
  id: string;
  title: string;
  method: string;
  inputs: Record<string, string>;
  limitations: string[];
}
export interface FormulaEvidenceRun {
  id: string;
  formula_id: string;
  inputs: Record<string, string>;
  result: {
    status: 'pass' | 'fail';
    method: string;
    scope: string;
    outputs: Record<string, unknown>;
    checks: { name: string; passed: boolean; actual: unknown; expected: unknown; tolerance?: unknown }[];
    limitations: string[];
  };
  executed_at: string;
  source_sha256: string;
  evidence_sha256: string;
}
const historyKey = ['formula-evidence', 'runs'] as const;

export function useFormulaCatalog() {
  return useQuery({
    queryKey: ['formula-evidence', 'catalog'],
    queryFn: async () => (await apiClient.get<{ formulas: EvidenceFormula[] }>(
      '/formula-evidence/catalog', { withCredentials: true },
    )).data.formulas,
    retry: false,
  });
}
export function useFormulaRuns() {
  return useQuery({
    queryKey: historyKey,
    queryFn: async () => (await apiClient.get<{ runs: FormulaEvidenceRun[] }>(
      '/formula-evidence/runs', { withCredentials: true },
    )).data.runs,
    retry: false,
  });
}
export function useExecuteFormula() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: { formula_id: string; inputs: Record<string, string> }) =>
      (await apiClient.post<FormulaEvidenceRun>('/formula-evidence/runs', body, { withCredentials: true })).data,
    onSuccess: run => {
      client.setQueryData<FormulaEvidenceRun[]>(historyKey, old =>
        [run, ...(old ?? []).filter(item => item.id !== run.id)].slice(0, 50));
    },
  });
}
export function evidenceError(error: unknown): string {
  if (isAxiosError(error)) {
    const detail = error.response?.data?.error;
    if (typeof detail === 'string') return detail;
    if (error.response?.status === 404) return 'The evidence service is not available on this server yet.';
  }
  return error instanceof Error ? error.message : 'The request could not be completed.';
}
