export type ThreadRollupStatus =
  | 'in_progress'
  | 'escalated'
  | 'final'
  | 'cancelled'
  | 'idle';

export interface Thread {
  id: string;
  task_number: string;
  title: string;
  status: string;
  rollup_status: ThreadRollupStatus;
  subtask_count: number;
  pinned: boolean;
  archived: boolean;
  archived_at: string | null;
  deletion_scheduled_at: string | null;
  created_at: string;
  updated_at: string;
  latest_activity: string;
}
