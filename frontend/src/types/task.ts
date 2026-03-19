export type TaskStatus =
  | 'DECOMPOSING'
  | 'QUEUED'
  | 'ASSIGNED'
  | 'STEP_1_PRODUCTION'
  | 'STEP_1_REVIEW'
  | 'STEP_2_PRODUCTION'
  | 'STEP_2_REVIEW'
  | 'STEP_3_PRODUCTION'
  | 'STEP_3_REVIEW'
  | 'STEP_4_FINAL_OUTPUT'
  | 'FINAL'
  | 'ESCALATED'
  | 'CANCELLED';

export interface Task {
  id: string;
  project_id: string;
  task_number: string;
  title: string;
  competencies: string[];
  dependencies: string[];
  status: TaskStatus;
  parent_task_id: string | null;
  workflow_position: number;
  mode: 'yoda' | 'ronin';
  primary_engine: string;
  primary_agent_role: string;
  created_at: string;
  updated_at: string;
}

/** Proposed task in a decomposition tree (before execution). */
export interface ProposedTask {
  task_number: string;
  title: string;
  competencies: string[];
  dependencies: string[];
}

export interface TaskTree {
  root: string;
  tasks: ProposedTask[];
  total_tasks: number;
  budget: number;
}

export interface QueryResult {
  status: 'executing' | 'pending_approval';
  task_ids?: string[];
  task_count?: number;
  task_tree?: TaskTree;
}
