export interface ReviewIssue {
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  reference: string;
  suggested_fix: string;
}

export interface ReviewVerdict {
  pass_fail: Record<string, boolean>;
  issues: ReviewIssue[];
  suggestions: string[];
  enrichments: string[];
  confidence: number;
}

export interface TaskReview {
  id: string;
  task_result_id: string;
  step_number?: number;
  engine_id: string;
  agent_role: string;
  verdict: ReviewVerdict;
  tis27_hash: string;
  censorship_flagged: boolean;
  created_at: string;
}
