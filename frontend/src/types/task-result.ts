export interface TaskResult {
  id: string;
  task_id: string;
  step_number: number;
  result_content: string;
  engine_id: string;
  agent_role: string;
  tis27_hash: string;
  created_at: string;
}
