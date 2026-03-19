import type { TaskResult } from './task-result';
import type { TaskReview } from './task-review';

export interface CodeBlock {
  filename: string;
  language: string;
  content: string;
  version: string;
  line_count: number;
}

export interface SignatureChainEntry {
  step: number;
  hash: string;
  timestamp: string;
}

export interface TaskBibleTimestamps {
  decomposed_at: string;
  step_1_completed?: string;
  step_2_completed?: string;
  step_3_completed?: string;
  finalized_at?: string;
}

/** Summary returned in list views. */
export interface TaskBibleSummary {
  id: string;
  task_id: string;
  task_number: string;
  title: string;
  status: string;
  code_block_count: number;
  review_count: number;
  tl_dsa_signature: string;
  created_at: string;
}

/** Full entry returned in detail view. */
export interface TaskBibleEntry {
  id: string;
  task_id: string;
  task_number: string;
  title: string;
  results: TaskResult[];
  reviews: TaskReview[];
  final_output: string;
  code_blocks: CodeBlock[];
  tl_dsa_signature: string;
  signature_chain: SignatureChainEntry[];
  timestamps: TaskBibleTimestamps;
}
